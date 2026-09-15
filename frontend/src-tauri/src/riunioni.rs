//! Le riunioni come stanno sul disco: una cartella per riunione dentro
//! `Music/meetily-recordings`, e dentro `audio.mp4`, `metadata.json` (li
//! scrive Meetily) e, quando i nostri script hanno trascritto,
//! `trascrizione.md` e `voci.json`.
//!
//! Tre comandi in sola lettura:
//! - `list_pending_recordings`: le cartelle con audio e senza `trascrizione.md`;
//! - `list_transcribed_recordings`: quelle con `trascrizione.md`;
//! - `read_transcript`: il testo di una.
//!
//! E quelli che lanciano il lavoro, piu' sotto: `start_transcription`,
//! `transcription_progress`, `get/set_transcriber_folder`.
//!
//! «Gia' trascritta» lo dice il disco, non il database dell'app (deciso il
//! 09-09): le 25 riunioni trascritte fuori da Meetily contano come pronte.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_store::StoreExt;

use crate::audio::recording_preferences::load_recording_preferences;

const AUDIO: &str = "audio.mp4";
const TESTO: &str = "trascrizione.md";
const VOCI: &str = "voci.json";
const METADATA: &str = "metadata.json";
const LIVELLO: &str = "livello.json";

/// Una registrazione con l'audio ma senza testo.
#[derive(Serialize)]
pub struct Arretrata {
    pub folder: String,
    pub minutes: u32,
    /// `true` se dentro non c'e' praticamente voce, `null` se nessuno ha
    /// ancora misurato (lo scrive `livello.json`, quando c'e').
    pub silent: Option<bool>,
    /// quanto tempo, in percento, aveva voce dentro (da `livello.json`)
    pub percento_voce: Option<u32>,
    /// l'ultimo tentativo di trascrizione, com'e' in `avanzamento.json`:
    /// e' il disco a ricordare che una riunione e' uscita «muta», non la
    /// memoria dell'app (15-09: riaperta l'app, la riga tornava TRASCRIVI)
    pub esito: Option<Avanzamento>,
}

/// Una riunione con il suo testo.
#[derive(Serialize)]
pub struct Trascritta {
    pub folder: String,
    pub recorded_at: String,
    pub minutes: u32,
    pub voices: u32,
    pub speakers: Vec<String>,
}

#[derive(Deserialize, Default)]
struct Metadata {
    created_at: Option<String>,
    completed_at: Option<String>,
    duration_seconds: Option<f64>,
}

#[derive(Deserialize)]
struct Voce {
    #[serde(default)]
    minuti: f64,
    nome_proposto: Option<String>,
}

#[derive(Deserialize)]
struct Voci {
    voci: std::collections::HashMap<String, Voce>,
}

#[derive(Deserialize)]
struct Livello {
    muta: bool,
    #[serde(default)]
    percento_voce: Option<u32>,
}

fn leggi_json<T: for<'de> Deserialize<'de>>(percorso: &Path) -> Option<T> {
    let testo = std::fs::read_to_string(percorso).ok()?;
    serde_json::from_str(&testo).ok()
}

/// I minuti di una riunione: `duration_seconds` se Meetily l'ha scritto
/// (lo fa per gli import), altrimenti la distanza fra inizio e fine.
fn minuti(meta: &Metadata) -> u32 {
    if let Some(s) = meta.duration_seconds {
        return (s / 60.0).round() as u32;
    }
    let inizio = meta.created_at.as_deref().and_then(parse_iso);
    let fine = meta.completed_at.as_deref().and_then(parse_iso);
    match (inizio, fine) {
        (Some(a), Some(b)) if b > a => ((b - a).num_seconds() as f64 / 60.0).round() as u32,
        _ => 0,
    }
}

fn parse_iso(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
}

/// Le voci di `voci.json`: quante sono, e i nomi riconosciuti dalla piu'
/// presente alla meno. Le voci senza nome restano contate ma non nominate.
fn voci(dir: &Path) -> (u32, Vec<String>) {
    let Some(v) = leggi_json::<Voci>(&dir.join(VOCI)) else {
        return (0, Vec::new());
    };
    let mut con_nome: Vec<(f64, String)> = v
        .voci
        .values()
        .filter_map(|voce| voce.nome_proposto.clone().map(|n| (voce.minuti, n)))
        .collect();
    con_nome.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    (v.voci.len() as u32, con_nome.into_iter().map(|(_, n)| n).collect())
}

async fn cartella_registrazioni<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    load_recording_preferences(app)
        .await
        .map(|p| p.save_folder)
        .map_err(|e| format!("Failed to load recording preferences: {}", e))
}

/// Le sottocartelle che hanno un `audio.mp4`, in ordine di nome.
fn cartelle_con_audio(radice: &Path) -> Result<Vec<PathBuf>, String> {
    let elementi = std::fs::read_dir(radice)
        .map_err(|e| format!("Cannot read recordings folder {:?}: {}", radice, e))?;
    let mut cartelle: Vec<PathBuf> = elementi
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_dir() && p.join(AUDIO).is_file())
        .collect();
    cartelle.sort();
    Ok(cartelle)
}

fn nome(dir: &Path) -> String {
    dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Un nome di cartella che resta dentro la cartella delle registrazioni:
/// niente separatori, niente `..`.
fn nome_sicuro(folder: &str) -> Result<&str, String> {
    if folder.is_empty()
        || folder.contains(|c| c == '/' || c == '\\')
        || folder == "."
        || folder == ".."
    {
        return Err(format!("Not a recording folder name: {:?}", folder));
    }
    Ok(folder)
}

#[tauri::command]
pub async fn list_pending_recordings<R: Runtime>(
    app: AppHandle<R>,
    in_corso: tauri::State<'_, InCorso>,
) -> Result<Vec<Arretrata>, String> {
    let radice = cartella_registrazioni(&app).await?;
    let vivi: HashSet<String> = in_corso
        .0
        .lock()
        .map(|set| set.clone())
        .unwrap_or_default();
    let elenco = cartelle_con_audio(&radice)?
        .into_iter()
        .filter(|dir| !dir.join(TESTO).is_file())
        .map(|dir| {
            let meta = leggi_json::<Metadata>(&dir.join(METADATA)).unwrap_or_default();
            let livello = leggi_json::<Livello>(&dir.join(LIVELLO));
            let folder = nome(&dir);
            let esito = esito_su_disco(&dir, vivi.contains(&folder));
            Arretrata {
                folder,
                minutes: minuti(&meta),
                silent: livello.as_ref().map(|l| l.muta),
                percento_voce: livello.and_then(|l| l.percento_voce),
                esito,
            }
        })
        .collect();
    Ok(elenco)
}

#[tauri::command]
pub async fn list_transcribed_recordings<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<Trascritta>, String> {
    let radice = cartella_registrazioni(&app).await?;
    let elenco = cartelle_con_audio(&radice)?
        .into_iter()
        .filter(|dir| dir.join(TESTO).is_file())
        .map(|dir| {
            let meta = leggi_json::<Metadata>(&dir.join(METADATA)).unwrap_or_default();
            let (voices, speakers) = voci(&dir);
            Trascritta {
                folder: nome(&dir),
                recorded_at: meta.created_at.clone().unwrap_or_default(),
                minutes: minuti(&meta),
                voices,
                speakers,
            }
        })
        .collect();
    Ok(elenco)
}

/// Il testo di una riunione, `trascrizione.md` com'e'. A spezzarlo in turni
/// ci pensa il frontend (`leggiTurni`), cosi' qui non si sa com'e' fatto.
#[tauri::command]
pub async fn read_transcript<R: Runtime>(
    app: AppHandle<R>,
    folder: String,
) -> Result<String, String> {
    let radice = cartella_registrazioni(&app).await?;
    let dir = radice.join(nome_sicuro(&folder)?);
    std::fs::read_to_string(dir.join(TESTO))
        .map_err(|e| format!("Cannot read {} in {:?}: {}", TESTO, dir, e))
}

// ---------------------------------------------------------------------------
// Lanciare la trascrizione (il pulsante TRASCRIVI).
//
// Il testo non lo fa l'app: lo fanno i nostri script Python
// (`trascrivi/riunione.py`, nel repo di configurazione, non qui). L'app li
// lancia come programma a parte con `uv run riunione.py <cartella>` — le
// librerie che servono stanno scritte in testa allo script, `uv` le procura
// da solo — e poi guarda a che punto e' leggendo `avanzamento.json`, che lo
// script scrive nella cartella a ogni fase (avviata, testo, voci, fatto;
// oppure muta, errore).
//
// Dove stanno gli script lo dice `trascrivi.json` nello store dell'app
// (chiave `cartella`), separato dalle preferenze di Meetily: la pagina delle
// impostazioni le riscrive per intero, e una chiave in piu' li' sparirebbe.
// ---------------------------------------------------------------------------

/// Le cartelle con una trascrizione in corso adesso. Serve a non lanciarne
/// due sulla stessa riunione, e a distinguere «sta lavorando» da «il
/// programma e' morto a meta'» (la fase del testo dura 8 minuti senza
/// scrivere niente: il file da solo non lo direbbe).
#[derive(Default)]
pub struct InCorso(Mutex<HashSet<String>>);

const AVANZAMENTO: &str = "avanzamento.json";
const REGISTRO: &str = "trascrizione.log";
const SCRIPT: &str = "riunione.py";
const STORE_TRASCRIVI: &str = "trascrivi.json";
/// Il pid del programma che sta trascrivendo, scritto nella cartella: e'
/// la prova di vita quando l'app e' stata chiusa e riaperta e `InCorso` non
/// sa piu' niente (15-09, riletto il codice).
const PID: &str = "trascrizione.pid";

/// Quello che lo script scrive in `avanzamento.json`, com'e'.
#[derive(Serialize, Deserialize, Clone)]
pub struct Avanzamento {
    pub fase: String,
    #[serde(default)]
    pub totale_minuti: Option<f64>,
    #[serde(default)]
    pub iniziato_il: Option<String>,
    #[serde(default)]
    pub aggiornato_il: Option<String>,
    #[serde(default)]
    pub percento_voce: Option<u32>,
    #[serde(default)]
    pub messaggio: Option<String>,
}

fn cartella_script<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let store = app
        .store(STORE_TRASCRIVI)
        .map_err(|e| format!("Cannot open store {}: {}", STORE_TRASCRIVI, e))?;
    let cartella = store
        .get("cartella")
        .and_then(|v| v.as_str().map(PathBuf::from))
        .ok_or_else(|| {
            "Non so dove stanno gli script che trascrivono: va detto nelle impostazioni \
             (la cartella con dentro riunione.py)."
                .to_string()
        })?;
    if !cartella.join(SCRIPT).is_file() {
        return Err(format!("In {:?} non c'e' {}.", cartella, SCRIPT));
    }
    Ok(cartella)
}

/// La cartella degli script, se e' stata detta.
#[tauri::command]
pub async fn get_transcriber_folder<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<String>, String> {
    let store = app
        .store(STORE_TRASCRIVI)
        .map_err(|e| format!("Cannot open store {}: {}", STORE_TRASCRIVI, e))?;
    Ok(store
        .get("cartella")
        .and_then(|v| v.as_str().map(str::to_string)))
}

/// Dice all'app dove stanno gli script: accetta solo una cartella con
/// dentro `riunione.py`.
#[tauri::command]
pub async fn set_transcriber_folder<R: Runtime>(
    app: AppHandle<R>,
    folder: String,
) -> Result<(), String> {
    if !Path::new(&folder).join(SCRIPT).is_file() {
        return Err(format!("In {:?} non c'e' {}.", folder, SCRIPT));
    }
    let store = app
        .store(STORE_TRASCRIVI)
        .map_err(|e| format!("Cannot open store {}: {}", STORE_TRASCRIVI, e))?;
    store.set("cartella", serde_json::Value::String(folder));
    store
        .save()
        .map_err(|e| format!("Cannot save store {}: {}", STORE_TRASCRIVI, e))
}

/// Fa partire la trascrizione di una cartella e torna subito: il lavoro
/// va avanti da solo, l'app lo segue con `transcription_progress`. Quando
/// il programma finisce, in qualunque modo, l'app riceve l'evento
/// `transcription-finished` con `{ folder, ok }`.
#[tauri::command]
pub async fn start_transcription<R: Runtime>(
    app: AppHandle<R>,
    in_corso: tauri::State<'_, InCorso>,
    folder: String,
) -> Result<(), String> {
    let radice = cartella_registrazioni(&app).await?;
    let dir = radice.join(nome_sicuro(&folder)?);
    if !dir.join(AUDIO).is_file() {
        return Err(format!("In {:?} non c'e' {}.", dir, AUDIO));
    }
    if dir.join(TESTO).is_file() {
        return Err(format!("{:?} e' gia' trascritta.", folder));
    }
    let script_dir = cartella_script(&app)?;
    if vivo_su_disco(&dir) {
        return Err(format!(
            "{:?} si sta gia' trascrivendo (da prima che l'app fosse riaperta).",
            folder
        ));
    }

    {
        let mut set = in_corso.0.lock().map_err(|e| e.to_string())?;
        if !set.insert(folder.clone()) {
            return Err(format!("{:?} si sta gia' trascrivendo.", folder));
        }
    }
    let ritira = |app: &AppHandle<R>| {
        if let Ok(mut set) = app.state::<InCorso>().0.lock() {
            set.remove(&folder);
        }
    };

    // Tutto quello che lo script stampa — comprese le domande per Greg alla
    // fine — resta nella cartella, accanto all'audio.
    let registro = std::fs::File::create(dir.join(REGISTRO))
        .map_err(|e| format!("Cannot create {}: {}", REGISTRO, e));
    let registro = match registro {
        Ok(f) => f,
        Err(e) => {
            ritira(&app);
            return Err(e);
        }
    };
    let registro_err = registro.try_clone().map_err(|e| e.to_string());
    let registro_err = match registro_err {
        Ok(f) => f,
        Err(e) => {
            ritira(&app);
            return Err(e);
        }
    };

    // «avviata» subito, prima che `uv` abbia finito di procurarsi le librerie:
    // cosi' la scheda ha qualcosa da mostrare da subito. Lo script poi lo
    // riscrive.
    let _ = std::fs::write(
        dir.join(AVANZAMENTO),
        serde_json::to_string_pretty(&Avanzamento {
            fase: "avviata".into(),
            totale_minuti: None,
            iniziato_il: Some(chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()),
            aggiornato_il: None,
            percento_voce: None,
            messaggio: None,
        })
        .unwrap_or_default(),
    );

    let mut comando = Command::new("uv");
    comando
        .arg("run")
        .arg(script_dir.join(SCRIPT))
        .arg(&dir)
        .current_dir(&script_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(registro))
        .stderr(Stdio::from(registro_err));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        comando.creation_flags(CREATE_NO_WINDOW);
    }

    let mut figlio = match comando.spawn() {
        Ok(f) => f,
        Err(e) => {
            ritira(&app);
            let _ = std::fs::remove_file(dir.join(AVANZAMENTO));
            return Err(if e.kind() == std::io::ErrorKind::NotFound {
                "Non trovo `uv` su questo PC: e' il programma che fa girare gli script \
                 (astral.sh/uv). Va installato e poi l'app riavviata."
                    .to_string()
            } else {
                format!("Cannot start {}: {}", SCRIPT, e)
            });
        }
    };
    log::info!("Trascrizione avviata su {:?} (pid {})", folder, figlio.id());
    let _ = std::fs::write(dir.join(PID), figlio.id().to_string());

    let app2 = app.clone();
    let folder2 = folder.clone();
    let pid_file = dir.join(PID);
    std::thread::spawn(move || {
        let esito = figlio.wait();
        let ok = esito.as_ref().map(|s| s.success()).unwrap_or(false);
        log::info!("Trascrizione finita su {:?}: {:?}", folder2, esito);
        let _ = std::fs::remove_file(&pid_file);
        if let Ok(mut set) = app2.state::<InCorso>().0.lock() {
            set.remove(&folder2);
        }
        let _ = app2.emit(
            "transcription-finished",
            serde_json::json!({ "folder": folder2, "ok": ok }),
        );
    });
    Ok(())
}

/// Il programma segnato in `trascrizione.pid` e' ancora vivo? Serve quando
/// `InCorso` non lo sa: l'app e' stata chiusa e riaperta mentre lo script
/// girava. Costa un giro dei processi: si chiama solo in quel caso.
fn vivo_su_disco(dir: &Path) -> bool {
    let Ok(testo) = std::fs::read_to_string(dir.join(PID)) else {
        return false;
    };
    let Ok(pid) = testo.trim().parse::<u32>() else {
        return false;
    };
    let sistema = sysinfo::System::new_all();
    sistema.process(sysinfo::Pid::from_u32(pid)).is_some()
}

/// Quello che c'e' in `avanzamento.json`, `None` se non c'e'. Se il file
/// dice «in corso» ma nessun programma sta girando su quella cartella —
/// ne' fra quelli lanciati da questa sessione, ne' col pid sul disco — la
/// fase diventa `interrotta`.
fn esito_su_disco(dir: &Path, vivo: bool) -> Option<Avanzamento> {
    let mut stato = leggi_json::<Avanzamento>(&dir.join(AVANZAMENTO))?;
    let in_lavoro = matches!(stato.fase.as_str(), "avviata" | "testo" | "voci");
    if in_lavoro && !vivo && !vivo_su_disco(dir) {
        stato.fase = "interrotta".into();
    }
    Some(stato)
}

/// A che punto e' una cartella: vedi `esito_su_disco`.
#[tauri::command]
pub async fn transcription_progress<R: Runtime>(
    app: AppHandle<R>,
    in_corso: tauri::State<'_, InCorso>,
    folder: String,
) -> Result<Option<Avanzamento>, String> {
    let radice = cartella_registrazioni(&app).await?;
    let dir = radice.join(nome_sicuro(&folder)?);
    let vivo = in_corso
        .0
        .lock()
        .map(|set| set.contains(&folder))
        .unwrap_or(false);
    Ok(esito_su_disco(&dir, vivo))
}

// ---------------------------------------------------------------------------
// Il Cestino, l'audio da riascoltare, il riassunto.
// ---------------------------------------------------------------------------

const RIASSUNTO: &str = "riassunto.md";
const NOTE: &str = "note.md";

/// Sposta la cartella di una riunione nel Cestino di Windows: non cancella,
/// si recupera da li'. Rifiuta se su quella cartella sta girando una
/// trascrizione.
#[tauri::command]
pub async fn trash_recording<R: Runtime>(
    app: AppHandle<R>,
    in_corso: tauri::State<'_, InCorso>,
    folder: String,
) -> Result<(), String> {
    let radice = cartella_registrazioni(&app).await?;
    let dir = radice.join(nome_sicuro(&folder)?);
    if !dir.is_dir() {
        return Err(format!("{:?} non c'e'.", folder));
    }
    let vivo = in_corso
        .0
        .lock()
        .map(|set| set.contains(&folder))
        .unwrap_or(false);
    if vivo || vivo_su_disco(&dir) {
        return Err(format!("{:?} si sta trascrivendo: prima aspetta che finisca.", folder));
    }
    trash::delete(&dir).map_err(|e| format!("Non sono riuscito a mettere {:?} nel Cestino: {}", folder, e))?;
    log::info!("Nel Cestino: {:?}", dir);
    Ok(())
}

/// Il percorso assoluto di `audio.mp4`: il frontend lo passa a
/// `convertFileSrc` e lo suona con un `<audio>` (il lettore, galleria 13).
#[tauri::command]
pub async fn recording_audio_path<R: Runtime>(
    app: AppHandle<R>,
    folder: String,
) -> Result<String, String> {
    let radice = cartella_registrazioni(&app).await?;
    let file = radice.join(nome_sicuro(&folder)?).join(AUDIO);
    if !file.is_file() {
        return Err(format!("In {:?} non c'e' {}.", folder, AUDIO));
    }
    Ok(file.to_string_lossy().into_owned())
}

/// I fogli scritti a mano accanto al testo: il riassunto (incollato da
/// Claude) e le note di Greg. Solo questi due nomi: il frontend non sceglie
/// file a piacere.
fn nome_foglio(name: &str) -> Result<&'static str, String> {
    match name {
        "riassunto.md" => Ok(RIASSUNTO),
        "note.md" => Ok(NOTE),
        altro => Err(format!("Not a sheet: {:?}", altro)),
    }
}

/// Un foglio com'e'; `None` se non c'e'.
#[tauri::command]
pub async fn read_sheet<R: Runtime>(
    app: AppHandle<R>,
    folder: String,
    name: String,
) -> Result<Option<String>, String> {
    let radice = cartella_registrazioni(&app).await?;
    let file = radice.join(nome_sicuro(&folder)?).join(nome_foglio(&name)?);
    if !file.is_file() {
        return Ok(None);
    }
    std::fs::read_to_string(&file)
        .map(Some)
        .map_err(|e| format!("Cannot read {} in {:?}: {}", name, folder, e))
}

/// Scrive un foglio accanto al testo: anche questi li ricorda il disco.
#[tauri::command]
pub async fn write_sheet<R: Runtime>(
    app: AppHandle<R>,
    folder: String,
    name: String,
    text: String,
) -> Result<(), String> {
    let radice = cartella_registrazioni(&app).await?;
    let file = radice.join(nome_sicuro(&folder)?).join(nome_foglio(&name)?);
    std::fs::write(&file, text).map_err(|e| format!("Cannot write {} in {:?}: {}", name, folder, e))
}

/// Un foglio nel Cestino di Windows (si recupera da li').
#[tauri::command]
pub async fn trash_sheet<R: Runtime>(
    app: AppHandle<R>,
    folder: String,
    name: String,
) -> Result<(), String> {
    let radice = cartella_registrazioni(&app).await?;
    let file = radice.join(nome_sicuro(&folder)?).join(nome_foglio(&name)?);
    if !file.is_file() {
        return Ok(());
    }
    trash::delete(&file).map_err(|e| format!("Cannot trash {} in {:?}: {}", name, folder, e))
}

/// Il testo nel Cestino, l'audio resta: la riunione torna «da trascrivere»
/// (15-09, Greg: «se elimino una trascritta torna in Da trascrivere; se la
/// elimino anche li', va nel Cestino»). Vanno via i prodotti degli script
/// e il riassunto, che era di quel testo; le note di Greg restano.
#[tauri::command]
pub async fn trash_transcript<R: Runtime>(
    app: AppHandle<R>,
    in_corso: tauri::State<'_, InCorso>,
    folder: String,
) -> Result<(), String> {
    let radice = cartella_registrazioni(&app).await?;
    let dir = radice.join(nome_sicuro(&folder)?);
    let vivo = in_corso
        .0
        .lock()
        .map(|set| set.contains(&folder))
        .unwrap_or(false);
    if vivo || vivo_su_disco(&dir) {
        return Err(format!("{:?} si sta trascrivendo: prima aspetta che finisca.", folder));
    }
    const PRODOTTI: [&str; 9] = [
        TESTO,
        "trascrizione.md.prima",
        "testo.json",
        "turni.json",
        VOCI,
        AVANZAMENTO,
        REGISTRO,
        PID,
        RIASSUNTO,
    ];
    let da_buttare: Vec<PathBuf> = PRODOTTI
        .iter()
        .map(|n| dir.join(n))
        .filter(|f| f.is_file())
        .collect();
    if da_buttare.is_empty() {
        return Ok(());
    }
    trash::delete_all(&da_buttare)
        .map_err(|e| format!("Cannot trash the transcript of {:?}: {}", folder, e))?;
    log::info!("Testo nel Cestino: {:?} ({} file)", folder, da_buttare.len());
    Ok(())
}

/// Una persona che gli script conoscono gia' (`memoria/voci-note.json`
/// nella cartella degli script): il nome e in quante riunioni e' stata
/// riconosciuta. Solo lettura: i nomi si danno con `battesimo.py`. Il file
/// con i nomi veri (`chiavi-nomi.json`) qui non si legge mai.
#[derive(Serialize)]
pub struct Persona {
    pub nome: String,
    pub riunioni: u32,
}

#[derive(Deserialize)]
struct VociNote {
    #[serde(default)]
    persone: std::collections::HashMap<String, PersonaNota>,
}

#[derive(Deserialize)]
struct PersonaNota {
    #[serde(default)]
    riunioni: u32,
}

#[tauri::command]
pub async fn list_known_voices<R: Runtime>(app: AppHandle<R>) -> Result<Vec<Persona>, String> {
    let script_dir = cartella_script(&app)?;
    let Some(note) = leggi_json::<VociNote>(&script_dir.join("memoria").join("voci-note.json")) else {
        return Ok(Vec::new());
    };
    let mut persone: Vec<Persona> = note
        .persone
        .into_iter()
        .map(|(nome, p)| Persona { nome, riunioni: p.riunioni })
        .collect();
    persone.sort_by(|a, b| b.riunioni.cmp(&a.riunioni).then_with(|| a.nome.cmp(&b.nome)));
    Ok(persone)
}

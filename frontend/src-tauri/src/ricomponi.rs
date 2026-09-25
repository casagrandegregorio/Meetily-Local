//! Le registrazioni interrotte: si ricompongono da sole.
//!
//! Mentre registra, il motore scrive l'audio a pezzi (10 secondi dal 25-09,
//! prima 30) in `.checkpoints/audio_chunk_00000.mp4`, ... e solo allo Stop li unisce in
//! `audio.mp4`. Se l'app si chiude mentre registra (o cade), nella cartella
//! restano i pezzi, `metadata.json` con `status: "recording"` e nessun
//! `audio.mp4`: la riunione non compare da nessuna parte, perche' gli elenchi
//! guardano solo le cartelle con `audio.mp4`. E' successo il 18-09 e il 25-09.
//!
//! Qui: quando si apre «Da trascrivere» (e nient'altro sta registrando), le
//! cartelle cosi' si ricompongono — i pezzi uniti in `audio.mp4` con ffmpeg,
//! senza ricodificare (lo stesso concat dello Stop, `incremental_saver.rs`),
//! e `metadata.json` chiuso con `"ricomposta": true`. Poi la riga compare con
//! la parola «ricomposta». Quello che stava ancora nella memoria del motore
//! (fino a un pezzo) e' perso: non e' mai arrivato sul disco. Un pezzo rotto,
//! in fondo o in mezzo, si salta: meglio un buco di dieci secondi che niente.
//!
//! Le guardie, perche' una cartella che sta registrando non va mai toccata:
//! niente mentre l'app registra; solo `status: "recording"`; e l'ultimo
//! pezzo deve avere piu' di due minuti (un'altra copia dell'app che registra
//! ne scrive uno ogni trenta secondi).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use chrono::{DateTime, Utc};

const CHECKPOINTS: &str = ".checkpoints";
const AUDIO: &str = "audio.mp4";
const PARZIALE: &str = "audio.mp4.part";
const METADATA: &str = "metadata.json";
/// quanti secondi di audio ha un pezzo, se non si sa di meglio
const SECONDI_PER_PEZZO: f64 = crate::audio::incremental_saver::SECONDI_PER_PEZZO as f64;
/// l'ultimo pezzo deve essere piu' vecchio di cosi', o la cartella e' viva
const ATTESA: Duration = Duration::from_secs(120);

/// Una ricomposizione alla volta, anche se l'elenco si chiede due volte.
static UNA_ALLA_VOLTA: Mutex<()> = Mutex::new(());

/// I pezzi di una cartella, in ordine.
fn pezzi(dir: &Path) -> Vec<PathBuf> {
    let Ok(elementi) = std::fs::read_dir(dir.join(CHECKPOINTS)) else {
        return Vec::new();
    };
    let mut pezzi: Vec<PathBuf> = elementi
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("audio_chunk_") && n.ends_with(".mp4"))
                .unwrap_or(false)
        })
        .collect();
    pezzi.sort();
    pezzi
}

fn leggi_metadata(dir: &Path) -> Option<serde_json::Value> {
    let testo = std::fs::read_to_string(dir.join(METADATA)).ok()?;
    serde_json::from_str(&testo).ok()
}

/// Se la cartella e' una registrazione interrotta da ricomporre.
fn da_ricomporre(dir: &Path, adesso: SystemTime) -> bool {
    if dir.join(AUDIO).exists() {
        return false;
    }
    let pezzi = pezzi(dir);
    if pezzi.is_empty() {
        return false;
    }
    let stato = leggi_metadata(dir)
        .and_then(|m| m.get("status").and_then(|s| s.as_str()).map(str::to_owned));
    if stato.as_deref() != Some("recording") {
        return false;
    }
    let ultimo = pezzi
        .iter()
        .filter_map(|p| std::fs::metadata(p).ok()?.modified().ok())
        .max();
    match ultimo {
        Some(t) => adesso.duration_since(t).map(|d| d >= ATTESA).unwrap_or(false),
        None => false,
    }
}

/// Unisce i pezzi in `uscita` senza ricodificare.
fn unisci(ffmpeg: &Path, dir: &Path, pezzi: &[PathBuf], uscita: &Path) -> Result<(), String> {
    let lista = dir.join(CHECKPOINTS).join("ricomponi.txt");
    let righe: String = pezzi
        .iter()
        .map(|p| format!("file '{}'\n", p.to_string_lossy().replace('\'', "'\\''")))
        .collect();
    std::fs::write(&lista, righe).map_err(|e| format!("lista dei pezzi: {}", e))?;

    let mut comando = Command::new(ffmpeg);
    comando
        .args(["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i"])
        .arg(&lista)
        .args(["-c", "copy", "-movflags", "+faststart", "-f", "mp4", "-y"])
        .arg(uscita);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        comando.creation_flags(CREATE_NO_WINDOW);
    }
    let esito = comando.output().map_err(|e| format!("ffmpeg non parte: {}", e));
    let _ = std::fs::remove_file(&lista);
    let esito = esito?;
    if !esito.status.success() {
        let _ = std::fs::remove_file(uscita);
        return Err(format!("ffmpeg: {}", String::from_utf8_lossy(&esito.stderr).trim()));
    }
    let pieno = std::fs::metadata(uscita).map(|m| m.len() > 0).unwrap_or(false);
    if !pieno {
        let _ = std::fs::remove_file(uscita);
        return Err("ffmpeg ha scritto un file vuoto".into());
    }
    Ok(())
}

/// Chiude `metadata.json` come una registrazione finita, e dice che e' ricomposta.
/// La fine e' l'ora in cui e' stato scritto l'ultimo pezzo usato, se si sa;
/// altrimenti l'inizio piu' i pezzi per la loro durata.
fn chiudi_metadata(dir: &Path, quanti: usize, ultimo: Option<SystemTime>) -> Result<(), String> {
    let mut meta = leggi_metadata(dir).unwrap_or_else(|| serde_json::json!({}));
    let inizio = meta
        .get("created_at")
        .and_then(|s| s.as_str())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc));
    let stimata = quanti as f64 * SECONDI_PER_PEZZO;
    let (fine, secondi) = match (inizio, ultimo.map(DateTime::<Utc>::from)) {
        (Some(a), Some(b)) if b > a => (b, (b - a).num_seconds() as f64),
        (Some(a), _) => (a + chrono::Duration::seconds(stimata as i64), stimata),
        (None, _) => (Utc::now(), stimata),
    };
    if let Some(m) = meta.as_object_mut() {
        m.insert("status".into(), "completed".into());
        m.insert("completed_at".into(), fine.to_rfc3339().into());
        m.insert("duration_seconds".into(), secondi.into());
        m.insert("ricomposta".into(), true.into());
    }
    let testo = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    let provvisorio = dir.join("metadata.json.part");
    std::fs::write(&provvisorio, testo).map_err(|e| format!("metadata: {}", e))?;
    std::fs::rename(&provvisorio, dir.join(METADATA)).map_err(|e| format!("metadata: {}", e))
}

/// Se ffmpeg riesce a leggere un pezzo da cima a fondo.
fn leggibile(ffmpeg: &Path, pezzo: &Path) -> bool {
    let mut comando = Command::new(ffmpeg);
    comando
        .args(["-hide_banner", "-v", "error", "-i"])
        .arg(pezzo)
        .args(["-f", "null", "-"]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        comando.creation_flags(CREATE_NO_WINDOW);
    }
    comando
        .output()
        .map(|o| o.status.success() && o.stderr.is_empty())
        .unwrap_or(false)
}

/// Ricompone una cartella: i pezzi in `audio.mp4`, il metadata chiuso, i
/// pezzi buttati. Se l'unione di tutti non riesce, si prova un pezzo alla
/// volta e si tengono solo quelli leggibili: di solito e' l'ultimo, scritto a
/// meta' quando l'app e' caduta, ma puo' essere uno in mezzo. Dice quanti
/// pezzi ha usato.
fn ricomponi(ffmpeg: &Path, dir: &Path) -> Result<usize, String> {
    let tutti = pezzi(dir);
    let parziale = dir.join(PARZIALE);
    let usati: Vec<PathBuf> = match unisci(ffmpeg, dir, &tutti, &parziale) {
        Ok(()) => tutti,
        Err(primo) => {
            log::warn!("Ricomposizione di {:?}: {} — provo i pezzi uno per uno", dir, primo);
            let buoni: Vec<PathBuf> = tutti.into_iter().filter(|p| leggibile(ffmpeg, p)).collect();
            if buoni.is_empty() {
                return Err(format!("nessun pezzo leggibile ({})", primo));
            }
            unisci(ffmpeg, dir, &buoni, &parziale)?;
            buoni
        }
    };
    let ultimo = usati
        .last()
        .and_then(|p| std::fs::metadata(p).ok()?.modified().ok());
    std::fs::rename(&parziale, dir.join(AUDIO)).map_err(|e| format!("audio.mp4: {}", e))?;
    chiudi_metadata(dir, usati.len(), ultimo)?;
    if let Err(e) = std::fs::remove_dir_all(dir.join(CHECKPOINTS)) {
        log::warn!("Pezzi di {:?} non buttati: {}", dir, e);
    }
    Ok(usati.len())
}

/// Guarda tutte le cartelle sotto `radice` e ricompone le interrotte. Non fa
/// niente se l'app sta registrando, o se un'altra ricomposizione e' in corso.
/// Lavora in un filo a parte: ffmpeg puo' metterci qualche secondo.
pub async fn ricomponi_interrotte(radice: PathBuf) {
    if crate::audio::recording_commands::is_recording().await {
        return;
    }
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let Ok(_una) = UNA_ALLA_VOLTA.try_lock() else {
            return;
        };
        let Ok(elementi) = std::fs::read_dir(&radice) else {
            return;
        };
        let adesso = SystemTime::now();
        let interrotte: Vec<PathBuf> = elementi
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.is_dir() && da_ricomporre(p, adesso))
            .collect();
        if interrotte.is_empty() {
            return;
        }
        let Some(ffmpeg) = crate::audio::ffmpeg::find_ffmpeg_path() else {
            log::warn!("Registrazioni interrotte da ricomporre, ma ffmpeg non c'e'");
            return;
        };
        for dir in interrotte {
            match ricomponi(&ffmpeg, &dir) {
                Ok(n) => log::info!("Ricomposta {:?}: {} pezzi", dir, n),
                Err(e) => log::warn!("Non ricomposta {:?}: {}", dir, e),
            }
        }
    })
    .await;
}

#[cfg(test)]
mod prove {
    use super::*;

    /// Una cartella finta sotto la cartella temporanea, con i file dati.
    fn cartella(nome: &str, stato: &str, pezzi: usize, con_audio: bool) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ricomponi-{}-{}", nome, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(CHECKPOINTS)).unwrap();
        std::fs::write(
            dir.join(METADATA),
            format!(r#"{{"status":"{}","created_at":"2026-09-25T08:24:28Z"}}"#, stato),
        )
        .unwrap();
        for i in 0..pezzi {
            std::fs::write(dir.join(CHECKPOINTS).join(format!("audio_chunk_{:05}.mp4", i)), b"x").unwrap();
        }
        if con_audio {
            std::fs::write(dir.join(AUDIO), b"x").unwrap();
        }
        dir
    }

    fn fra_un_ora() -> SystemTime {
        SystemTime::now() + Duration::from_secs(3600)
    }

    #[test]
    fn l_interrotta_vecchia_si_ricompone() {
        let dir = cartella("vecchia", "recording", 3, false);
        assert!(da_ricomporre(&dir, fra_un_ora()));
    }

    #[test]
    fn quella_che_sta_scrivendo_no() {
        let dir = cartella("viva", "recording", 3, false);
        assert!(!da_ricomporre(&dir, SystemTime::now()));
    }

    #[test]
    fn con_l_audio_gia_fatto_no() {
        let dir = cartella("fatta", "recording", 3, true);
        assert!(!da_ricomporre(&dir, fra_un_ora()));
    }

    #[test]
    fn chiusa_bene_no() {
        let dir = cartella("chiusa", "completed", 3, false);
        assert!(!da_ricomporre(&dir, fra_un_ora()));
    }

    #[test]
    fn senza_pezzi_no() {
        let dir = cartella("vuota", "recording", 0, false);
        assert!(!da_ricomporre(&dir, fra_un_ora()));
    }

    #[test]
    fn il_metadata_si_chiude_con_l_ora_dell_ultimo_pezzo() {
        let dir = cartella("metadata", "recording", 9, false);
        // l'ultimo pezzo scritto 4 minuti e mezzo dopo l'inizio (08:24:28)
        let ultimo = SystemTime::UNIX_EPOCH
            + Duration::from_secs(DateTime::parse_from_rfc3339("2026-09-25T08:28:58Z").unwrap().timestamp() as u64);
        chiudi_metadata(&dir, 9, Some(ultimo)).unwrap();
        let m = leggi_metadata(&dir).unwrap();
        assert_eq!(m["status"], "completed");
        assert_eq!(m["duration_seconds"], 270.0);
        assert_eq!(m["ricomposta"], true);
        assert!(m["completed_at"].as_str().unwrap().starts_with("2026-09-25T08:28:58"));
    }

    #[test]
    fn senza_l_ora_dell_ultimo_pezzo_si_stima() {
        let dir = cartella("stima", "recording", 6, false);
        chiudi_metadata(&dir, 6, None).unwrap();
        let m = leggi_metadata(&dir).unwrap();
        assert_eq!(m["duration_seconds"], 6.0 * SECONDI_PER_PEZZO);
    }
}

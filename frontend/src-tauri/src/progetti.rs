//! Il progetto di una riunione (10-11).
//!
//! I progetti sono le cartelle di `Desktop\PROJECTS` (quelle che cominciano
//! con `_` o `.` sono raccolte, non progetti). Il progetto si sceglie prima o
//! durante la registrazione (`imposta_progetto`), e allo Stop va in coda al
//! nome della cartella: `… · 0h43 · PROGETTO-GAMMA` (`nome_riunione.rs`). Poi la
//! scelta torna «nessuno».
//!
//! A trascrizione finita il testo si COPIA nella cartella delle riunioni del
//! progetto, col nome della riunione (`<cartella>.md`): quella che il progetto
//! ha gia' (`meeting`, `meetings`, `riunioni`…, cercata fino a tre livelli),
//! se no `<progetto>\riunioni`; per un nome che non e' fra i progetti,
//! `PROJECTS\_RIUNIONI_SENZA_PROGETTO\<nome>`. L'audio e l'originale restano
//! in `meetily-recordings`: ogni scelta si puo' rifare.
//!
//! Cambiare progetto dopo (`cambia_progetto_riunione`) rinomina la cartella
//! e sposta la copia. Le regole, scelte con Greg il 10-11 pensando ai suoi
//! errori:
//! - la copia vecchia va nel Cestino di Windows solo se e' ancora uguale
//!   all'originale; se Greg l'ha modificata resta dov'e', e l'app lo dice;
//! - una copia gia' presente dove si va, diversa dall'originale, non si copre
//!   mai («ritrovata»: tornando a un progetto dopo un errore, la sua copia
//!   modificata e' ancora li');
//! - se la cartella del progetto non c'e' piu', non si cancella niente.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Runtime};

use crate::nome_riunione::{leggi, posto_libero, progetto_di};
use crate::riunioni::{cartella_registrazioni, nome_sicuro, si_trascrive, InCorso, TESTO};

const PROGETTI: &str = "PROJECTS";
pub const SENZA_PROGETTO: &str = "_RIUNIONI_SENZA_PROGETTO";
const RIUNIONI: &str = "riunioni";
/// le parole che dicono «qui dentro ci sono le riunioni»
const PAROLE_RIUNIONI: [&str; 4] = ["meeting", "riunion", "verbal", "minutes"];
/// le cartelle in cui non si scende a cercare
const SALTA: [&str; 4] = ["node_modules", ".git", "__pycache__", ".venv"];
/// i caratteri che Windows non vuole nei nomi, piu' il « · » che separa
const VIETATI: [char; 10] = ['\\', '/', ':', '*', '?', '"', '<', '>', '|', '·'];

/// La scelta per la registrazione che parte o che e' in corso.
static SCELTO: Mutex<Option<String>> = Mutex::new(None);

#[derive(Serialize)]
pub struct Progetto {
    pub nome: String,
    /// la cartella delle riunioni che ha gia', relativa al progetto
    pub cartella_riunioni: Option<String>,
}

#[derive(Serialize)]
pub struct Testo {
    /// dove sta adesso la copia, come in Esplora file; `None` = nessuna
    pub copiato_in: Option<String>,
    /// li' c'era gia' una copia di questa riunione, diversa: lasciata com'e'
    pub ritrovata: bool,
    /// la copia di prima: `nessuna`, `cestino`, `lasciata`, `sparita`
    pub vecchia: &'static str,
    pub vecchia_in: Option<String>,
}

#[derive(Serialize)]
pub struct EsitoProgetto {
    pub folder: String,
    /// `None` = la riunione non ha ancora un testo
    pub testo: Option<Testo>,
}

fn radice() -> Result<PathBuf, String> {
    let desktop = dirs::desktop_dir().ok_or_else(|| "Non trovo il Desktop.".to_string())?;
    Ok(desktop.join(PROGETTI))
}

/// Il nome pulito come lo vuole Windows; vuoto = nessun progetto.
fn pulisci(nome: Option<String>) -> Option<String> {
    let pulito: String = nome?
        .chars()
        .map(|c| if VIETATI.contains(&c) { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let pulito = pulito.trim_end_matches('.').trim().to_string();
    (!pulito.is_empty()).then_some(pulito)
}

/// La cartella delle riunioni dentro un progetto: la meno profonda il cui
/// nome contiene una delle parole, fino a tre livelli sotto.
fn cartella_riunioni(progetto: &Path) -> Option<PathBuf> {
    let mut livello = vec![progetto.to_path_buf()];
    for _ in 0..3 {
        let mut sotto = Vec::new();
        for dir in &livello {
            let Ok(elementi) = std::fs::read_dir(dir) else { continue };
            let mut figli: Vec<PathBuf> = elementi
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                .map(|e| e.path())
                .collect();
            figli.sort();
            for figlio in figli {
                let nome = figlio
                    .file_name()
                    .map(|n| n.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                if SALTA.contains(&nome.as_str()) || nome.starts_with('.') {
                    continue;
                }
                if PAROLE_RIUNIONI.iter().any(|p| nome.contains(p)) {
                    return Some(figlio);
                }
                sotto.push(figlio);
            }
        }
        livello = sotto;
    }
    None
}

/// Dove va il testo di un progetto (la cartella, non il file).
fn destinazione(nome: &str) -> Result<PathBuf, String> {
    let radice = radice()?;
    let progetto = radice.join(nome);
    if !nome.starts_with('_') && progetto.is_dir() {
        return Ok(cartella_riunioni(&progetto).unwrap_or_else(|| progetto.join(RIUNIONI)));
    }
    Ok(radice.join(SENZA_PROGETTO).join(nome))
}

/// Un percorso come lo si legge in Esplora file: da `PROJECTS` in poi.
fn mostra(p: &Path) -> String {
    let desktop = dirs::desktop_dir();
    let relativo = desktop
        .as_deref()
        .and_then(|d| p.strip_prefix(d).ok())
        .unwrap_or(p);
    relativo.to_string_lossy().replace('/', "\\")
}

fn uguali(a: &Path, b: &Path) -> bool {
    match (std::fs::read(a), std::fs::read(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

/// Copia il testo di `dir` (che si chiama `folder`) nel progetto `nome`.
/// Torna dove, e se li' c'era gia' una copia diversa (lasciata com'e').
fn copia(dir: &Path, folder: &str, nome: &str) -> Result<(String, bool), String> {
    let dove = destinazione(nome)?;
    std::fs::create_dir_all(&dove)
        .map_err(|e| format!("Non riesco a creare {}: {}", mostra(&dove), e))?;
    let originale = dir.join(TESTO);
    let file = dove.join(format!("{folder}.md"));
    if file.exists() {
        let ritrovata = !uguali(&file, &originale);
        return Ok((mostra(&dove), ritrovata));
    }
    std::fs::copy(&originale, &file)
        .map_err(|e| format!("Non riesco a copiare il testo in {}: {}", mostra(&dove), e))?;
    log::info!("Testo copiato: {:?} -> {:?}", originale, file);
    Ok((mostra(&dove), false))
}

/// Il testo di una riunione appena trascritta, nel suo progetto: lo chiama
/// `start_transcription` quando lo script ha finito. `None` = niente da fare.
pub fn copia_a_fine_trascrizione(dir: &Path, folder: &str) -> Option<Result<String, String>> {
    let nome = progetto_di(folder)?;
    let originale = dir.join(TESTO);
    if !originale.is_file() {
        return None;
    }
    Some(copia(dir, folder, &nome).and_then(|(dove, ritrovata)| {
        if !ritrovata {
            return Ok(dove);
        }
        // li' c'e' gia' un testo di questa riunione, diverso: e' di prima che
        // la si ritrascrivesse. Non si copre: il nuovo va accanto, ` (2)`.
        let cartella = destinazione(&nome)?;
        let mut n = 2;
        let file = loop {
            let f = cartella.join(format!("{folder} ({n}).md"));
            if !f.exists() {
                break f;
            }
            n += 1;
        };
        std::fs::copy(&originale, &file)
            .map_err(|e| format!("Non riesco a copiare il testo in {}: {}", mostra(&cartella), e))?;
        Ok(dove)
    }))
}

/// Allo Stop: la scelta passa alla cartella e torna «nessuno».
pub fn prendi_scelto() -> Option<String> {
    SCELTO.lock().ok().and_then(|mut s| s.take())
}

#[tauri::command]
pub async fn elenca_progetti() -> Result<Vec<Progetto>, String> {
    let radice = radice()?;
    let Ok(elementi) = std::fs::read_dir(&radice) else {
        return Ok(Vec::new());
    };
    let mut progetti: Vec<Progetto> = elementi
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| {
            let nome = e.file_name().to_string_lossy().into_owned();
            if nome.starts_with('_') || nome.starts_with('.') {
                return None;
            }
            let dir = e.path();
            let cartella_riunioni = cartella_riunioni(&dir).and_then(|c| {
                c.strip_prefix(&dir).ok().map(|r| r.to_string_lossy().replace('/', "\\"))
            });
            Some(Progetto { nome, cartella_riunioni })
        })
        .collect();
    progetti.sort_by_key(|p| p.nome.to_lowercase());
    Ok(progetti)
}

#[tauri::command]
pub async fn progetto_scelto() -> Result<Option<String>, String> {
    Ok(SCELTO.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub async fn imposta_progetto(nome: Option<String>) -> Result<(), String> {
    *SCELTO.lock().map_err(|e| e.to_string())? = pulisci(nome);
    Ok(())
}

/// Cambia il progetto di una registrazione gia' ferma: rinomina la cartella
/// e, se c'e' il testo, sposta la copia. Vedi le regole in cima al file.
#[tauri::command]
pub async fn cambia_progetto_riunione<R: Runtime>(
    app: AppHandle<R>,
    in_corso: tauri::State<'_, InCorso>,
    folder: String,
    nome: Option<String>,
) -> Result<EsitoProgetto, String> {
    let registrazioni = cartella_registrazioni(&app).await?;
    let dir = registrazioni.join(nome_sicuro(&folder)?);
    if !dir.is_dir() {
        return Err(format!(
            "«{folder}» non c'è più con questo nome: forse l'hai già cambiato. Scegli il progetto dalla riga."
        ));
    }
    if si_trascrive(&in_corso, &folder, &dir) {
        return Err("Si sta trascrivendo: il progetto si cambia quando ha finito.".into());
    }
    let nome = pulisci(nome);
    let prima = progetto_di(&folder);
    if nome == prima {
        return Ok(EsitoProgetto { folder, testo: None });
    }

    // la cartella col nome nuovo
    let base = leggi(&folder).base;
    let nuova = posto_libero(&registrazioni, &base, nome.as_deref(), Some(&folder));
    if nuova != dir {
        std::fs::rename(&dir, &nuova).map_err(|e| {
            format!("Windows non lascia rinominare la cartella (forse è aperta in Esplora file o in un lettore): {e}")
        })?;
        log::info!("Progetto cambiato: {:?} -> {:?}", dir, nuova);
    }
    let nuovo_nome = nuova
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| folder.clone());

    if !nuova.join(TESTO).is_file() {
        return Ok(EsitoProgetto { folder: nuovo_nome, testo: None });
    }

    // prima la copia nuova: se non riesce, quella vecchia resta dov'e'
    let (copiato_in, ritrovata) = match &nome {
        Some(n) => match copia(&nuova, &nuovo_nome, n) {
            Ok((dove, ritrovata)) => (Some(dove), ritrovata),
            Err(e) => {
                // si torna come prima: la cartella col suo nome, la copia
                // vecchia dov'era. L'app dice «Progetto non cambiato».
                if nuova != dir {
                    let _ = std::fs::rename(&nuova, &dir);
                }
                return Err(e);
            }
        },
        None => (None, false),
    };

    // poi la vecchia, che si chiamava col nome vecchio della cartella
    let (vecchia, vecchia_in) = match &prima {
        None => ("nessuna", None),
        Some(p) => {
            let dove = destinazione(p)?;
            let file = dove.join(format!("{folder}.md"));
            let detto = Some(mostra(&dove));
            if !file.is_file() {
                ("sparita", detto)
            } else if uguali(&file, &nuova.join(TESTO)) {
                match trash::delete(&file) {
                    Ok(()) => ("cestino", detto),
                    Err(e) => {
                        log::warn!("Copia vecchia non buttata {:?}: {}", file, e);
                        ("lasciata", detto)
                    }
                }
            } else {
                ("lasciata", detto)
            }
        }
    };

    Ok(EsitoProgetto {
        folder: nuovo_nome,
        testo: Some(Testo { copiato_in, ritrovata, vecchia, vecchia_in }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pulisce_i_nomi() {
        assert_eq!(pulisci(Some("  PROGETTO-GAMMA ".into())), Some("PROGETTO-GAMMA".into()));
        assert_eq!(pulisci(Some("a/b · c".into())), Some("a b c".into()));
        assert_eq!(pulisci(Some("  ".into())), None);
        assert_eq!(pulisci(None), None);
    }
}

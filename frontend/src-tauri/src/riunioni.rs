//! Le riunioni come stanno sul disco: una cartella per riunione dentro
//! `Music/meetily-recordings`, e dentro `audio.mp4`, `metadata.json` (li
//! scrive Meetily) e, quando i nostri script hanno trascritto,
//! `trascrizione.md` e `voci.json`.
//!
//! Tre comandi, tutti in sola lettura:
//! - `list_pending_recordings`: le cartelle con audio e senza `trascrizione.md`;
//! - `list_transcribed_recordings`: quelle con `trascrizione.md`;
//! - `read_transcript`: il testo di una.
//!
//! «Gia' trascritta» lo dice il disco, non il database dell'app (deciso il
//! 09-09): le 25 riunioni trascritte fuori da Meetily contano come pronte.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

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
) -> Result<Vec<Arretrata>, String> {
    let radice = cartella_registrazioni(&app).await?;
    let elenco = cartelle_con_audio(&radice)?
        .into_iter()
        .filter(|dir| !dir.join(TESTO).is_file())
        .map(|dir| {
            let meta = leggi_json::<Metadata>(&dir.join(METADATA)).unwrap_or_default();
            Arretrata {
                folder: nome(&dir),
                minutes: minuti(&meta),
                silent: leggi_json::<Livello>(&dir.join(LIVELLO)).map(|l| l.muta),
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

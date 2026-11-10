//! Gli apparecchi che la registrazione sta usando davvero (10-11).
//!
//! La scheda li scrive sotto il cronometro mentre registra. Non sono quelli
//! delle preferenze: il 18-09 la scelta non arrivava al motore e una
//! riunione di 37 minuti e' uscita muta, mentre la pagina mostrava un altro
//! apparecchio. Qui si prende il nome degli stream aperti
//! (`AudioStreamManager::nomi_aperti`): se Windows apre un altro microfono, o
//! se l'audio del PC non si apre e si registra il solo microfono, la scheda
//! lo dice.
//!
//! Due strade verso la pagina, perche' la scheda «registra» puo' nascere dopo
//! la partenza (si torna su Registra da un'altra pagina): l'evento
//! `apparecchi-in-uso`, mandato alla partenza prima di `recording-started`, e
//! il comando `apparecchi_in_uso`, che la pagina chiama quando la scheda nasce.

use log::info;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Runtime};

/// Come arriva alla pagina: `None` = quell'apparecchio non e' aperto.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ApparecchiInUso {
    pub microfono: Option<String>,
    pub audio_pc: Option<String>,
}

/// L'ultima coppia pubblicata; `None` fuori dalla registrazione.
static IN_USO: Mutex<Option<ApparecchiInUso>> = Mutex::new(None);

/// Tiene la coppia e la manda alla pagina. Si chiama appena gli stream sono
/// aperti, prima di `recording-started`.
pub fn pubblica<R: Runtime>(app: &AppHandle<R>, (microfono, audio_pc): (Option<String>, Option<String>)) {
    let coppia = ApparecchiInUso { microfono, audio_pc };
    info!(
        "🎛 Apparecchi aperti: microfono={:?}, audio del PC={:?} (None = non aperto)",
        coppia.microfono, coppia.audio_pc
    );
    if let Ok(mut dentro) = IN_USO.lock() {
        *dentro = Some(coppia.clone());
    }
    let _ = app.emit("apparecchi-in-uso", coppia);
}

/// Allo Stop: fuori dalla registrazione non c'e' niente da mostrare.
pub fn azzera() {
    if let Ok(mut dentro) = IN_USO.lock() {
        *dentro = None;
    }
}

/// La coppia di adesso, per la scheda che nasce a registrazione gia' partita.
#[tauri::command]
pub async fn apparecchi_in_uso() -> Result<Option<ApparecchiInUso>, String> {
    Ok(IN_USO.lock().map_err(|e| e.to_string())?.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn azzera_svuota() {
        if let Ok(mut dentro) = IN_USO.lock() {
            *dentro = Some(ApparecchiInUso {
                microfono: Some("Headset".into()),
                audio_pc: None,
            });
        }
        azzera();
        assert_eq!(*IN_USO.lock().unwrap(), None);
    }

    #[test]
    fn senza_audio_pc_arriva_null() {
        let coppia = ApparecchiInUso {
            microfono: Some("Headset (Bose QC Headphones)".into()),
            audio_pc: None,
        };
        let json = serde_json::to_value(&coppia).unwrap();
        assert_eq!(json["audio_pc"], serde_json::Value::Null);
        assert_eq!(json["microfono"], "Headset (Bose QC Headphones)");
    }
}

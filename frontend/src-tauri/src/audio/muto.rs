//! Il microfono spento mentre registra (10-11).
//!
//! Greg in ufficio: la gente intorno parla sopra la riunione. Col microfono
//! spento, nella registrazione (e nel testo dal vivo) il microfono e' silenzio
//! e resta solo l'audio del PC. Lo spegnimento sta nella catena dell'audio
//! (`pipeline.rs`), subito dopo la misura dei livelli: il microfono non si
//! chiude, e per questo il motore continua a sentirlo.
//!
//! La guardia: se a microfono spento il livello resta sopra `SOGLIA` per circa
//! `PASSI_PER_AVVISO` decimi di secondo (contati al netto: un decimo sotto ne
//! toglie uno), Greg forse sta parlando senza accorgersene. Allora parte un
//! avviso, al piu' uno ogni `PAUSA`. Non sa distinguere la sua voce da quella
//! di un collega vicino: per questo avvisa e basta, non riaccende niente.
//!
//! Ogni registrazione parte col microfono acceso (`azzera`, allo Start e allo
//! Stop).

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

static MUTO: AtomicBool = AtomicBool::new(false);

/// Il livello efficace sopra cui «qualcuno parla vicino al microfono». Il
/// microfono arriva gia' normalizzato; il parlato sta fra 0,02 e 0,1, una
/// voce vicina sopra 0,035 (circa -29 dB). Da ritoccare se avvisa troppo o
/// troppo poco.
pub const SOGLIA: f32 = 0.035;
/// quanti decimi di secondo (al netto) sopra la soglia prima di avvisare
pub const PASSI_PER_AVVISO: u32 = 12;
/// il silenzio fra un avviso e il successivo
pub const PAUSA: Duration = Duration::from_secs(30);

pub fn e_muto() -> bool {
    MUTO.load(Ordering::Relaxed)
}

/// Microfono acceso: allo Start e allo Stop di ogni registrazione.
pub fn azzera() {
    MUTO.store(false, Ordering::Relaxed);
}

#[tauri::command]
pub async fn imposta_muto(muto: bool) -> Result<(), String> {
    MUTO.store(muto, Ordering::Relaxed);
    log::info!("Microfono {}", if muto { "spento" } else { "riacceso" });
    Ok(())
}

#[tauri::command]
pub async fn microfono_muto() -> Result<bool, String> {
    Ok(e_muto())
}

/// La guardia del microfono spento: riceve il livello del microfono vero
/// dieci volte al secondo e dice quando avvisare.
#[derive(Default)]
pub struct GuardiaMuto {
    sopra: u32,
    ultimo_avviso: Option<Instant>,
}

impl GuardiaMuto {
    /// `true` = adesso va dato l'avviso.
    pub fn ascolta(&mut self, muto: bool, livello: f32) -> bool {
        if !muto {
            self.sopra = 0;
            return false;
        }
        self.sopra = if livello > SOGLIA { self.sopra + 1 } else { self.sopra.saturating_sub(1) };
        if self.sopra < PASSI_PER_AVVISO {
            return false;
        }
        self.sopra = 0;
        let presto = self.ultimo_avviso.map(|t| t.elapsed() < PAUSA).unwrap_or(false);
        if presto {
            return false;
        }
        self.ultimo_avviso = Some(Instant::now());
        true
    }
}

#[cfg(test)]
mod prove {
    use super::*;

    #[test]
    fn avvisa_solo_se_spento_e_si_parla_a_lungo() {
        let mut g = GuardiaMuto::default();
        for _ in 0..50 {
            assert!(!g.ascolta(false, 0.2));
        }
        for _ in 0..(PASSI_PER_AVVISO - 1) {
            assert!(!g.ascolta(true, 0.2));
        }
        assert!(g.ascolta(true, 0.2));
        // subito dopo, anche parlando ancora, tace per la pausa
        for _ in 0..(PASSI_PER_AVVISO * 3) {
            assert!(!g.ascolta(true, 0.2));
        }
    }

    #[test]
    fn i_rumori_brevi_non_bastano() {
        let mut g = GuardiaMuto::default();
        for _ in 0..200 {
            assert!(!g.ascolta(true, 0.2));
            assert!(!g.ascolta(true, 0.0));
        }
    }
}

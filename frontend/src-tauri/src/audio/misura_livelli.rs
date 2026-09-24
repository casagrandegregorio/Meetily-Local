//! I due livelli mentre registra: quanto forte entra il microfono e quanto
//! forte entra l'audio del PC, misurati separatamente.
//!
//! Perche' esiste (24-09): la scheda mostrava una fila sola di barrette, e
//! quella fila era il microfono. Guardandola non si poteva sapere se anche la
//! voce degli altri — quella che su Teams arriva dall'audio del PC — stesse
//! entrando davvero. Il 18-09 una riunione e' uscita muta proprio per questo.
//!
//! Dove sta attaccata: dentro la catena dell'audio (`pipeline.rs`), nel punto
//! in cui le due sorgenti ci sono ancora separate, subito **prima** che il
//! mescolatore ne faccia una cosa sola. E' lo stesso audio che finisce nella
//! registrazione, quindi le barrette dicono la verita' su cosa va su disco, e
//! non si apre un secondo ascolto degli stessi apparecchi.
//!
//! Come parla: `manda(microfono, audio_pc)` ogni `PASSO`, coi due livelli
//! efficaci (RMS, 0-1) del tratto appena passato. Chi la usa decide cosa farne
//! (qui: un evento per la pagina).

use std::time::{Duration, Instant};

/// Ogni quanto si mandano i due livelli alla pagina. Dieci volte al secondo:
/// le barrette scorrono senza far lavorare la pagina per niente.
pub const PASSO: Duration = Duration::from_millis(100);

#[derive(Default)]
struct Accumulo {
    quadrati: f64,
    quanti: usize,
}

impl Accumulo {
    fn aggiungi(&mut self, campioni: &[f32]) {
        self.quadrati += campioni.iter().map(|x| (*x as f64) * (*x as f64)).sum::<f64>();
        self.quanti += campioni.len();
    }

    /// Il livello efficace del tratto accumulato, e si riparte da zero.
    fn svuota(&mut self) -> f32 {
        let livello = if self.quanti == 0 {
            0.0
        } else {
            (self.quadrati / self.quanti as f64).sqrt() as f32
        };
        self.quadrati = 0.0;
        self.quanti = 0;
        livello
    }
}

pub struct MisuraLivelli {
    microfono: Accumulo,
    audio_pc: Accumulo,
    ultimo_invio: Instant,
    manda: Box<dyn Fn(f32, f32) + Send>,
}

impl MisuraLivelli {
    pub fn new(manda: impl Fn(f32, f32) + Send + 'static) -> Self {
        Self {
            microfono: Accumulo::default(),
            audio_pc: Accumulo::default(),
            ultimo_invio: Instant::now(),
            manda: Box::new(manda),
        }
    }

    /// Un tratto in piu' di ciascuna delle due sorgenti, gia' separate.
    pub fn ascolta(&mut self, microfono: &[f32], audio_pc: &[f32]) {
        self.microfono.aggiungi(microfono);
        self.audio_pc.aggiungi(audio_pc);
        if self.ultimo_invio.elapsed() >= PASSO {
            self.ultimo_invio = Instant::now();
            let (m, p) = (self.microfono.svuota(), self.audio_pc.svuota());
            (self.manda)(m, p);
        }
    }
}

#[cfg(test)]
mod prove {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn il_livello_e_la_radice_della_media_dei_quadrati() {
        let mut a = Accumulo::default();
        a.aggiungi(&[0.5, -0.5, 0.5, -0.5]);
        assert!((a.svuota() - 0.5).abs() < 1e-6);
    }

    #[test]
    fn dopo_essersi_svuotato_riparte_da_zero() {
        let mut a = Accumulo::default();
        a.aggiungi(&[1.0, 1.0]);
        a.svuota();
        assert_eq!(a.svuota(), 0.0);
    }

    #[test]
    fn manda_le_due_sorgenti_separate() {
        let visti = Arc::new(Mutex::new(Vec::new()));
        let dentro = visti.clone();
        let mut m = MisuraLivelli::new(move |mic, pc| dentro.lock().unwrap().push((mic, pc)));
        // il passo e' 100 ms: si aspetta e poi si da' un tratto
        std::thread::sleep(PASSO);
        m.ascolta(&[0.5, -0.5], &[0.1, -0.1]);
        let visti = visti.lock().unwrap();
        assert_eq!(visti.len(), 1);
        assert!((visti[0].0 - 0.5).abs() < 1e-6);
        assert!((visti[0].1 - 0.1).abs() < 1e-6);
    }
}

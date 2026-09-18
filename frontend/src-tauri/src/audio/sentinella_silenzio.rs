//! La sentinella del silenzio: guarda l'audio che sta andando su disco e, se
//! per un minuto e mezzo non c'e' niente sopra il silenzio, lo dice.
//!
//! Perche' esiste: il 18-09 una riunione di 37 minuti e' uscita muta (l'app
//! ascoltava un apparecchio, la voce passava da un altro) e nessuno se n'e'
//! accorto fino a dopo. Greg ha chiesto un avviso «se non sente niente dopo
//! 1-2 minuti di registrazione». Questa e' quella cosa.
//!
//! Cosa guarda: i pezzi gia' mescolati (microfono + audio del PC) che il
//! salvatore scrive nel file — cioe' proprio quello che finira' nella
//! registrazione, non un monitor a parte. La misura e' la stessa dello script
//! della trascrizione (`riunione.py`, `quanta_voce`): un secondo «ha suono» se
//! il suo livello efficace (RMS) sta sopra 0,005, circa -46 dB. Una riunione
//! vera sta sopra il 94% del tempo, una muta all'1%.
//!
//! Come parla: due chiamate, `muta(secondi)` quando il silenzio dura da
//! `ATTESA`, una volta sola per ogni tratto di silenzio, e `suono()` quando
//! torna qualcosa dopo un avviso. Chi la usa decide cosa farne (una notifica
//! di Windows e la scheda).

use std::time::{Duration, Instant};

/// Il livello sotto cui un secondo e' silenzio (RMS su campioni in -1..1).
pub const SILENZIO: f32 = 0.005;
/// Quanto silenzio di fila prima di avvisare.
pub const ATTESA: Duration = Duration::from_secs(90);

pub struct SentinellaSilenzio {
    /// campioni al secondo del flusso che guarda
    frequenza: usize,
    /// i campioni del secondo in corso, finche' non sono un secondo intero
    secondo: Vec<f32>,
    /// quando e' partita la registrazione, o l'ultimo secondo con suono
    ultimo_suono: Instant,
    /// se l'avviso per questo tratto di silenzio e' gia' partito
    avvisato: bool,
    muta: Box<dyn Fn(u64) + Send>,
    suono: Box<dyn Fn() + Send>,
}

impl SentinellaSilenzio {
    pub fn new(
        frequenza: u32,
        muta: impl Fn(u64) + Send + 'static,
        suono: impl Fn() + Send + 'static,
    ) -> Self {
        Self {
            frequenza: frequenza.max(1) as usize,
            secondo: Vec::with_capacity(frequenza as usize),
            ultimo_suono: Instant::now(),
            avvisato: false,
            muta: Box::new(muta),
            suono: Box::new(suono),
        }
    }

    /// Un pezzo di audio in piu', nell'ordine in cui va su disco.
    pub fn ascolta(&mut self, campioni: &[f32]) {
        self.secondo.extend_from_slice(campioni);
        while self.secondo.len() >= self.frequenza {
            let resto = self.secondo.split_off(self.frequenza);
            let intero = std::mem::replace(&mut self.secondo, resto);
            self.un_secondo(&intero);
        }
    }

    fn un_secondo(&mut self, campioni: &[f32]) {
        let rms = (campioni.iter().map(|x| x * x).sum::<f32>() / campioni.len() as f32).sqrt();
        if rms > SILENZIO {
            self.ultimo_suono = Instant::now();
            if self.avvisato {
                self.avvisato = false;
                (self.suono)();
            }
        } else if !self.avvisato && self.ultimo_suono.elapsed() >= ATTESA {
            self.avvisato = true;
            (self.muta)(self.ultimo_suono.elapsed().as_secs());
        }
    }
}

#[cfg(test)]
mod prove {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn sentinella(frequenza: u32) -> (SentinellaSilenzio, Arc<Mutex<Vec<&'static str>>>) {
        let voci = Arc::new(Mutex::new(Vec::new()));
        let (a, b) = (voci.clone(), voci.clone());
        let s = SentinellaSilenzio::new(
            frequenza,
            move |_| a.lock().unwrap().push("muta"),
            move || b.lock().unwrap().push("suono"),
        );
        (s, voci)
    }

    #[test]
    fn il_silenzio_breve_non_avvisa() {
        let (mut s, voci) = sentinella(10);
        s.ascolta(&[0.0; 100]); // dieci secondi di silenzio, l'attesa e' 90
        assert!(voci.lock().unwrap().is_empty());
    }

    #[test]
    fn il_silenzio_lungo_avvisa_una_volta_e_il_suono_lo_chiude() {
        let (mut s, voci) = sentinella(10);
        // si finge che l'ultimo suono sia di due minuti fa
        s.ultimo_suono = Instant::now() - Duration::from_secs(120);
        s.ascolta(&[0.0; 10]);
        s.ascolta(&[0.0; 10]);
        assert_eq!(*voci.lock().unwrap(), vec!["muta"]);
        s.ascolta(&[0.1; 10]);
        assert_eq!(*voci.lock().unwrap(), vec!["muta", "suono"]);
    }

    #[test]
    fn un_secondo_si_conta_anche_a_pezzi() {
        let (mut s, _) = sentinella(10);
        s.ascolta(&[0.1; 7]);
        s.ascolta(&[0.1; 7]);
        assert_eq!(s.secondo.len(), 4);
    }
}

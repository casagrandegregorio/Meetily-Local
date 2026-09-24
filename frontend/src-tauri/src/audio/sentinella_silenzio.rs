//! La sentinella del silenzio: guarda l'audio che sta andando su disco e, se
//! negli ultimi novanta secondi non ha quasi sentito niente, lo dice.
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
//! il suo livello efficace (RMS) sta sopra 0,005, circa -46 dB.
//!
//! **La regola, cambiata il 24-09.** Prima era «novanta secondi di silenzio di
//! fila». Quel giorno una prova di 3 minuti e 45 e' uscita muta al 96% — dieci
//! secondi di suono sparsi su 225 — e la sentinella non ha mai parlato: ogni
//! rumorino le azzerava il cronometro, e il tratto piu' lungo si e' fermato a
//! 84 secondi su 90. Adesso si guarda una finestra che scorre: se negli ultimi
//! `FINESTRA` secondi il suono c'e' per meno del `QUOTA` del tempo, si avvisa.
//! E' lo stesso metro con cui `trascrivi/controlla-registrazioni.py` dichiara
//! muta una registrazione (sotto il 5%), quindi non e' una misura nuova.
//! Provata sui file veri: la prova del 24-09 avvisa al secondo 175, la riunione
//! del 30 luglio (suono all'83%) e quella del 4 settembre (94%) mai. Su una
//! registrazione muta del tutto le due regole coincidono: tutte e due a 90
//! secondi.
//!
//! Come parla: due chiamate, `muta(secondi)` la prima volta che la finestra
//! scende sotto la quota — **una volta sola**, che Greg non vuole avvisi
//! invadenti (24-09) — e `suono()` quando la finestra risale. Chi la usa decide
//! cosa farne (una notifica di Windows e la scheda).

use std::collections::VecDeque;

/// Il livello sotto cui un secondo e' silenzio (RMS su campioni in -1..1).
pub const SILENZIO: f32 = 0.005;
/// Quanti secondi guarda indietro la finestra che scorre.
pub const FINESTRA: usize = 90;
/// Sotto questa frazione di secondi con suono, nella finestra, si avvisa.
pub const QUOTA: f32 = 0.05;

pub struct SentinellaSilenzio {
    /// campioni al secondo del flusso che guarda
    frequenza: usize,
    /// i campioni del secondo in corso, finche' non sono un secondo intero
    secondo: Vec<f32>,
    /// gli ultimi `FINESTRA` secondi: vero se quel secondo aveva del suono
    finestra: VecDeque<bool>,
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
            finestra: VecDeque::with_capacity(FINESTRA),
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
        if self.finestra.len() == FINESTRA {
            self.finestra.pop_front();
        }
        self.finestra.push_back(rms > SILENZIO);

        // prima di novanta secondi non si giudica: la finestra non e' piena
        if self.finestra.len() < FINESTRA {
            return;
        }

        let con_suono = self.finestra.iter().filter(|x| **x).count();
        let quanto = con_suono as f32 / FINESTRA as f32;
        if quanto < QUOTA {
            if !self.avvisato {
                self.avvisato = true;
                (self.muta)(FINESTRA as u64);
            }
        } else if self.avvisato {
            self.avvisato = false;
            (self.suono)();
        }
    }
}

#[cfg(test)]
mod prove {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// Una sentinella a un campione al secondo: un campione = un secondo, cosi'
    /// le prove si scrivono in secondi e si leggono.
    fn sentinella() -> (SentinellaSilenzio, Arc<Mutex<Vec<&'static str>>>) {
        let voci = Arc::new(Mutex::new(Vec::new()));
        let (a, b) = (voci.clone(), voci.clone());
        let s = SentinellaSilenzio::new(
            1,
            move |_| a.lock().unwrap().push("muta"),
            move || b.lock().unwrap().push("suono"),
        );
        (s, voci)
    }

    /// un secondo di silenzio (sotto la soglia) e uno di suono
    const ZITTO: f32 = 0.0;
    const VOCE: f32 = 0.1;

    fn dai(s: &mut SentinellaSilenzio, valore: f32, quanti: usize) {
        for _ in 0..quanti {
            s.ascolta(&[valore]);
        }
    }

    #[test]
    fn prima_di_novanta_secondi_non_giudica() {
        let (mut s, voci) = sentinella();
        dai(&mut s, ZITTO, 89);
        assert!(voci.lock().unwrap().is_empty());
    }

    #[test]
    fn novanta_secondi_muti_avvisano_una_volta_sola() {
        let (mut s, voci) = sentinella();
        dai(&mut s, ZITTO, 200);
        assert_eq!(*voci.lock().unwrap(), vec!["muta"]);
    }

    /// Il caso del 24-09: qualche rumore sparso dentro il silenzio. Con la
    /// regola vecchia (silenzio di fila) non avvisava mai; qui deve avvisare.
    #[test]
    fn il_rumore_sparso_non_salva_la_registrazione() {
        let (mut s, voci) = sentinella();
        for _ in 0..4 {
            dai(&mut s, ZITTO, 29);
            dai(&mut s, VOCE, 1); // un secondo di suono ogni trenta: il 3%
        }
        assert_eq!(*voci.lock().unwrap(), vec!["muta"]);
    }

    /// Una riunione vera sta sopra il 94% del tempo: non deve mai parlare.
    #[test]
    fn una_riunione_vera_non_avvisa_mai() {
        let (mut s, voci) = sentinella();
        for _ in 0..20 {
            dai(&mut s, VOCE, 17);
            dai(&mut s, ZITTO, 3); // suono l'85% del tempo
        }
        assert!(voci.lock().unwrap().is_empty());
    }

    #[test]
    fn quando_torna_il_suono_l_avviso_si_chiude() {
        let (mut s, voci) = sentinella();
        dai(&mut s, ZITTO, 90);
        assert_eq!(*voci.lock().unwrap(), vec!["muta"]);
        dai(&mut s, VOCE, 10); // la finestra risale sopra il 5%
        assert_eq!(*voci.lock().unwrap(), vec!["muta", "suono"]);
    }

    #[test]
    fn un_secondo_si_conta_anche_a_pezzi() {
        let voci = Arc::new(Mutex::new(Vec::new()));
        let (a, b) = (voci.clone(), voci.clone());
        let mut s = SentinellaSilenzio::new(
            10,
            move |_| a.lock().unwrap().push("muta"),
            move || b.lock().unwrap().push("suono"),
        );
        s.ascolta(&[0.1; 7]);
        s.ascolta(&[0.1; 7]);
        assert_eq!(s.secondo.len(), 4);
    }
}

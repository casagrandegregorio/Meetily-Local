"use client";

// Le due file di barrette mentre registra: una per il microfono, una per
// l'audio del PC.
//
// Prima del 24-09 la scheda aveva una fila sola, presa dal monitor dei livelli
// (`useAudioLevels`), che ascoltava il solo microfono: guardandola non si
// poteva sapere se anche la voce degli altri — su Teams arriva dall'audio del
// PC — stesse entrando. Adesso i due livelli li manda il motore dall'interno
// della registrazione (`livelli-registrazione`, dieci volte al secondo), presi
// dove le due sorgenti sono ancora separate: le barrette dicono la verita' su
// cosa sta andando su disco.
//
// La scala e' quella di prima (`useBarrette`): l'RMS grezzo del parlato sta fra
// 0,02 e 0,1 e disegnato tale e quale sembra fermo, quindi si passa in decibel,
// da -50 dB (zero) a 0 dB (piena), e si tiene la storia degli ultimi nove
// valori — un piccolo tracciato che scorre.
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

const QUANTE = 9;
const FONDO_DB = -50;

export interface DueLivelli {
  /** gli ultimi nove livelli del microfono, 0-1 */
  microfono: number[];
  /** gli ultimi nove livelli dell'audio del PC, 0-1 */
  audioPc: number[];
}

export const NIENTE: DueLivelli = { microfono: [], audioPc: [] };

/** Da RMS grezzo (0-1) all'altezza della barretta (0-1), su scala in decibel. */
export function altezza(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db - FONDO_DB) / -FONDO_DB));
}

interface Arrivo {
  microfono: number;
  audio_pc: number;
}

/**
 * Le due file di barrette finche' `attivo` e' vero; fuori dalla registrazione
 * tornano vuote e il motore non manda niente.
 */
export function useLivelliRegistrazione(attivo: boolean): DueLivelli {
  const [barre, setBarre] = useState<DueLivelli>(NIENTE);

  useEffect(() => {
    if (!attivo) {
      // il ripulisci fuori dal giro del disegno, come in `useBarrette`:
      // svuotare lo stato dentro l'effetto fa ridisegnare a catena
      const t = setTimeout(() => setBarre(NIENTE), 0);
      return () => clearTimeout(t);
    }
    let via: (() => void) | undefined;
    let annullato = false;
    void (async () => {
      try {
        const smetti = await listen<Arrivo>("livelli-registrazione", (e) => {
          setBarre((prima) => ({
            microfono: [...prima.microfono, altezza(e.payload.microfono)].slice(-QUANTE),
            audioPc: [...prima.audioPc, altezza(e.payload.audio_pc)].slice(-QUANTE),
          }));
        });
        if (annullato) smetti();
        else via = smetti;
      } catch (errore) {
        console.error("Livelli della registrazione non ascoltabili:", errore);
      }
    })();
    return () => {
      annullato = true;
      via?.();
    };
  }, [attivo]);

  return barre;
}

"use client";

// Dai livelli del backend alle nove barrette.
//
// Il backend manda l'RMS grezzo (0-1): il parlato normale sta fra 0,02 e
// 0,1, che disegnato tale e quale e' una barretta piatta (15-09, «Prova il
// microfono» sembrava fermo). Qui si passa in decibel — da -50 dB (zero) a
// 0 dB (piena) — e si tiene la storia degli ultimi nove valori: cosi' le
// barrette sono un piccolo tracciato che scorre, non un valore solo.
import { useEffect, useRef, useState } from "react";

import type { AudioLevel } from "./useAudioLevels";

const QUANTE = 9;
const FONDO_DB = -50;

/** 0-1 su scala in decibel; l'apparecchio piu' forte se ce n'e' piu' d'uno. */
export function altezza(livelli: Map<string, AudioLevel>): number {
  let rms = 0;
  for (const l of livelli.values()) rms = Math.max(rms, l.rms_level);
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db - FONDO_DB) / -FONDO_DB));
}

export function useBarrette(livelli: Map<string, AudioLevel>): number[] {
  const storia = useRef<number[]>([]);
  const [barre, setBarre] = useState<number[]>([]);
  useEffect(() => {
    if (livelli.size === 0) {
      storia.current = [];
      const t = setTimeout(() => setBarre([]), 0);
      return () => clearTimeout(t);
    }
    storia.current = [...storia.current, altezza(livelli)].slice(-QUANTE);
    const copia = storia.current;
    const t = setTimeout(() => setBarre(copia), 0);
    return () => clearTimeout(t);
  }, [livelli]);
  return barre;
}

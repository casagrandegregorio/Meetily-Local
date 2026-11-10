"use client";

// I due apparecchi che la registrazione sta usando davvero, mentre registra.
//
// Non sono quelli delle preferenze: il 18-09 la scelta non arrivava al motore
// e una riunione e' uscita muta, mentre la pagina mostrava un altro
// apparecchio. I nomi li manda il motore, presi dagli apparecchi che ha
// aperto (`apparecchi_in_uso.rs`): se Windows apre un altro microfono, o se
// l'audio del PC non si apre e si registra solo il microfono, qui si vede.
//
// Due strade, perche' la scheda «registra» puo' nascere dopo la partenza
// (si torna su Registra da un'altra pagina): si chiede subito al motore
// (`apparecchi_in_uso`), e si ascolta `apparecchi-in-uso`, che il motore
// manda alla partenza e quando riapre un apparecchio staccato.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const COMANDO_APPARECCHI_IN_USO = "apparecchi_in_uso";
export const EVENTO_APPARECCHI_IN_USO = "apparecchi-in-uso";

/** Come li manda il motore: `null` = quell'apparecchio non e' aperto. */
interface Arrivo {
  microfono: string | null;
  audio_pc: string | null;
}

export interface ApparecchiInUso {
  microfono: string | null;
  /** `null`: l'audio del PC non si e' aperto, si registra solo il microfono */
  audioPc: string | null;
}

/**
 * Gli apparecchi aperti finche' `attivo` e' vero; `null` finche' il motore
 * non li ha detti (un attimo, alla partenza) e fuori dalla registrazione.
 */
export function useApparecchiInUso(attivo: boolean): ApparecchiInUso | null {
  const [inUso, setInUso] = useState<ApparecchiInUso | null>(null);

  useEffect(() => {
    if (!attivo) {
      // il ripulisci fuori dal giro del disegno, come in `useLivelliRegistrazione`
      const t = setTimeout(() => setInUso(null), 0);
      return () => clearTimeout(t);
    }
    const prendi = (a: Arrivo | null | undefined) => {
      if (a && typeof a === "object" && "microfono" in a)
        setInUso({ microfono: a.microfono ?? null, audioPc: a.audio_pc ?? null });
    };
    let via: (() => void) | undefined;
    let annullato = false;
    void (async () => {
      try {
        const smetti = await listen<Arrivo>(EVENTO_APPARECCHI_IN_USO, (e) => prendi(e.payload));
        if (annullato) smetti();
        else via = smetti;
      } catch (errore) {
        console.error("Apparecchi in uso non ascoltabili:", errore);
      }
      try {
        const adesso = await invoke<Arrivo | null>(COMANDO_APPARECCHI_IN_USO);
        if (!annullato) prendi(adesso);
      } catch (errore) {
        console.info("[apparecchi in uso] il motore non risponde", errore);
      }
    })();
    return () => {
      annullato = true;
      via?.();
    };
  }, [attivo]);

  return inUso;
}

"use client";

// I momenti della scheda che il flusso vero non raggiunge ancora, costruiti
// con dati VERI, per guardarli nel browser: `/?momento=pronta`.
//
// Il flusso vero arriva a «ferma» e «registra». Gli altri quattro vengono
// dopo lo Stop e hanno bisogno del lato Rust (l'idraulica), che non c'e'
// ancora. Vale solo nel finto: nell'app vera `?momento=` non fa niente.
//
// Qui dentro NON c'e' una riga di trascrizione: il repo e' un fork pubblico.
// Le prime righe del momento «pronta» si leggono dal disco al volo, con lo
// stesso comando `read_transcript` che usa il foglio.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { Momento } from "@/types/momento";
import { COMANDO_TESTO, leggiTurni } from "@/types/trascrizione";

import { siamoNelFinto } from "./tauri-finto";

// La riunione del 4 settembre: 94 minuti, 3 voci.
const QUATTRO_SETTEMBRE = "Meeting 2026-09-04_09-02-34_2026-09-04_07-02";

// La muta del 27 agosto: 64 minuti a -49 dB, voce nell'1% del tempo
// (`trascrivi/registrazioni.md`).
const VENTISETTE_AGOSTO = "Meeting 2026-08-27_15-02-24_2026-08-27_13-02";

// le chiavi sono i sei momenti piu' qualche variante (`registra-muta`)
const MOMENTI_FINTI: Record<string, Momento> = {
  ferma: { tipo: "ferma" },
  registra: { tipo: "registra", secondi: 12 * 60 + 34 },
  // la sentinella del silenzio che avvisa: i 90 secondi di finestra che ha
  // guardato, e dentro non c'era quasi niente (la regola nuova del 24-09)
  "registra-muta": { tipo: "registra", secondi: 12 * 60 + 34, silenzio: 90 },
  registrata: { tipo: "registrata", folder: QUATTRO_SETTEMBRE, minutes: 94 },
  // al 38%, come nella galleria 5: 36 minuti su 94
  trascrive: { tipo: "trascrive", folder: QUATTRO_SETTEMBRE, fatti: 36, totale: 94 },
  pronta: {
    tipo: "pronta",
    folder: QUATTRO_SETTEMBRE,
    minutes: 94,
    voices: 3,
    prime: [], // riempite dal disco, vedi sotto
  },
  muta: { tipo: "muta", folder: VENTISETTE_AGOSTO, minutes: 64, percentoVoce: 1 },
};

function momentoFinto(nome: string | null): Momento | null {
  if (!nome) return null;
  return MOMENTI_FINTI[nome] ?? null;
}

/**
 * Il momento chiesto con `?momento=` nella barra dell'indirizzo, o `null`.
 * Fuori dal finto risponde sempre `null`.
 */
export function useMomentoFinto(): Momento | null {
  const [momento, setMomento] = useState<Momento | null>(null);

  useEffect(() => {
    if (!siamoNelFinto()) return;
    const chiesto = momentoFinto(
      new URLSearchParams(window.location.search).get("momento"),
    );
    if (!chiesto) return;
    if (chiesto.tipo !== "pronta") {
      setMomento(chiesto);
      return;
    }
    // «pronta» vuole le prime righe: si leggono dal disco, non stanno qui
    let annullato = false;
    void (async () => {
      try {
        const testo = await invoke<string>(COMANDO_TESTO, { folder: chiesto.folder });
        if (!annullato) setMomento({ ...chiesto, prime: leggiTurni(testo).slice(0, 3) });
      } catch (errore) {
        console.info("[momenti finti] testo non leggibile, scheda senza righe", errore);
        if (!annullato) setMomento(chiesto);
      }
    })();
    return () => {
      annullato = true;
    };
  }, []);

  return momento;
}

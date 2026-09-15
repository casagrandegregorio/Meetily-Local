"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { COMANDO_TESTO, leggiTurni, type Turno } from "@/types/trascrizione";

/** Legge il testo di una riunione dal disco e lo spezza in turni. */
export function useTrascrizione(folder: string | null) {
  const [turni, setTurni] = useState<Turno[]>([]);
  /** `trascrizione.md` com'e': e' quello che si manda al riassunto */
  const [testo, setTesto] = useState<string>("");
  const [caricando, setCaricando] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    if (!folder) {
      setCaricando(false);
      return;
    }
    let annullato = false;
    void (async () => {
      try {
        const testo = await invoke<string>(COMANDO_TESTO, { folder });
        if (!annullato) {
          setTesto(testo);
          setTurni(leggiTurni(testo));
        }
      } catch (e) {
        if (!annullato) setErrore(e instanceof Error ? e.message : String(e));
      } finally {
        if (!annullato) setCaricando(false);
      }
    })();
    return () => {
      annullato = true;
    };
  }, [folder]);

  return { turni, testo, caricando, errore };
}

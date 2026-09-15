"use client";

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useLavori } from "@/contexts/LavoriContext";

import { COMANDO_TRASCRITTE, type Trascritta } from "@/types/trascritta";

/**
 * Chiede al backend quali riunioni hanno gia' un testo sul disco, dalla piu'
 * recente. Fuori da Tauri risponde `tauri-finto.ts`.
 */
export function useTrascritte() {
  const [trascritte, setTrascritte] = useState<Trascritta[]>([]);
  const [caricando, setCaricando] = useState(true);

  const ricarica = useCallback(async () => {
    try {
      const risposta = await invoke<Trascritta[]>(COMANDO_TRASCRITTE);
      const elenco = Array.isArray(risposta) ? risposta : [];
      elenco.sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
      setTrascritte(elenco);
    } catch (errore) {
      console.info("[trascritte] elenco non disponibile", errore);
      setTrascritte([]);
    } finally {
      setCaricando(false);
    }
  }, []);

  // si ricarica anche quando finisce una trascrizione (`versione` cambia)
  const { versione } = useLavori();
  useEffect(() => {
    void ricarica();
  }, [ricarica, versione]);

  return { trascritte, caricando, ricarica };
}

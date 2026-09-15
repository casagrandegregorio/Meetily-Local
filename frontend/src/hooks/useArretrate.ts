"use client";

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useLavori } from "@/contexts/LavoriContext";

import { COMANDO_ARRETRATE, type Arretrata } from "@/types/arretrata";

/**
 * Chiede al backend quali registrazioni sono sul disco senza testo.
 *
 * Fuori da Tauri (`npm run dev` nel browser) risponde `tauri-finto.ts`, cosi'
 * la schermata si guarda e si corregge senza ricompilare l'app.
 */
export function useArretrate() {
  const [arretrate, setArretrate] = useState<Arretrata[]>([]);
  const [caricando, setCaricando] = useState(true);

  const ricarica = useCallback(async () => {
    try {
      const risposta = await invoke<Arretrata[]>(COMANDO_ARRETRATE);
      setArretrate(Array.isArray(risposta) ? risposta : []);
    } catch (errore) {
      // Il comando puo' non esserci ancora (l'idraulica arriva dopo la faccia):
      // in quel caso l'elenco resta vuoto e la riga sotto la scheda sparisce.
      console.info("[arretrate] elenco non disponibile", errore);
      setArretrate([]);
    } finally {
      setCaricando(false);
    }
  }, []);

  // si ricarica anche quando finisce una trascrizione (`versione` cambia)
  const { versione } = useLavori();
  useEffect(() => {
    void ricarica();
  }, [ricarica, versione]);

  return { arretrate, caricando, ricarica };
}

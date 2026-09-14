"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { appDataDir } from "@tauri-apps/api/path";

/** Una registrazione appena chiusa, che aspetta che Greg prema TRASCRIVI. */
export interface Registrata {
  /** il nome della cartella dentro Music/meetily-recordings */
  folder: string;
  minutes: number;
}

/**
 * Lo Stop nostro, al posto di `useRecordingStop` di Meetily.
 *
 * Quello di Meetily, dopo `stop_recording`, aspetta che la trascrizione dal
 * vivo finisca, salva la riunione nel database e salta a `meeting-details`.
 * Qui no: la trascrizione **non parte da sola** (deciso l'08-09, perche' una
 * registrazione fatta per sbaglio costerebbe 8 minuti di grafica e 20 di
 * processore). Allo Stop la registrazione resta «registrata», la scheda mostra
 * TRASCRIVI, e si va avanti solo se lo chiede lui.
 *
 * Cosa fa: chiama `stop_recording` come faceva `RecordingTopBar`, e ascolta
 * `recording-stopped`, l'evento con cui il backend dice in che cartella e'
 * finito l'audio. `useRecordingStop` resta nel repo, non usato.
 */
export function useFermaRegistrazione(setIsRecording: (v: boolean) => void) {
  const [registrata, setRegistrata] = useState<Registrata | null>(null);
  // i secondi letti dall'orologio al momento dello Stop: l'evento non li porta
  const secondiAlloStop = useRef(0);

  useEffect(() => {
    let togli: (() => void) | undefined;
    void (async () => {
      togli = await listen<{ folder_path?: string; meeting_name?: string }>(
        "recording-stopped",
        (evento) => {
          const { folder_path, meeting_name } = evento.payload;
          const folder =
            folder_path?.split(/[\\/]/).filter(Boolean).pop() ?? meeting_name;
          if (!folder) {
            console.warn("[stop] recording-stopped senza cartella", evento.payload);
            return;
          }
          setRegistrata({ folder, minutes: Math.round(secondiAlloStop.current / 60) });
        },
      );
    })();
    return () => togli?.();
  }, []);

  const ferma = useCallback(
    async (secondi: number | null) => {
      secondiAlloStop.current = secondi ?? 0;
      // Prima si ferma il backend, POI si spegne la scheda: `useRecordingStateSync`
      // chiede al backend ogni secondo «stai registrando?» e rimette la scheda
      // su STOP se la risposta e' ancora si'.
      try {
        // il percorso e' quello che dava `RecordingTopBar`: il backend ci mette
        // il wav intero, oltre ai pezzi nella cartella della riunione
        const dataDir = await appDataDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        await invoke("stop_recording", {
          args: { save_path: `${dataDir}/recording-${timestamp}.wav` },
        });
      } catch (errore) {
        const msg = errore instanceof Error ? errore.message : String(errore);
        // «No recording in progress» e' innocuo su un doppio clic
        if (!msg.includes("No recording in progress")) {
          console.error("[stop] stop_recording fallito:", errore);
        }
      }
      setIsRecording(false);
    },
    [setIsRecording],
  );

  /** Toglie la scheda «registrata» (dopo TRASCRIVI o Butta). */
  const scarta = useCallback(() => setRegistrata(null), []);

  return { registrata, ferma, scarta };
}

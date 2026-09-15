"use client";

// Le trascrizioni in corso, viste da tutta l'app.
//
// Un «lavoro» nasce quando si preme TRASCRIVI — sulla scheda in Registra o su
// una riga in Da trascrivere — e vive finche' Greg non lo chiude con la x.
// Lo tiene un contesto e non la pagina, perche' si vede in due posti insieme:
// la riga sottile sotto la scheda (galleria 12, numero 2) e la riga
// dell'elenco (galleria 11, numero 1), piu' il pallino blu nella barra.
//
// Il lato Rust (`start_transcription`) lancia lo script e torna subito; qui
// si chiede a che punto e' ogni due secondi (`transcription_progress`, che
// legge `avanzamento.json` nella cartella) e si smette quando la fase e'
// una di quelle finali.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  COMANDO_AVANZAMENTO,
  COMANDO_AVVIA,
  EVENTO_FINITA,
  type Avanzamento,
  type Fase,
} from "@/types/avanzamento";

export interface Lavoro {
  folder: string;
  /** minuti di audio: servono alla stima prima che lo script li sappia */
  minutes: number;
  /** quello che dice `avanzamento.json`; `avviata` finche' non risponde */
  stato: Avanzamento;
}

const FASI_FINALI: Fase[] = ["fatto", "muta", "errore", "interrotta"];

export function finito(lavoro: Lavoro): boolean {
  return FASI_FINALI.includes(lavoro.stato.fase);
}

const OGNI_QUANTO_MS = 2000;

interface Lavori {
  lavori: Lavoro[];
  /** lancia la trascrizione; se il backend dice di no, l'errore risale */
  avvia: (folder: string, minutes: number) => Promise<void>;
  /** toglie la riga (la x): il lavoro sul disco non si tocca */
  chiudi: (folder: string) => void;
  /** cambia ogni volta che un lavoro finisce: gli elenchi si ricaricano */
  versione: number;
  /** fa ricaricare gli elenchi: dopo il Cestino, per esempio */
  segnala: () => void;
}

const Contesto = createContext<Lavori | null>(null);

function appenaAvviata(): Avanzamento {
  return {
    fase: "avviata",
    totale_minuti: null,
    iniziato_il: null,
    aggiornato_il: null,
    percento_voce: null,
    messaggio: null,
  };
}

export function LavoriProvider({ children }: { children: ReactNode }) {
  const [lavori, setLavori] = useState<Lavoro[]>([]);
  const [versione, setVersione] = useState(0);
  // una copia leggibile dentro `avvia` senza rifare la funzione a ogni cambio
  const lavoriRef = useRef(lavori);
  useEffect(() => {
    lavoriRef.current = lavori;
  }, [lavori]);

  const aggiorna = useCallback(async (folder: string) => {
    try {
      const stato = await invoke<Avanzamento | null>(COMANDO_AVANZAMENTO, { folder });
      if (!stato) return;
      setLavori((prima) =>
        prima.map((l) => (l.folder === folder ? { ...l, stato } : l)),
      );
    } catch (errore) {
      console.warn("[lavori] avanzamento non letto", folder, errore);
    }
  }, []);

  const avvia = useCallback(
    async (folder: string, minutes: number) => {
      if (lavoriRef.current.some((l) => l.folder === folder && !finito(l))) return;
      await invoke(COMANDO_AVVIA, { folder });
      setLavori((prima) => [
        ...prima.filter((l) => l.folder !== folder),
        { folder, minutes, stato: appenaAvviata() },
      ]);
    },
    [],
  );

  const chiudi = useCallback((folder: string) => {
    setLavori((prima) => prima.filter((l) => l.folder !== folder));
  }, []);

  const segnala = useCallback(() => setVersione((v) => v + 1), []);

  // ogni due secondi, per i lavori ancora aperti
  useEffect(() => {
    const aperti = lavori.filter((l) => !finito(l));
    if (aperti.length === 0) return;
    const timer = setInterval(() => {
      for (const l of aperti) void aggiorna(l.folder);
    }, OGNI_QUANTO_MS);
    return () => clearInterval(timer);
  }, [lavori, aggiorna]);

  // quando il programma finisce, in qualunque modo: un'ultima lettura, e
  // gli elenchi sanno che devono ricaricarsi
  useEffect(() => {
    let stacca: (() => void) | undefined;
    void (async () => {
      try {
        stacca = await listen<{ folder: string; ok: boolean }>(EVENTO_FINITA, (e) => {
          void aggiorna(e.payload.folder).then(() => setVersione((v) => v + 1));
        });
      } catch (errore) {
        console.warn("[lavori] non ascolto la fine", errore);
      }
    })();
    return () => stacca?.();
  }, [aggiorna]);

  const valore = useMemo(
    () => ({ lavori, avvia, chiudi, versione, segnala }),
    [lavori, avvia, chiudi, versione, segnala],
  );
  return <Contesto.Provider value={valore}>{children}</Contesto.Provider>;
}

export function useLavori(): Lavori {
  const c = useContext(Contesto);
  if (!c) throw new Error("useLavori fuori da LavoriProvider");
  return c;
}

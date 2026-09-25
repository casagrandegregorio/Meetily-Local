"use client";

// La sentinella del silenzio, vista dalla pagina: una sola per tutta l'app.
//
// Il motore (`sentinella_silenzio.rs`) manda `registrazione-muta` coi secondi
// gia' guardati quando negli ultimi 90 secondi non ha quasi sentito niente, e
// `registrazione-suono` quando torna qualcosa. Fino al 25-09 li ascoltava la
// pagina Registra: cambiando pagina l'allarme si perdeva, e tornando la
// schermata non era piu' rossa anche se la registrazione era ancora muta.
// Adesso li ascolta questo contesto, che vive sopra le pagine; la pagina
// Registra (e chiunque altro) legge `silenzio`.
//
// Qui: un avviso resta finche' non si chiude. La notifica di Windows la manda
// il motore da solo, per chi sta su Teams a tutto schermo.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

import { useRecordingState } from "@/contexts/RecordingStateContext";

interface Sentinella {
  /** da quanti secondi non sente niente; `null` se sente */
  silenzio: number | null;
}

const Contesto = createContext<Sentinella>({ silenzio: null });

export function SentinellaProvider({ children }: { children: ReactNode }) {
  const { isRecording, recordingDuration } = useRecordingState();

  // Si tiene il secondo del cronometro in cui il silenzio e' cominciato,
  // cosi' il numero cresce col cronometro: fino al 25-09 restava fermo a
  // «Da 2 min» (90 s arrotondati).
  const cronometro = useRef(0);
  useEffect(() => {
    cronometro.current = recordingDuration ?? 0;
  }, [recordingDuration]);
  const [mutaDal, setMutaDal] = useState<number | null>(null);

  useEffect(() => {
    if (!isRecording) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMutaDal(null);
      return;
    }
    let viaMuta: (() => void) | undefined;
    let viaSuono: (() => void) | undefined;
    let chiuso = false;
    (async () => {
      try {
        const muta = await listen<{ secondi: number }>("registrazione-muta", (e) => {
          setMutaDal(cronometro.current - e.payload.secondi);
          toast.error("Non sento niente", {
            id: "registrazione-muta",
            description:
              "Negli ultimi 90 secondi non e' entrato quasi niente: controlla il microfono e l'audio del PC.",
            duration: Infinity,
          });
        });
        const suono = await listen("registrazione-suono", () => {
          setMutaDal(null);
          toast.dismiss("registrazione-muta");
        });
        if (chiuso) {
          muta();
          suono();
        } else {
          viaMuta = muta;
          viaSuono = suono;
        }
      } catch (errore) {
        console.error("Sentinella del silenzio non ascoltabile:", errore);
      }
    })();
    return () => {
      chiuso = true;
      viaMuta?.();
      viaSuono?.();
      toast.dismiss("registrazione-muta");
    };
  }, [isRecording]);

  const silenzio =
    mutaDal == null ? null : Math.max(0, (recordingDuration ?? 0) - mutaDal);

  return <Contesto.Provider value={{ silenzio }}>{children}</Contesto.Provider>;
}

export function useSentinella(): Sentinella {
  return useContext(Contesto);
}

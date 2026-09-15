"use client";

// Il lettore dell'audio: uno solo per tutta l'app (galleria 13, numero 3).
//
// Suona `audio.mp4` della riunione scelta. Lo stesso lettore sta in due
// posti — il ▶ sulle righe di Trascritte e la riga in testa al foglio — e
// per questo vive in un contesto: cosi' una riunione sola suona alla volta,
// e cambiando pagina l'audio non si ferma.
//
// Il file lo da' il lato Rust (`recording_audio_path`, il percorso assoluto)
// e lo si suona con un `<audio>` attraverso `convertFileSrc`, che lo fa
// passare dall'asset protocol di Tauri (`tauri.conf.json`: lo scope copre la
// cartella Musica e Documenti, e la CSP ha `media-src`). Nel finto il
// percorso e' gia' un indirizzo del servetto sulla 3119.
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
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export const COMANDO_AUDIO = "recording_audio_path";

interface Lettore {
  /** la riunione caricata nel lettore, `null` se nessuna */
  folder: string | null;
  inPausa: boolean;
  /** secondi dall'inizio */
  tempo: number;
  /** secondi in tutto; 0 finche' il file non e' aperto */
  durata: number;
  /** carica e fa partire una riunione; se e' gia' quella, riprende */
  riproduci: (folder: string) => Promise<void>;
  pausa: () => void;
  /** riproduci-o-pausa per la riunione data */
  alterna: (folder: string) => Promise<void>;
  /** salta a un secondo della riunione caricata (o la carica, se e' un'altra) */
  salta: (folder: string, secondi: number) => Promise<void>;
  errore: string | null;
}

const Contesto = createContext<Lettore | null>(null);

export function LettoreProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [inPausa, setInPausa] = useState(true);
  const [tempo, setTempo] = useState(0);
  const [durata, setDurata] = useState(0);
  const [errore, setErrore] = useState<string | null>(null);

  // l'elemento nasce una volta sola, fuori dal DOM di React
  useEffect(() => {
    const a = new Audio();
    a.preload = "metadata";
    a.addEventListener("timeupdate", () => setTempo(a.currentTime));
    a.addEventListener("durationchange", () => setDurata(Number.isFinite(a.duration) ? a.duration : 0));
    a.addEventListener("play", () => setInPausa(false));
    a.addEventListener("pause", () => setInPausa(true));
    a.addEventListener("ended", () => setInPausa(true));
    a.addEventListener("error", () => {
      setErrore("Non riesco a leggere l'audio di questa riunione.");
      setInPausa(true);
    });
    audio.current = a;
    return () => {
      a.pause();
      a.src = "";
      audio.current = null;
    };
  }, []);

  const carica = useCallback(
    async (nuovo: string) => {
      const a = audio.current;
      if (!a) return;
      if (folder === nuovo && a.src) return;
      setErrore(null);
      setTempo(0);
      setDurata(0);
      const percorso = await invoke<string>(COMANDO_AUDIO, { folder: nuovo });
      a.src = convertFileSrc(percorso);
      setFolder(nuovo);
    },
    [folder],
  );

  const riproduci = useCallback(
    async (nuovo: string) => {
      try {
        await carica(nuovo);
        await audio.current?.play();
      } catch (e) {
        setErrore(e instanceof Error ? e.message : String(e));
      }
    },
    [carica],
  );

  const pausa = useCallback(() => audio.current?.pause(), []);

  const alterna = useCallback(
    async (nuovo: string) => {
      if (folder === nuovo && !inPausa) pausa();
      else await riproduci(nuovo);
    },
    [folder, inPausa, pausa, riproduci],
  );

  const salta = useCallback(
    async (nuovo: string, secondi: number) => {
      try {
        await carica(nuovo);
        const a = audio.current;
        if (!a) return;
        a.currentTime = Math.max(0, secondi);
        setTempo(a.currentTime);
        await a.play();
      } catch (e) {
        setErrore(e instanceof Error ? e.message : String(e));
      }
    },
    [carica],
  );

  const valore = useMemo(
    () => ({ folder, inPausa, tempo, durata, riproduci, pausa, alterna, salta, errore }),
    [folder, inPausa, tempo, durata, riproduci, pausa, alterna, salta, errore],
  );
  return <Contesto.Provider value={valore}>{children}</Contesto.Provider>;
}

export function useLettore(): Lettore {
  const c = useContext(Contesto);
  if (!c) throw new Error("useLettore fuori da LettoreProvider");
  return c;
}

/** «29:10» oppure «1:34:00» quando passa l'ora. */
export function tempoScritto(secondi: number): string {
  const s = Math.max(0, Math.floor(secondi));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(r).padStart(2, "0")}`;
}

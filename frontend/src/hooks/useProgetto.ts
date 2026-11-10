"use client";

// Il progetto della riunione (10-11): un titolo che dice di che progetto si
// parla, e il posto dove il testo arriva quando la trascrizione e' finita.
//
// Si sceglie da un menu, fra le cartelle di `Desktop\PROJECTS`: sotto la
// scheda prima e durante la registrazione, sulla scheda «Registrata», e su
// ogni riga di «Da trascrivere» e «Trascritte». Il progetto sta in coda al
// nome della cartella (`… · 0h43 · PROGETTO-GAMMA`, vedi `lib/nome-riunione.ts`).
//
// A trascrizione finita il testo si COPIA nella cartella delle riunioni del
// progetto, col nome della riunione (`<cartella>.md`): l'audio e l'originale
// restano dove sono, cosi' ogni scelta si puo' rifare. Cambiare progetto a
// una riunione gia' trascritta sposta la copia: quella vecchia va nel Cestino
// di Windows se e' ancora uguale all'originale, resta dov'e' se Greg l'ha
// modificata. Il motore dice com'e' andata (`EsitoProgetto`), e il messaggio
// ha «Annulla», che rimette il progetto di prima.
//
// Dove arriva il testo (`destinazione`): la cartella delle riunioni che il
// progetto ha gia' (il motore la cerca: `meeting`, `meetings`, `riunioni`…);
// se non ce l'ha, `<progetto>\riunioni`; se il progetto non e' fra le
// cartelle, `_RIUNIONI_SENZA_PROGETTO\<nome>`.
//
// La scelta per la registrazione che sta per partire, o che e' in corso, la
// tiene il motore (`progetto_scelto` / `imposta_progetto`). Allo Stop passa
// alla cartella e torna «nessuno»: la riunione dopo puo' essere di un altro
// progetto, e un titolo rimasto da prima la etichetterebbe sbagliata.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { useLavori } from "@/contexts/LavoriContext";
import { useLettore } from "@/contexts/LettoreContext";
import { progettoDellaCartella } from "@/lib/nome-riunione";
import { getErrorMessage } from "@/lib/utils";

export { progettoDellaCartella };

export const COMANDO_ELENCA_PROGETTI = "elenca_progetti";
export const COMANDO_PROGETTO_SCELTO = "progetto_scelto";
export const COMANDO_IMPOSTA_PROGETTO = "imposta_progetto";
/** cambia il progetto di una registrazione gia' ferma: rinomina e sposta la copia */
export const COMANDO_PROGETTO_RIUNIONE = "cambia_progetto_riunione";
export const CARTELLA_SENZA_PROGETTO = "_RIUNIONI_SENZA_PROGETTO";

const EVENTO = "progetto-cambiato";

export interface Progetto {
  /** il nome della cartella in PROJECTS */
  nome: string;
  /** la cartella delle riunioni che ha gia', relativa al progetto; `null` = nessuna */
  cartella_riunioni: string | null;
}

/** Com'e' andato un cambio di progetto, detto dal motore. */
export interface EsitoProgetto {
  /** il nome nuovo della cartella */
  folder: string;
  /** `null` = la riunione non ha ancora un testo: la copia si fa a trascrizione finita */
  testo: null | {
    /** dove sta adesso la copia, come in Esplora file; `null` = nessuna copia (progetto tolto) */
    copiato_in: string | null;
    /** li' c'era gia' una copia di questa riunione, modificata da Greg: lasciata com'e', non coperta */
    ritrovata?: boolean;
    /** la copia di prima: non c'era, nel Cestino, lasciata perche' modificata, non piu' trovata */
    vecchia: "nessuna" | "cestino" | "lasciata" | "sparita";
    vecchia_in: string | null;
  };
}

/** Dove arrivera' il testo, scritto come lo si legge in Esplora file. */
export function destinazione(nome: string, progetti: Progetto[]): string {
  const p = progetti.find((x) => x.nome === nome);
  if (!p) return `PROJECTS\\${CARTELLA_SENZA_PROGETTO}\\${nome}`;
  return `PROJECTS\\${p.nome}\\${p.cartella_riunioni ?? "riunioni"}`;
}

// Un elenco solo per tutta la pagina: «Trascritte» ha una riga per riunione,
// e ognuna chiede i progetti quando nasce. Le domande che arrivano insieme
// (entro due secondi) prendono la stessa risposta: PROJECTS si legge una
// volta, non venticinque.
let ultimo: { quando: number; elenco: Promise<Progetto[]> } | null = null;
function elencoProgetti(): Promise<Progetto[]> {
  if (ultimo && Date.now() - ultimo.quando < 2000) return ultimo.elenco;
  const elenco = invoke<Progetto[]>(COMANDO_ELENCA_PROGETTI).then((e) => (Array.isArray(e) ? e : []));
  ultimo = { quando: Date.now(), elenco };
  elenco.catch(() => (ultimo = null));
  return elenco;
}

export function useProgetto() {
  const [progetti, setProgetti] = useState<Progetto[]>([]);
  const [scelto, setScelto] = useState<string | null>(null);
  const vivo = useRef(true);

  const leggiScelto = useCallback(async () => {
    try {
      const nome = await invoke<string | null>(COMANDO_PROGETTO_SCELTO);
      if (vivo.current) setScelto(typeof nome === "string" ? nome : null);
    } catch (errore) {
      console.info("[progetto] scelta non leggibile", errore);
    }
  }, []);

  /** rilegge le cartelle di PROJECTS: il menu lo chiede quando si apre */
  const rileggi = useCallback(async () => {
    try {
      const elenco = await elencoProgetti();
      if (vivo.current) setProgetti(elenco);
    } catch (errore) {
      console.info("[progetto] PROJECTS non leggibile", errore);
    }
  }, []);

  useEffect(() => {
    vivo.current = true;
    void leggiScelto();
    void rileggi();
    const ascolta = () => void leggiScelto();
    window.addEventListener(EVENTO, ascolta);
    return () => {
      vivo.current = false;
      window.removeEventListener(EVENTO, ascolta);
    };
  }, [leggiScelto, rileggi]);

  /** la scelta per la registrazione che parte o che e' in corso */
  const scegli = useCallback(async (nome: string | null) => {
    await invoke(COMANDO_IMPOSTA_PROGETTO, { nome });
    setScelto(nome);
    window.dispatchEvent(new Event(EVENTO));
  }, []);

  return { progetti, scelto, scegli, rileggi };
}

/**
 * Il cambio di progetto di una riunione gia' ferma, da qualunque posto: la
 * scheda «Registrata» o una riga degli elenchi. Ferma il lettore se suona
 * quella riunione (Windows non rinomina una cartella con un file aperto),
 * chiede al motore, aggiorna i lavori e gli elenchi, e dice com'e' andata.
 * `poi` riceve il nome nuovo della cartella, anche dopo «Annulla».
 */
export function useCambiaProgetto() {
  const { rinomina, segnala } = useLavori();
  const { scarica } = useLettore();

  return useCallback(
    (folder: string, nome: string | null, poi?: (nuova: string) => void) =>
      cambiaProgetto({ rinomina, segnala, scarica }, folder, nome, poi),
    [rinomina, segnala, scarica],
  );
}

interface Attorno {
  rinomina: (vecchia: string, nuova: string) => void;
  segnala: () => void;
  scarica: (folder: string) => void;
}

/** Il cambio vero e proprio; «Annulla» lo richiama col progetto di prima. */
async function cambiaProgetto(
  attorno: Attorno,
  folder: string,
  nome: string | null,
  poi?: (nuova: string) => void,
): Promise<void> {
  const prima = progettoDellaCartella(folder);
  if (nome === prima) return;
  attorno.scarica(folder);
  let esito: EsitoProgetto;
  try {
    esito = await invoke<EsitoProgetto>(COMANDO_PROGETTO_RIUNIONE, { folder, nome });
  } catch (errore) {
    toast.error("Progetto non cambiato", { description: getErrorMessage(errore), duration: 8000 });
    return;
  }
  attorno.rinomina(folder, esito.folder);
  poi?.(esito.folder);
  attorno.segnala();
  racconta(esito, nome, () => void cambiaProgetto(attorno, esito.folder, prima, poi));
}

/** Il messaggio dopo un cambio: cosa e' successo al testo, e «Annulla». */
function racconta(esito: EsitoProgetto, nome: string | null, annulla: () => void) {
  const opzioni = (description?: string) => ({
    description,
    action: { label: "Annulla", onClick: annulla },
    duration: 9000,
  });
  const t = esito.testo;

  if (!t) {
    toast.success(
      nome ? `Progetto: ${nome}` : "Progetto tolto",
      opzioni(nome ? "Il testo ci arriverà a trascrizione finita." : undefined),
    );
    return;
  }
  const vecchia =
    t.vecchia === "cestino"
      ? `La copia di prima (${t.vecchia_in}) è nel Cestino di Windows.`
      : t.vecchia === "sparita"
        ? `La copia di prima (${t.vecchia_in}) non c'era più: niente da togliere.`
        : t.vecchia === "lasciata"
          ? `La copia di prima (${t.vecchia_in}) l'avevi modificata: è rimasta lì. Buttala tu, se non serve.`
          : undefined;

  if (!t.copiato_in) {
    const msg = opzioni(vecchia ?? "Il testo resta nella cartella delle registrazioni.");
    if (t.vecchia === "lasciata") toast.warning("Progetto tolto", msg);
    else toast.success("Progetto tolto", msg);
    return;
  }
  if (t.ritrovata) {
    toast.success(
      `Progetto: ${nome}`,
      opzioni(
        `In ${t.copiato_in} c'era ancora la tua copia modificata: l'ho lasciata com'è.${vecchia ? ` ${vecchia}` : ""}`,
      ),
    );
    return;
  }
  const titolo =
    t.vecchia === "cestino" ? `Testo spostato in ${t.copiato_in}` : `Testo copiato in ${t.copiato_in}`;
  if (t.vecchia === "lasciata") toast.warning(titolo, opzioni(vecchia));
  else toast.success(titolo, opzioni(vecchia));
}

// A che punto e' una trascrizione lanciata dal pulsante TRASCRIVI.
//
// Il lavoro lo fanno i nostri script Python fuori dall'app (`riunione.py`),
// lanciati dal lato Rust con `uv run`. Lo script scrive nella cartella della
// riunione `avanzamento.json` a ogni fase, e l'app lo legge da li' con
// `transcription_progress`. Questo tipo e' quel file com'e'.
//
// La fase del testo dura minuti senza che lo script scriva niente: quanto
// manca lo stima l'app dal tempo passato (`RAPPORTO_TRASCRIZIONE` in
// `momento.ts`), non lo script.
import { RAPPORTO_TRASCRIZIONE } from "./momento";

export type Fase =
  | "avviata" // `uv` sta procurando le librerie, i modelli si caricano
  | "testo" // la scheda grafica sta facendo il testo
  | "voci" // il processore sta separando chi parla
  | "fatto"
  | "muta" // niente voce dentro: non si trascrive
  | "errore"
  | "interrotta"; // il file dice «in corso» ma nessun programma sta girando

export interface Avanzamento {
  fase: Fase;
  /** minuti di audio; lo script li sa solo dalla fase `testo` in poi */
  totale_minuti: number | null;
  /** quando e' partita la fase in corso, ora locale `YYYY-MM-DDTHH:MM:SS` */
  iniziato_il: string | null;
  aggiornato_il: string | null;
  /** solo per `muta` */
  percento_voce: number | null;
  /** solo per `errore` */
  messaggio: string | null;
}

/** Il comando Tauri che lancia la trascrizione di una cartella. */
export const COMANDO_AVVIA = "start_transcription";
/** Il comando Tauri che legge `avanzamento.json`; `null` se non c'e'. */
export const COMANDO_AVANZAMENTO = "transcription_progress";
/** L'evento Tauri quando il programma finisce: `{ folder, ok }`. */
export const EVENTO_FINITA = "transcription-finished";

/**
 * Quanti minuti di audio si possono dare per fatti, stimati dal tempo passato
 * dall'inizio della fase del testo: 0,09 s di scheda grafica per ogni secondo
 * di audio. Nella fase delle voci il testo e' finito: torna `totale`.
 */
export function minutiFatti(
  stato: Avanzamento,
  totale: number,
  adesso: Date = new Date(),
): number {
  if (stato.fase === "voci" || stato.fase === "fatto") return totale;
  if (stato.fase !== "testo" || !stato.iniziato_il) return 0;
  const passati = (adesso.getTime() - new Date(stato.iniziato_il).getTime()) / 1000;
  if (!Number.isFinite(passati) || passati < 0) return 0;
  return Math.min(totale, passati / RAPPORTO_TRASCRIZIONE / 60);
}

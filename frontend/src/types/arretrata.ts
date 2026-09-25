// Una registrazione che sta sul disco ma non ha ancora un testo.
import type { Avanzamento } from "./avanzamento";
//
// «Non trascritta» lo dice il disco, non l'archivio dell'app: se dentro la
// cartella della riunione c'e' `trascrizione.md`, quella riunione e' pronta e
// non compare qui. Le 24 vecchie sono gia' state trascritte fuori dall'app, e
// rifarle costerebbe circa 54 minuti di scheda grafica per niente.
export interface Arretrata {
  /** nome della cartella dentro Music/meetily-recordings */
  folder: string;
  /** durata dell'audio, in minuti interi */
  minutes: number;
  /**
   * `true` quando dentro non c'e' praticamente voce (si trascrive lo stesso,
   * ma su richiesta); `null` se nessuno l'ha ancora misurato. Lo misura il
   * nostro script dei livelli e lo scrive in `livello.json` nella cartella;
   * il lato Rust lo legge da li'.
   */
  silent: boolean | null;
  /** quanto tempo, in percento, aveva voce dentro (da `livello.json`) */
  percento_voce: number | null;
  /**
   * L'ultimo tentativo di trascrizione, com'e' in `avanzamento.json`: e' il
   * disco a ricordare che una riunione e' uscita «muta», non la memoria
   * dell'app (15-09: riaperta l'app, la riga tornava TRASCRIVI).
   */
  esito: Avanzamento | null;
  /**
   * Rimessa insieme dai pezzi dopo che l'app si era chiusa mentre registrava
   * (`ricomponi.rs`, 25-09): gli ultimi secondi possono mancare.
   */
  ricomposta?: boolean;
}

/** Il comando Tauri che elenca le cartelle senza `trascrizione.md`. */
export const COMANDO_ARRETRATE = "list_pending_recordings";
/** Il comando Tauri che sposta una cartella nel Cestino di Windows. */
export const COMANDO_CESTINO = "trash_recording";

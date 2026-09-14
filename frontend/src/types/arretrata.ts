// Una registrazione che sta sul disco ma non ha ancora un testo.
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
}

/** Il comando Tauri che elenca le cartelle senza `trascrizione.md`. */
export const COMANDO_ARRETRATE = "list_pending_recordings";

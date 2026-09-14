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
  /** vero quando dentro non c'e' praticamente voce: si trascrive lo stesso, ma su richiesta */
  silent: boolean;
}

/** Il comando Tauri che elenca le cartelle senza `trascrizione.md`. */
export const COMANDO_ARRETRATE = "list_pending_recordings";

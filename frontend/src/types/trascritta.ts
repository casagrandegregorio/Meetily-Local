// Una riunione che ha gia' il suo testo sul disco.
//
// «Trascritta» lo dice il disco: dentro la cartella c'e' `trascrizione.md`.
// I nomi sono quelli che il riconoscimento delle voci ha messo da solo; le
// voci senza nome restano contate ma non nominate.
export interface Trascritta {
  /** nome della cartella dentro Music/meetily-recordings */
  folder: string;
  /** quando e' partita la registrazione, ISO 8601 */
  recorded_at: string;
  /** durata dell'audio, in minuti interi */
  minutes: number;
  /** quante voci diverse ha trovato il programma */
  voices: number;
  /** i nomi riconosciuti, nell'ordine in cui compaiono */
  speakers: string[];
}

/** Il comando Tauri che elenca le cartelle con `trascrizione.md`. */
export const COMANDO_TRASCRITTE = "list_transcribed_recordings";

/** «94 min» oppure «1 h 45 min» quando passa l'ora. */
export function durata(minuti: number): string {
  if (minuti < 60) return `${minuti} min`;
  const ore = Math.floor(minuti / 60);
  const resto = minuti % 60;
  return resto === 0 ? `${ore} h` : `${ore} h ${resto} min`;
}

/** «4 set» — giorno e mese. L'anno lo mette solo se non e' quello corrente. */
export function giorno(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  const stessoAnno = data.getFullYear() === new Date().getFullYear();
  return data.toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short",
    ...(stessoAnno ? {} : { year: "numeric" }),
  });
}

/**
 * Il titolo di una riunione: i nomi riconosciuti, e le voci rimaste senza
 * nome contate a parte. E' la strada 1 decisa il 09-09: niente da inventare,
 * i nomi li ha gia' messi il riconoscimento delle voci.
 */
export function chiCera(t: Trascritta): string {
  const senzaNome = t.voices - t.speakers.length;
  const voci =
    senzaNome > 0 ? `${senzaNome} ${senzaNome === 1 ? "voce" : "voci"}` : null;
  const nomi = t.speakers.join(", ");
  if (!nomi) return voci ?? "";
  return voci ? `${nomi} + ${voci}` : nomi;
}

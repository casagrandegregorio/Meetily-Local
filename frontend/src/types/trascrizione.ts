// Il testo di una riunione, un turno di parola alla volta.
//
// Sul disco sta in `trascrizione.md`, scritto dai nostri script in righe come
//
//   **[03:38] Marco:** questo carica tutti i dati in un colpo solo?
//
// Il comando `read_transcript` restituisce quel testo com'e'; a spezzarlo in
// turni ci pensa `leggiTurni`, qui sotto, cosi' il lato Rust non deve sapere
// come e' fatto il file.
export interface Turno {
  /** secondi dall'inizio della registrazione */
  at: number;
  /** chi parla: un nome riconosciuto, «Voce 3», oppure «?» */
  who: string;
  text: string;
}

/** Il comando Tauri che legge `trascrizione.md` di una cartella. */
export const COMANDO_TESTO = "read_transcript";

const RIGA_DI_TURNO = /^\*\*\[(\d{1,2}):(\d{2})\]\s+(.+?):\*\*\s*(.*)$/;

/** Da `trascrizione.md` ai turni. Le righe che non sono un turno si saltano. */
export function leggiTurni(markdown: string): Turno[] {
  const turni: Turno[] = [];
  for (const riga of markdown.split(/\r?\n/)) {
    const m = riga.match(RIGA_DI_TURNO);
    if (!m) continue;
    const text = m[4].trim();
    if (!text) continue;
    turni.push({ at: Number(m[1]) * 60 + Number(m[2]), who: m[3], text });
  }
  return turni;
}

/** «05:00» — minuti e secondi. */
export function orario(secondi: number): string {
  const mm = Math.floor(secondi / 60);
  const ss = secondi % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

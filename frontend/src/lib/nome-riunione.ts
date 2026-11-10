// Il nome della cartella di una riunione, letto per l'app (10-11).
//
// Sul disco il nome resta intero, con l'anno: `10-11-2026 · 09.07–09.50 ·
// 0h43 · PROGETTO-GAMMA`. Nell'app si legge corto: «10 nov · 09.07–09.50», e il
// progetto a parte. Le cartelle vecchie hanno altri nomi
// (`Meeting 2026-07-23_11-34-54_2026-07-23_09-34`, `audio_2026-07-23_10-43`)
// e si leggono allo stesso modo: «23 lug · 11.34».
//
// Il progetto e' l'ultimo pezzo dopo « · », in coda alla parte con data e
// ore: per tutte e tre le forme. Cambiarlo vuol dire togliere quel pezzo e
// metterne un altro (`conProgetto`); la parte con la data non si tocca mai.
// Lo stesso conto lo fa il motore (`nome_riunione.rs`).

/** Le tre forme di nome che conosciamo, ognuna con la sua parte fissa. */
const FORME: { re: RegExp; data: (m: RegExpMatchArray) => [number, number, number, number, number]; fine?: (m: RegExpMatchArray) => string | null }[] = [
  {
    // 10-11-2026 · 09.07–09.50 · 0h43   (o solo 10-11-2026 · 09.07 mentre registra)
    re: /^(\d{2})-(\d{2})-(\d{4}) · (\d{2})\.(\d{2})(?:–(\d{2})\.(\d{2}) · \d+h\d{2})?(?: \(\d+\))?/,
    data: (m) => [+m[3], +m[2], +m[1], +m[4], +m[5]],
    fine: (m) => (m[6] ? `${m[6]}.${m[7]}` : null),
  },
  {
    // Meeting 2026-07-23_11-34-54_2026-07-23_09-34 (la prima ora e' quella locale)
    re: /^Meeting (\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-\d{2}_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(?: \(\d+\))?/,
    data: (m) => [+m[1], +m[2], +m[3], +m[4], +m[5]],
  },
  {
    // audio_2026-07-23_10-43
    re: /^audio_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})(?: \(\d+\))?/,
    data: (m) => [+m[1], +m[2], +m[3], +m[4], +m[5]],
  },
];

const SEP = " · ";

export interface NomeLetto {
  /** la parte con data e ore, che non cambia mai */
  base: string;
  /** l'inizio; `null` se il nome non ha una forma conosciuta */
  inizio: Date | null;
  /** l'ora di fine, «09.50»; `null` se il nome non la dice */
  fine: string | null;
  progetto: string | null;
}

export function leggiNome(folder: string): NomeLetto {
  for (const forma of FORME) {
    const m = folder.match(forma.re);
    if (!m) continue;
    const resto = folder.slice(m[0].length);
    // dopo la parte fissa: niente, oppure « · PROGETTO»
    if (resto !== "" && !resto.startsWith(SEP)) continue;
    const [a, mese, g, h, min] = forma.data(m);
    return {
      base: m[0],
      inizio: new Date(a, mese - 1, g, h, min),
      fine: forma.fine?.(m) ?? null,
      progetto: resto ? resto.slice(SEP.length) || null : null,
    };
  }
  // un nome che non conosciamo: se ha un « · », l'ultimo pezzo e' il progetto
  const i = folder.lastIndexOf(SEP);
  return i > 0
    ? { base: folder.slice(0, i), inizio: null, fine: null, progetto: folder.slice(i + SEP.length) || null }
    : { base: folder, inizio: null, fine: null, progetto: null };
}

/** Il nome della cartella con un altro progetto (o senza, con `null`). */
export function conProgetto(folder: string, progetto: string | null): string {
  const { base } = leggiNome(folder);
  return progetto ? `${base}${SEP}${progetto}` : base;
}

/** Il progetto in coda al nome, o `null`. */
export function progettoDellaCartella(folder: string): string | null {
  return leggiNome(folder).progetto;
}

/**
 * Come si legge nell'app: «10 nov · 09.07–09.50». L'anno solo se non e'
 * quello di adesso. Un nome sconosciuto si mostra com'e'.
 */
export function quando(folder: string): string {
  const { base, inizio, fine } = leggiNome(folder);
  if (!inizio) return base;
  const stessoAnno = inizio.getFullYear() === new Date().getFullYear();
  const giorno = inizio.toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short",
    ...(stessoAnno ? {} : { year: "numeric" }),
  });
  const z = (n: number) => String(n).padStart(2, "0");
  const ora = `${z(inizio.getHours())}.${z(inizio.getMinutes())}`;
  return `${giorno} · ${ora}${fine ? `–${fine}` : ""}`;
}

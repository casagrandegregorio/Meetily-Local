"use client";

import { leggiNome, quando } from "@/lib/nome-riunione";

/**
 * «10 nov · 09.07–09.50» scritto in due toni: il giorno chiaro, l'ora piu'
 * spenta, tutti e due a cifre di larghezza fissa perche' le righe si
 * allineino in colonna. Il nome intero della cartella passandoci sopra.
 * `riserva` e' quello che si scrive se il nome non dice la data.
 */
export function Quando({ folder, riserva, spenta }: { folder: string; riserva?: string; spenta?: boolean }) {
  const testo = leggiNome(folder).inizio ? quando(folder) : (riserva ?? quando(folder));
  const [giorno, ...resto] = testo.split(" · ");
  return (
    <span
      title={folder}
      className={`inline-flex shrink-0 items-baseline gap-2 font-mono text-[14px] tracking-tight tabular-nums ${
        spenta ? "text-muted-foreground/80" : ""
      }`}
    >
      <span className={spenta ? "" : "font-medium text-foreground"}>{giorno}</span>
      {resto.length > 0 && (
        <span className={spenta ? "" : "sfuma text-muted-foreground"}>{resto.join(" · ")}</span>
      )}
    </span>
  );
}

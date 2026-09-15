"use client";

// Un lettore di markdown piccolo, per il riassunto sul foglio: titoli,
// elenchi, grassetto, paragrafi. Niente HTML dentro: il testo viene da un
// modello, e qui si disegna come testo. Meetily usa un editor intero
// (TipTap) per la stessa cosa; per un foglio da leggere basta questo.
import type { ReactNode } from "react";

/** `**grassetto**` dentro una riga. */
function inRiga(testo: string): ReactNode[] {
  const pezzi = testo.split(/(\*\*[^*]+\*\*)/g);
  return pezzi.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-semibold">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

type Blocco =
  | { tipo: "titolo"; livello: number; testo: string }
  | { tipo: "elenco"; numerato: boolean; voci: string[] }
  | { tipo: "paragrafo"; testo: string };

function aBlocchi(markdown: string): Blocco[] {
  const blocchi: Blocco[] = [];
  let paragrafo: string[] = [];
  const chiudiParagrafo = () => {
    if (paragrafo.length) {
      blocchi.push({ tipo: "paragrafo", testo: paragrafo.join(" ") });
      paragrafo = [];
    }
  };
  for (const grezza of markdown.split(/\r?\n/)) {
    const riga = grezza.trimEnd();
    const titolo = riga.match(/^(#{1,4})\s+(.*)$/);
    const puntata = riga.match(/^\s*[-*•]\s+(.*)$/);
    const numerata = riga.match(/^\s*\d+[.)]\s+(.*)$/);
    if (riga.trim() === "") {
      chiudiParagrafo();
    } else if (titolo) {
      chiudiParagrafo();
      blocchi.push({ tipo: "titolo", livello: titolo[1].length, testo: titolo[2] });
    } else if (puntata || numerata) {
      chiudiParagrafo();
      const numerato = Boolean(numerata);
      const voce = (puntata ?? numerata)![1];
      const ultimo = blocchi[blocchi.length - 1];
      if (ultimo && ultimo.tipo === "elenco" && ultimo.numerato === numerato) {
        ultimo.voci.push(voce);
      } else {
        blocchi.push({ tipo: "elenco", numerato, voci: [voce] });
      }
    } else {
      paragrafo.push(riga.trim());
    }
  }
  chiudiParagrafo();
  return blocchi;
}

export function Markdown({ testo }: { testo: string }) {
  return (
    <>
      {aBlocchi(testo).map((b, i) => {
        switch (b.tipo) {
          case "titolo":
            return (
              <h3
                key={i}
                className={`font-sans text-[11px] font-semibold tracking-[.09em] text-foglio-muted uppercase ${
                  i === 0 ? "" : "mt-5"
                }`}
              >
                {b.testo}
              </h3>
            );
          case "elenco":
            return b.numerato ? (
              <ol key={i} className="my-1 list-decimal pl-6">
                {b.voci.map((v, j) => (
                  <li key={j} className="my-0.5">
                    {inRiga(v)}
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={i} className="my-1 list-disc pl-6">
                {b.voci.map((v, j) => (
                  <li key={j} className="my-0.5">
                    {inRiga(v)}
                  </li>
                ))}
              </ul>
            );
          case "paragrafo":
            return (
              <p key={i} className="my-1">
                {inRiga(b.testo)}
              </p>
            );
        }
      })}
    </>
  );
}

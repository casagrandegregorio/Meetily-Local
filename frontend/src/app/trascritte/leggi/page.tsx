"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { Page, PageLoading } from "@/components/layout/Page";
import { Spinner } from "@/components/ui/spinner";
import { useTrascrizione } from "@/hooks/useTrascrizione";
import { useTrascritte } from "@/hooks/useTrascritte";
import { orario, type Turno } from "@/types/trascrizione";
import { useLettore } from "@/contexts/LettoreContext";
import { LettoreFoglio } from "@/app/_components/lettore/Lettore";
import { Carta, Copia, FoglioScritto } from "@/app/_components/foglio/FoglioScritto";

/** Ogni quanti secondi si mette un orario a margine del foglio. */
const OGNI = 5 * 60;

/** «4 settembre» dal nome della cartella. */
function giornoDalNome(folder: string): string {
  const m = folder.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return folder;
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("it-IT", {
    day: "numeric",
    month: "long",
  });
}

/**
 * Il foglio chiaro (galleria 10, numero 1): l'area di lettura e' una pagina di
 * carta dentro l'app scura. Testo scuro su chiaro, riga corta, il nome di chi
 * parla piccolo e grigio sopra il turno, l'orario fuori dal filo del testo —
 * uno ogni cinque minuti, non uno per riga. L'ambra qui non entra.
 */
interface Riga {
  turno: Turno;
  /** l'orario da scrivere a margine prima di questo turno, se tocca a lui */
  segno: number | null;
  /** vero se parla la stessa persona del turno prima: il nome non si ripete */
  stessoDiPrima: boolean;
}

/** Decide, turno per turno, dove va un orario a margine e dove va il nome. */
function impagina(turni: Turno[]): Riga[] {
  let prossimoSegno = 0;
  return turni.map((turno, i) => {
    const segno =
      turno.at >= prossimoSegno ? Math.floor(turno.at / OGNI) * OGNI : null;
    if (segno !== null) prossimoSegno = segno + OGNI;
    return {
      turno,
      segno,
      stessoDiPrima: i > 0 && turni[i - 1].who === turno.who,
    };
  });
}

function Foglio({ folder, turni, testo }: { folder: string; turni: Turno[]; testo: string }) {
  const lettore = useLettore();
  return (
    <Carta>
      <Copia testo={testo} nome="Testo" />
      {impagina(turni).map(({ turno, segno, stessoDiPrima }, i) => (
        <div key={i} className={stessoDiPrima ? "mt-2" : "mt-4 first:mt-0"}>
          {segno !== null && (
            // l'orario a margine si clicca: l'audio salta li' (galleria 13)
            <button
              type="button"
              onClick={() => void lettore.salta(folder, segno)}
              title="Riascolta da qui"
              className="font-sans text-[11px] text-foglio-muted underline decoration-dotted underline-offset-2 hover:text-ambra"
            >
              {orario(segno)}
            </button>
          )}
          {!stessoDiPrima && (
            <div className="font-sans text-[11px] font-semibold tracking-[.09em] text-foglio-muted uppercase">
              {turno.who}
            </div>
          )}
          <p className="m-0">{turno.text}</p>
        </div>
      ))}
    </Carta>
  );
}

type Linguetta = "testo" | "riassunto" | "note";

const LINGUETTE: { id: Linguetta; nome: string }[] = [
  { id: "testo", nome: "Testo" },
  { id: "riassunto", nome: "Riassunto" },
  { id: "note", nome: "Note" },
];

/**
 * Il foglio di una riunione: tre linguette in testa (galleria 14, numero 1,
 * piu' le Note chieste il 15-09). Testo e' la trascrizione; Riassunto e
 * Note sono fogli scritti a mano — il riassunto lo fa Claude fuori dall'app
 * (il modello locale di Meetily dava riassunti in inglese, a pezzi: tolto
 * il 15-09), le note le scrive Greg — e restano sul disco accanto al testo.
 * L'icona nell'angolo del foglio copia tutto.
 */
function LeggiContenuto() {
  const router = useRouter();
  const folder = useSearchParams().get("folder");
  const { turni, testo, caricando, errore } = useTrascrizione(folder);
  const { trascritte } = useTrascritte();
  const scheda = trascritte.find((t) => t.folder === folder);
  const [linguetta, setLinguetta] = useState<Linguetta>("testo");

  if (!folder) {
    return <PageLoading>Nessuna riunione indicata.</PageLoading>;
  }

  return (
    <Page>
      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        <button
          type="button"
          onClick={() => router.push("/trascritte")}
          aria-label="Torna alle trascritte"
          className="text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4 translate-y-0.5" />
        </button>
        <h2 className="text-base font-semibold">{giornoDalNome(folder)}</h2>
        {scheda && (
          <p className="text-sm text-muted-foreground">
            {scheda.minutes} min · {scheda.voices}{" "}
            {scheda.voices === 1 ? "voce" : "voci"}
          </p>
        )}
        <LettoreFoglio folder={folder} />
        <div className="flex gap-0.5 rounded-full bg-muted p-0.75 text-xs">
          {LINGUETTE.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLinguetta(l.id)}
              className={`rounded-full px-3.5 py-1 ${
                linguetta === l.id
                  ? "bg-ambra font-semibold text-ambra-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {l.nome}
            </button>
          ))}
        </div>
      </div>

      {linguetta === "riassunto" ? (
        <FoglioScritto
          folder={folder}
          nome="riassunto.md"
          etichetta="Riassunto"
          invito="Non c'e' ancora un riassunto. Copia il testo con l'icona nell'angolo, fallo riassumere a chi vuoi (Claude, per esempio) e incolla qui quello che torna: resta sul disco accanto al testo."
        />
      ) : linguetta === "note" ? (
        <FoglioScritto
          folder={folder}
          nome="note.md"
          etichetta="Note"
          invito="Le tue note su questa riunione: restano sul disco accanto al testo."
        />
      ) : caricando ? (
        <PageLoading>
          <Spinner size="lg" />
        </PageLoading>
      ) : errore ? (
        <PageLoading>
          <p className="max-w-md text-center text-sm text-muted-foreground">
            {errore}
          </p>
        </PageLoading>
      ) : (
        <Foglio folder={folder} turni={turni} testo={testo} />
      )}
    </Page>
  );
}

export default function Leggi() {
  return (
    <Suspense fallback={<PageLoading><Spinner size="lg" /></PageLoading>}>
      <LeggiContenuto />
    </Suspense>
  );
}

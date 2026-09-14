"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { Page, PageLoading } from "@/components/layout/Page";
import { Spinner } from "@/components/ui/spinner";
import { useTrascrizione } from "@/hooks/useTrascrizione";
import { useTrascritte } from "@/hooks/useTrascritte";
import { orario, type Turno } from "@/types/trascrizione";

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

function Foglio({ turni }: { turni: Turno[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background pt-6">
      <article className="mx-auto w-175 max-w-full rounded-t-lg bg-foglio px-9 pt-7 pb-16 font-serif text-[16px] leading-[1.75] text-foglio-foreground">
        {impagina(turni).map(({ turno, segno, stessoDiPrima }, i) => (
          <div key={i} className={stessoDiPrima ? "mt-2" : "mt-4 first:mt-0"}>
            {segno !== null && (
              <div className="font-sans text-[11px] text-foglio-muted">
                {orario(segno)}
              </div>
            )}
            {!stessoDiPrima && (
              <div className="font-sans text-[11px] font-semibold tracking-[.09em] text-foglio-muted uppercase">
                {turno.who}
              </div>
            )}
            <p className="m-0">{turno.text}</p>
          </div>
        ))}
      </article>
    </div>
  );
}

function LeggiContenuto() {
  const router = useRouter();
  const folder = useSearchParams().get("folder");
  const { turni, caricando, errore } = useTrascrizione(folder);
  const { trascritte } = useTrascritte();
  const scheda = trascritte.find((t) => t.folder === folder);

  if (!folder) {
    return <PageLoading>Nessuna riunione indicata.</PageLoading>;
  }

  return (
    <Page>
      <div className="flex items-baseline gap-3 border-b border-border px-6 py-4">
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
      </div>

      {caricando ? (
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
        <Foglio turni={turni} />
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

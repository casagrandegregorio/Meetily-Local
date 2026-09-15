"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import { Page, PageLoading } from "@/components/layout/Page";
import { Spinner } from "@/components/ui/spinner";
import { useTrascrizione } from "@/hooks/useTrascrizione";
import { useTrascritte } from "@/hooks/useTrascritte";
import { orario, type Turno } from "@/types/trascrizione";
import { useLettore } from "@/contexts/LettoreContext";
import { useConfig } from "@/contexts/ConfigContext";
import { LettoreFoglio } from "@/app/_components/lettore/Lettore";
import { Markdown } from "@/app/_components/foglio/Markdown";
import { avviaRiassunto, dimenticaRiassunto, useStatoRiassunto } from "@/lib/riassunti";

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

function Foglio({ folder, turni }: { folder: string; turni: Turno[] }) {
  const lettore = useLettore();
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background pt-6">
      <article className="mx-auto w-175 max-w-full rounded-t-lg bg-foglio px-9 pt-7 pb-16 font-serif text-[16px] leading-[1.75] text-foglio-foreground">
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
      </article>
    </div>
  );
}

/** Il foglio col riassunto sopra (galleria 14, numero 1: la linguetta Riassunto). */
function FoglioRiassunto({ markdown }: { markdown: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background pt-6">
      <article className="mx-auto w-175 max-w-full rounded-t-lg bg-foglio px-9 pt-7 pb-16 font-serif text-[16px] leading-[1.75] text-foglio-foreground">
        <Markdown testo={markdown} />
      </article>
    </div>
  );
}

/** «3 min» per quanto sta lavorando il modello. */
function daQuanto(iniziatoAlle: number, adesso: number): string {
  const s = Math.max(0, Math.floor((adesso - iniziatoAlle) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
}

type Linguetta = "testo" | "riassunto";

function LeggiContenuto() {
  const router = useRouter();
  const folder = useSearchParams().get("folder");
  const { turni, testo, caricando, errore } = useTrascrizione(folder);
  const { trascritte } = useTrascritte();
  const scheda = trascritte.find((t) => t.folder === folder);
  const { modelConfig } = useConfig();

  // Il riassunto: quello sul disco (`riassunto.md`), e quello che si sta
  // facendo adesso (`lib/riassunti.ts`, vive fuori dalla pagina).
  const [riassunto, setRiassunto] = useState<string | null>(null);
  const [linguetta, setLinguetta] = useState<Linguetta>("testo");
  const stato = useStatoRiassunto(folder);
  const [adesso, setAdesso] = useState(0);

  useEffect(() => {
    if (!folder) return;
    let annullato = false;
    void invoke<string | null>("read_summary", { folder })
      .then((r) => {
        if (!annullato) setRiassunto(r);
      })
      .catch((e) => console.info("[foglio] riassunto non letto", e));
    return () => {
      annullato = true;
    };
  }, [folder]);

  // il riassunto appena fatto prende il posto di quello letto dal disco
  // (il lavoro vive fuori da React: qui lo si raccoglie e lo si mette via)
  useEffect(() => {
    if (stato?.fase === "fatto" && folder) {
      const t = setTimeout(() => {
        setRiassunto(stato.markdown);
        setLinguetta("riassunto");
        dimenticaRiassunto(folder);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [stato, folder]);

  // l'orologio di «sta lavorando da N min»
  useEffect(() => {
    if (stato?.fase !== "lavora") return;
    const t = setInterval(() => setAdesso(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stato?.fase]);
  const inizio = stato?.fase === "lavora" ? stato.iniziatoAlle : 0;

  if (!folder) {
    return <PageLoading>Nessuna riunione indicata.</PageLoading>;
  }

  const riassumi = () => {
    if (!testo) return;
    const preferito = modelConfig.provider === "builtin-ai" ? modelConfig.model : null;
    avviaRiassunto(folder, testo, preferito);
  };

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
        {/* RIASSUMI finche' non c'e'; poi le due linguette (galleria 14 -> 1) */}
        {riassunto ? (
          <div className="flex gap-0.5 rounded-full bg-muted p-0.75 text-xs">
            {(["testo", "riassunto"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLinguetta(l)}
                className={`rounded-full px-3.5 py-1 ${
                  linguetta === l
                    ? "bg-ambra font-semibold text-ambra-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {l === "testo" ? "Testo" : "Riassunto"}
              </button>
            ))}
          </div>
        ) : stato?.fase === "lavora" ? (
          <span className="flex items-center gap-2 text-xs text-info">
            <Spinner size="sm" />
            Sta riassumendo · {adesso > 0 ? daQuanto(inizio, adesso) : "0 s"}
          </span>
        ) : (
          <span className="flex items-center gap-3">
            {stato?.fase === "errore" && (
              <span className="max-w-72 truncate text-xs text-destructive" title={stato.messaggio}>
                {stato.messaggio}
              </span>
            )}
            <button
              type="button"
              onClick={riassumi}
              disabled={!testo}
              className="rounded-full border border-ambra px-3.5 py-1 text-xs font-semibold tracking-wide text-ambra hover:bg-ambra hover:text-ambra-foreground disabled:opacity-40"
            >
              RIASSUMI
            </button>
          </span>
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
      ) : riassunto && linguetta === "riassunto" ? (
        <FoglioRiassunto markdown={riassunto} />
      ) : (
        <Foglio folder={folder} turni={turni} />
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

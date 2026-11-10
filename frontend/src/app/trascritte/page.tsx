"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { Page } from "@/components/layout/Page";
import { useTrascritte } from "@/hooks/useTrascritte";
import { chiCera, durata, giorno, type Trascritta } from "@/types/trascritta";
import { LettoreRiga } from "@/app/_components/lettore/Lettore";
import { EtichettaProgetto } from "@/app/_components/scheda/RigaProgetto";
import { Quando } from "@/app/_components/scheda/Quando";
import { useLavori } from "@/contexts/LavoriContext";
import { useLettore } from "@/contexts/LettoreContext";
import { getErrorMessage } from "@/lib/utils";

/** Il posto «Trascritte»: le riunioni che hanno gia' un testo, dalla piu' recente. */
export default function Trascritte() {
  const router = useRouter();
  const { trascritte } = useTrascritte();
  const { segnala, chiudi } = useLavori();
  const { scarica } = useLettore();
  // la riga che sta chiedendo «nel Cestino?»
  const [daConfermare, setDaConfermare] = useState<string | null>(null);

  // Il testo va nel Cestino di Windows, l'audio resta: la riunione torna in
  // Da trascrivere, e da li' si butta tutto (15-09, due passi voluti da Greg).
  const cestino = (t: Trascritta) => {
    setDaConfermare(null);
    scarica(t.folder);
    invoke("trash_transcript", { folder: t.folder })
      .then(() => {
        chiudi(t.folder);
        toast.success("Testo nel Cestino: la riunione torna in Da trascrivere", {
          description: t.folder,
          duration: 5000,
        });
        segnala();
      })
      .catch((errore) =>
        toast.error("Non ci sono riuscita", { description: getErrorMessage(errore), duration: 8000 }),
      );
  };
  const minutiTotali = trascritte.reduce((s, t) => s + t.minutes, 0);
  const oreTotali = (minutiTotali / 60).toLocaleString("it-IT", {
    maximumFractionDigits: 1,
  });

  // La cartella viaggia come `?folder=`, la stessa convenzione di
  // `meeting-details?id=`: con `output: "export"` un pezzo di via dinamico
  // vorrebbe l'elenco delle pagine a tempo di compilazione.
  const apri = (t: Trascritta) => {
    router.push(`/trascritte/leggi?folder=${encodeURIComponent(t.folder)}`);
  };

  return (
    <Page>
      <div className="flex h-full flex-col">
        <div className="flex items-baseline gap-3 border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold tracking-tight">Trascritte</h2>
          {trascritte.length > 0 && (
            <p className="font-mono text-[13px] tabular-nums text-muted-foreground">
              {trascritte.length} · {oreTotali} ore
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          {trascritte.map((t, i) => (
            // la riga si apre col clic; il ▶ dentro ferma il clic e suona
            // (galleria 13, numero 3)
            <div
              key={t.folder}
              role="button"
              tabIndex={0}
              onClick={() => apri(t)}
              onKeyDown={(e) => {
                if (e.key === "Enter") apri(t);
              }}
              title={t.folder}
              style={{ "--i": i } as CSSProperties}
              className="riga-elenco flex w-full cursor-pointer items-center gap-4 px-3 py-2.5 text-left outline-none"
            >
              <LettoreRiga folder={t.folder} />
              {/* «10 nov · 09.07–09.50 · chi c'era» e sotto il progetto (10-11) */}
              <div className="flex min-w-0 flex-1 flex-col items-start">
                <div className="flex max-w-full min-w-0 items-baseline gap-3 text-sm">
                  <Quando folder={t.folder} riserva={giorno(t.recorded_at)} />
                  <span className="sfuma min-w-0 truncate text-[14px] text-muted-foreground">{chiCera(t)}</span>
                </div>
                <EtichettaProgetto folder={t.folder} trascritta />
              </div>
              <span className="sfuma shrink-0 font-mono text-[13px] tabular-nums text-muted-foreground/80">
                {durata(t.minutes)}
              </span>
              {daConfermare === t.folder ? (
                <span
                  className="flex shrink-0 items-center gap-2 text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-muted-foreground">butto il testo?</span>
                  <button
                    type="button"
                    onClick={() => cestino(t)}
                    className="rounded-full bg-destructive px-3 py-1 font-semibold text-destructive-foreground"
                  >
                    Sì
                  </button>
                  <button
                    type="button"
                    onClick={() => setDaConfermare(null)}
                    className="rounded-full border border-border px-3 py-1 text-muted-foreground hover:text-foreground"
                  >
                    No
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDaConfermare(t.folder);
                  }}
                  aria-label="Testo nel Cestino"
                  title="Butta il testo: la riunione torna in Da trascrivere"
                  className="solo-sopra shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Page>
  );
}

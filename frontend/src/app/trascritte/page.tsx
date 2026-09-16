"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { Page } from "@/components/layout/Page";
import { useTrascritte } from "@/hooks/useTrascritte";
import { chiCera, durata, giorno, type Trascritta } from "@/types/trascritta";
import { LettoreRiga } from "@/app/_components/lettore/Lettore";
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
          <h2 className="text-base font-semibold">Trascritte</h2>
          {trascritte.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {trascritte.length} · {oreTotali} ore
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-6">
          {trascritte.map((t) => (
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
              className="flex w-full cursor-pointer items-center gap-4 border-b border-border/60 py-3 text-left last:border-b-0 hover:bg-accent/40"
            >
              <LettoreRiga folder={t.folder} />
              <span className="w-14 shrink-0 text-sm tabular-nums text-muted-foreground">
                {giorno(t.recorded_at)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {chiCera(t)}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
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
                  className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
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

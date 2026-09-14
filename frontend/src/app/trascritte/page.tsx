"use client";

import { useRouter } from "next/navigation";

import { Page } from "@/components/layout/Page";
import { useTrascritte } from "@/hooks/useTrascritte";
import { chiCera, durata, giorno, type Trascritta } from "@/types/trascritta";

/** Il posto «Trascritte»: le riunioni che hanno gia' un testo, dalla piu' recente. */
export default function Trascritte() {
  const router = useRouter();
  const { trascritte } = useTrascritte();
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
            <button
              key={t.folder}
              type="button"
              onClick={() => apri(t)}
              title={t.folder}
              className="flex w-full items-baseline gap-4 border-b border-border/60 py-3 text-left last:border-b-0 hover:bg-accent/40"
            >
              <span className="w-14 shrink-0 text-sm tabular-nums text-muted-foreground">
                {giorno(t.recorded_at)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {chiCera(t)}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {durata(t.minutes)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Page>
  );
}

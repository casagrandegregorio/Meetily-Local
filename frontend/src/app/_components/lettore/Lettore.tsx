"use client";

// Le due facce del lettore (galleria 13, numero 3): la riga in testa al
// foglio — tasto, asta, tempo — e il ▶ piccolo sulle righe di Trascritte,
// che sulla riga che suona apre un'asta corta.
import { Pause, Play } from "lucide-react";

import { tempoScritto, useLettore } from "@/contexts/LettoreContext";

/** L'asta del tempo: si clicca per saltare. */
function Asta({
  frazione,
  larghezza,
  onSalta,
}: {
  frazione: number;
  larghezza: string;
  onSalta: (frazione: number) => void;
}) {
  return (
    <div
      className={`relative h-1 cursor-pointer rounded-full bg-muted ${larghezza}`}
      role="slider"
      aria-valuenow={Math.round(frazione * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSalta(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
      }}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-ambra"
        style={{ width: `${Math.round(frazione * 100)}%` }}
      />
    </div>
  );
}

/** Il lettore in testa al foglio. */
export function LettoreFoglio({ folder }: { folder: string }) {
  const l = useLettore();
  const mio = l.folder === folder;
  const tempo = mio ? l.tempo : 0;
  const durata = mio ? l.durata : 0;
  const frazione = durata > 0 ? tempo / durata : 0;
  return (
    <div className="ml-auto flex items-center gap-2.5 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => void l.alterna(folder)}
        aria-label={mio && !l.inPausa ? "Pausa" : "Riascolta"}
        className="flex size-7.5 items-center justify-center rounded-full bg-ambra text-ambra-foreground hover:brightness-110"
      >
        {mio && !l.inPausa ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-px" />}
      </button>
      <Asta
        frazione={frazione}
        larghezza="w-55"
        onSalta={(f) => void l.salta(folder, f * durata)}
      />
      <span className="tabular-nums">
        {tempoScritto(tempo)}
        {durata > 0 ? ` / ${tempoScritto(durata)}` : ""}
      </span>
      {mio && l.errore && <span className="text-destructive">{l.errore}</span>}
    </div>
  );
}

/** Il ▶ sulla riga di Trascritte; sulla riga che suona, l'asta corta. */
export function LettoreRiga({ folder }: { folder: string }) {
  const l = useLettore();
  const mio = l.folder === folder;
  const suona = mio && !l.inPausa;
  const frazione = mio && l.durata > 0 ? l.tempo / l.durata : 0;
  return (
    <span className="flex shrink-0 items-center gap-2.5">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void l.alterna(folder);
        }}
        aria-label={suona ? "Pausa" : "Riascolta"}
        className={`flex size-6 items-center justify-center rounded-full border border-ambra ${
          suona ? "bg-ambra text-ambra-foreground" : "text-ambra hover:bg-ambra/15"
        }`}
      >
        {suona ? <Pause className="size-3" /> : <Play className="size-3 translate-x-px" />}
      </button>
      {mio && (
        <span
          className="flex items-center gap-2 text-[11px] text-ambra tabular-nums"
          onClick={(e) => e.stopPropagation()}
        >
          <Asta frazione={frazione} larghezza="w-30" onSalta={(f) => void l.salta(folder, f * l.durata)} />
          {l.errore ? (
            <span className="text-destructive" title={l.errore}>
              audio non leggibile
            </span>
          ) : (
            tempoScritto(l.tempo)
          )}
        </span>
      )}
    </span>
  );
}

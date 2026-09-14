"use client";

import type { Arretrata } from "@/types/arretrata";

interface PaginaArretrateProps {
  arretrate: Arretrata[];
  onTrascrivi: (arretrata: Arretrata) => void;
}

/** «94 min» oppure «1 h 45 min» quando passa l'ora. */
function durata(minuti: number): string {
  if (minuti < 60) return `${minuti} min`;
  const ore = Math.floor(minuti / 60);
  const resto = minuti % 60;
  return resto === 0 ? `${ore} h` : `${ore} h ${resto} min`;
}

/**
 * Il posto «Da trascrivere» (galleria 8, numero 3): una riga per
 * registrazione senza testo, il pulsante TRASCRIVI su ognuna, le mute spente
 * ma comunque premibili.
 *
 * Nata come pannello a scomparsa sotto la scheda (galleria 6); dall'08-09
 * sera e' una pagina sua, perche' Greg ha chiesto di separare il registrare
 * dal guardare le registrazioni.
 */
export function PaginaArretrate({ arretrate, onTrascrivi }: PaginaArretrateProps) {
  const minutiTotali = arretrate.reduce((somma, a) => somma + a.minutes, 0);
  // 0,09 secondi di scheda grafica per ogni secondo di audio: la misura del
  // 06-09, con il modello grande su Intel Arc.
  const minutiDiLavoro = Math.round(minutiTotali * 0.09);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline gap-3 border-b border-border px-6 py-4">
        <h2 className="text-base font-semibold">Da trascrivere</h2>
        {arretrate.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {arretrate.length} · {durata(minutiTotali)} · circa {minutiDiLavoro}{" "}
            minuti di lavoro
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">niente in attesa</p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6">
        {arretrate.map((a) => (
          <div
            key={a.folder}
            className="flex items-center gap-3 border-b border-border/60 py-3 last:border-b-0"
          >
            <div
              className={`min-w-0 flex-1 truncate text-sm ${
                a.silent ? "text-muted-foreground/60" : ""
              }`}
              title={a.folder}
            >
              {a.folder}
              {a.silent && (
                <span className="text-muted-foreground/60">
                  {" "}
                  · nessuna voce dentro
                </span>
              )}
            </div>
            <div
              className={`text-xs tabular-nums ${
                a.silent ? "text-muted-foreground/60" : "text-muted-foreground"
              }`}
            >
              {durata(a.minutes)}
            </div>
            <button
              type="button"
              onClick={() => onTrascrivi(a)}
              className={`rounded-full border px-3.5 py-1 text-xs font-semibold tracking-wide ${
                a.silent
                  ? "border-ambra/30 text-ambra/50 hover:border-ambra/60 hover:text-ambra"
                  : "border-ambra text-ambra hover:bg-ambra hover:text-ambra-foreground"
              }`}
            >
              TRASCRIVI
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

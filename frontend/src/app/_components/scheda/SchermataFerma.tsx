"use client";

import { SchedaFerma } from "./SchedaFerma";

interface SchermataFermaProps {
  onStart: () => void;
  isStarting: boolean;
}

/**
 * Il posto «Registra» prima che si registri: la scheda al centro e basta.
 *
 * Sostituisce `RecordingHero` (che resta nel repo, non usata). Le registrazioni
 * senza testo hanno un posto loro sulla barra, «Da trascrivere»: qui non c'e'
 * piu' nessuna riga che le richiami (galleria 8, numero 3).
 */
export function SchermataFerma({ onStart, isStarting }: SchermataFermaProps) {
  return (
    <div className="flex min-h-0 w-full flex-1 items-center justify-center">
      <SchedaFerma onStart={onStart} isStarting={isStarting} />
    </div>
  );
}

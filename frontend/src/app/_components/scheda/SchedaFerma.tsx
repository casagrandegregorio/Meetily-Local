"use client";

import { usePermissionCheck } from "@/hooks/usePermissionCheck";
import { usePreferenzeRegistrazione } from "@/hooks/usePreferenzeRegistrazione";
import { useTrascritte } from "@/hooks/useTrascritte";
import { Spinner } from "@/components/ui/spinner";
import { chiCera, durata, giorno } from "@/types/trascritta";

import { MenuApparecchi } from "../MenuApparecchi";

interface SchedaFermaProps {
  onStart: () => void;
  isStarting: boolean;
}

/**
 * Lo stato «ferma» della scheda al centro: il tondo ambra per partire e i due
 * apparecchi che ascoltano — due menu, gli stessi delle Impostazioni, che
 * scrivono nel file delle preferenze (Greg, 18-09: si cambiano anche da qui).
 *
 * E' la scheda della galleria 1 numero 4, col colore della galleria 2 numero 1
 * e la figura che cambia col lavoro della galleria 4 numero 2 — qui nel suo
 * primo momento. Gli altri cinque momenti (registra, registrata, trascrive,
 * pronta, muta) arrivano dopo, sulla stessa scheda.
 */
export function SchedaFerma({ onStart, isStarting }: SchedaFermaProps) {
  const { hasMicrophone } = usePermissionCheck();
  const { trascritte } = useTrascritte();
  const preferenze = usePreferenzeRegistrazione();

  const disabilitato = isStarting || !hasMicrophone;

  // L'ultima riunione con un testo, dallo stesso elenco di «Trascritte»: la
  // riga sulla scheda ha la stessa forma di quelle dell'elenco, data · chi
  // c'era · durata. Prima leggeva `useSidebar().meetings`, cioe' l'archivio
  // di Meetily, che nel finto aveva un titolo inventato.
  const ultima = trascritte[0];

  return (
    <div className="flex w-full flex-col items-center justify-center gap-4 px-6 py-10">
      <div className="flex w-117.5 max-w-full items-center gap-6 rounded-2xl border border-border bg-card px-7 py-6">
        <button
          type="button"
          onClick={onStart}
          disabled={disabilitato}
          aria-label="Registra"
          className={`flex size-27 flex-none items-center justify-center rounded-full text-sm font-bold tracking-wide transition-all duration-150 ${
            disabilitato
              ? "cursor-not-allowed bg-muted text-muted-foreground"
              : "bg-ambra text-ambra-foreground hover:scale-105 hover:ring-8 hover:ring-ambra/15 active:scale-95"
          }`}
        >
          {isStarting ? <Spinner size="lg" /> : "REGISTRA"}
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="text-lg font-medium">
            {hasMicrophone ? "Pronta a registrare" : "Nessun microfono"}
          </div>

          <MenuApparecchi preferenze={preferenze} forma="pastiglia" />

          {ultima && (
            <div className="text-sm text-muted-foreground">
              Ultima: {giorno(ultima.recorded_at)} · {chiCera(ultima)} ·{" "}
              {durata(ultima.minutes)}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

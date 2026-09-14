"use client";

import { usePathname, useRouter } from "next/navigation";
import { Circle, Hourglass, List, Settings as SettingsIcon } from "lucide-react";

import Info from "@/components/Info";
import { useArretrate } from "@/hooks/useArretrate";

interface Posto {
  via: string;
  nome: string;
  Icona: typeof Circle;
}

/** I tre posti dell'app, nell'ordine in cui stanno sulla barra. */
const POSTI: Posto[] = [
  { via: "/", nome: "Registra", Icona: Circle },
  { via: "/da-trascrivere", nome: "Da trascrivere", Icona: Hourglass },
  { via: "/trascritte", nome: "Trascritte", Icona: List },
];

/**
 * La barra stretta a sinistra, con SOLO i posti veri (galleria 8, numero 3):
 * Registra, Da trascrivere, Trascritte, e in fondo Impostazioni e
 * «informazioni su Meetily».
 *
 * Prende il posto della `Sidebar` di Meetily, che resta nel repo ma non viene
 * piu' montata. Delle sue sei icone, una sola portava in un posto diverso: la
 * casetta andava alla pagina dove sei gia', il microfono ripeteva il tondo
 * REGISTRA, il taccuino allargava soltanto la colonna. Qui ogni icona e' un
 * posto, e il posto dove sei si vede.
 */
export function BarraPosti() {
  const router = useRouter();
  const dove = usePathname();
  const { arretrate } = useArretrate();

  return (
    <nav className="flex w-18.5 shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-3">
      {POSTI.map(({ via, nome, Icona }) => {
        const qui = dove === via;
        const quante = via === "/da-trascrivere" ? arretrate.length : 0;
        return (
          <button
            key={via}
            type="button"
            onClick={() => router.push(via)}
            aria-current={qui ? "page" : undefined}
            className={`flex w-14.5 flex-col items-center gap-0.5 rounded-xl px-1 pt-2 pb-1.5 text-[10px] leading-tight transition-colors ${
              qui
                ? "bg-muted text-ambra"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <span className="relative">
              <Icona className="size-4.25" />
              {quante > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-ambra px-1 text-center text-[9px] font-bold text-ambra-foreground">
                  {quante}
                </span>
              )}
            </span>
            <span className="text-center">{nome}</span>
          </button>
        );
      })}

      <div className="mt-auto flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={() => router.push("/settings")}
          aria-current={dove === "/settings" ? "page" : undefined}
          className={`flex w-14.5 flex-col items-center gap-0.5 rounded-xl px-1 pt-2 pb-1.5 text-[10px] leading-tight transition-colors ${
            dove === "/settings"
              ? "bg-muted text-ambra"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <SettingsIcon className="size-4.25" />
          <span>Impostazioni</span>
        </button>
        <Info isCollapsed />
      </div>
    </nav>
  );
}

"use client";

import { usePathname, useRouter } from "next/navigation";
import { Circle, Hourglass, List, Settings as SettingsIcon } from "lucide-react";

import { useArretrate } from "@/hooks/useArretrate";
import { finito, useLavori } from "@/contexts/LavoriContext";
import { useRecordingState } from "@/contexts/RecordingStateContext";
import { useSentinella } from "@/contexts/SentinellaContext";
import { orario } from "@/types/trascrizione";

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
 *
 * Mentre registra, in cima c'e' il tondo ambra col pallino che pulsa e il
 * tempo (galleria 21, numero 6, scelto il 25-09): da qualunque pagina si vede
 * che sta registrando, e cliccandolo si torna su Registra. Quando la
 * sentinella non sente niente il tondo diventa rosso e respira, come la
 * schermata di Registra.
 */
export function BarraPosti() {
  const router = useRouter();
  const dove = usePathname();
  const { arretrate } = useArretrate();
  // mentre si trascrive il pallino diventa blu e conta i lavori (galleria 12)
  const inCorso = useLavori().lavori.filter((l) => !finito(l)).length;
  const { isRecording, recordingDuration } = useRecordingState();
  const { silenzio } = useSentinella();
  const muta = silenzio != null;

  return (
    <nav className="flex w-18.5 shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-3">
      {isRecording && (
        <button
          type="button"
          onClick={() => router.push("/")}
          aria-label={muta ? "Sta registrando ma non sente niente: torna su Registra" : "Sta registrando: torna su Registra"}
          title={muta ? "Non sento niente" : "Sto registrando"}
          className={`mb-2.5 flex size-13 shrink-0 flex-col items-center justify-center rounded-full text-xs/tight font-bold tabular-nums ${
            muta
              ? "allarme-respira text-allarme-foreground ring-4 ring-allarme/35"
              : "bg-ambra text-ambra-foreground ring-4 ring-ambra/20"
          }`}
        >
          <span
            className={`mb-0.5 size-1.5 animate-pulse rounded-full ${muta ? "bg-allarme-foreground" : "bg-ambra-foreground"}`}
          />
          {orario(recordingDuration ?? 0)}
        </button>
      )}
      {POSTI.map(({ via, nome, Icona }) => {
        const qui = dove === via;
        const quante = via === "/da-trascrivere" ? (inCorso || arretrate.length) : 0;
        const blu = via === "/da-trascrivere" && inCorso > 0;
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
                <span className={`absolute -top-1.5 -right-2.5 min-w-4 rounded-full px-1 text-center text-[9px] font-bold ${blu ? "bg-info text-info-foreground" : "bg-ambra text-ambra-foreground"}`}>
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
      </div>
    </nav>
  );
}

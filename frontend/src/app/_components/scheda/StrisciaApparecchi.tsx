"use client";

// I due apparecchi sotto la scheda «Pronta a registrare» (galleria 22, scelti
// il 25-09: il menu della 1, la forma della 4, la posizione della 6).
//
// Greg: «sii chiara, scrivi Microfono e Audio PC, poi di fianco il valore che
// ha, il nome tale e quale a quello di Windows». Prima le pastiglie dicevano
// «Cuffia auricolare · predefinito» e «Cuffie · predefinito»: il nome tagliato
// alla parentesi, senza dire quale era l'ingresso e quale l'uscita.
//
// Ogni riga: l'icona, cosa e' (Microfono / Audio del PC), il nome intero come
// lo scrive Windows, e «predefinito» se segue quello di Windows. Un nome
// troppo lungo sfuma al bordo e, passandoci sopra, il fumetto lo dice intero.
// Cliccando si apre il menu: in testa «Predefinito di Windows · <nome>», poi
// gli apparecchi, con la spunta su quello in uso. Scrive nel file delle
// preferenze come le Impostazioni (`usePreferenzeRegistrazione`).
import { useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, Mic, Volume2 } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PreferenzeRegistrazione } from "@/hooks/usePreferenzeRegistrazione";
import { getErrorMessage } from "@/lib/utils";

/** Se il testo dentro l'elemento e' piu' largo dell'elemento. */
function useTroppoLungo<T extends HTMLElement>(testo: string) {
  const ref = useRef<T>(null);
  const [lungo, setLungo] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const misura = () => setLungo(el.scrollWidth > el.clientWidth + 1);
    misura();
    const osserva = new ResizeObserver(misura);
    osserva.observe(el);
    return () => osserva.disconnect();
  }, [testo]);
  return { ref, lungo };
}

interface RigaProps {
  Icona: typeof Mic;
  etichetta: string;
  /** il nome scelto; `null` = segue il predefinito di Windows */
  scelto: string | null;
  /** il nome del predefinito di Windows, se si sa */
  predefinito: string | null;
  apparecchi: string[];
  disabilitato: boolean;
  onScegli: (nome: string | null) => void;
}

function RigaApparecchio({
  Icona,
  etichetta,
  scelto,
  predefinito,
  apparecchi,
  disabilitato,
  onScegli,
}: RigaProps) {
  const segue = scelto == null;
  const nome = (segue ? predefinito : scelto) ?? "—";
  const { ref, lungo } = useTroppoLungo<HTMLSpanElement>(nome);

  const riga = (
    <DropdownMenuTrigger
      disabled={disabilitato}
      className="flex w-full min-w-0 items-center gap-2 rounded-lg bg-secondary px-2.5 py-1.5 text-left text-[12.5px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ambra/40 disabled:opacity-60"
    >
      <Icona className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="w-22 shrink-0 text-muted-foreground">{etichetta}</span>
      <span
        ref={ref}
        className="min-w-0 flex-1 overflow-hidden whitespace-nowrap"
        style={
          lungo
            ? {
                maskImage: "linear-gradient(to right, #000 78%, transparent)",
                WebkitMaskImage: "linear-gradient(to right, #000 78%, transparent)",
              }
            : undefined
        }
      >
        {nome}
      </span>
      {segue && <span className="shrink-0 text-[11px] text-ambra">predefinito</span>}
      <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {/* il fumetto c'e' sempre, ma si apre solo se il nome non ci sta: se
          cambiasse l'albero la riga rinascerebbe e la misura ripartirebbe */}
      <Tooltip open={lungo ? undefined : false}>
        <TooltipTrigger asChild>{riga}</TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-90">
          {nome}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-max max-w-[min(34rem,90vw)]">
        <DropdownMenuLabel className="text-[10.5px] font-normal tracking-wider text-muted-foreground uppercase">
          {etichetta}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onScegli(null)} className="gap-2">
          <Check className={`size-3 text-ambra ${segue ? "" : "invisible"}`} />
          <span>Predefinito di Windows{predefinito ? ` · ${predefinito}` : ""}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {apparecchi.map((a) => (
          <DropdownMenuItem key={a} onSelect={() => onScegli(a)} className="gap-2">
            <Check className={`size-3 text-ambra ${scelto === a ? "" : "invisible"}`} />
            <span>{a}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function StrisciaApparecchi({ preferenze }: { preferenze: PreferenzeRegistrazione }) {
  const { prefs, ingressi, uscite, predefiniti, salvando, salva } = preferenze;
  const disabilitato = !prefs || salvando;

  const cambia = (nuove: Parameters<typeof salva>[0]) =>
    salva(nuove).catch((errore) =>
      toast.error("Non salvato", { description: getErrorMessage(errore), duration: 8000 }),
    );

  return (
    <div className="flex flex-col gap-1.5">
      <RigaApparecchio
        Icona={Mic}
        etichetta="Microfono"
        scelto={prefs?.preferred_mic_device ?? null}
        predefinito={predefiniti[0]}
        apparecchi={ingressi.map((d) => d.name)}
        disabilitato={disabilitato}
        onScegli={(nome) => void cambia({ preferred_mic_device: nome })}
      />
      <RigaApparecchio
        Icona={Volume2}
        etichetta="Audio del PC"
        scelto={prefs?.preferred_system_device ?? null}
        predefinito={predefiniti[1]}
        apparecchi={uscite.map((d) => d.name)}
        disabilitato={disabilitato}
        onScegli={(nome) => void cambia({ preferred_system_device: nome })}
      />
    </div>
  );
}

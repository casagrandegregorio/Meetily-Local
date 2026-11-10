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
// gli apparecchi, con la spunta su quello scelto. Scrive nel file delle
// preferenze come le Impostazioni (`usePreferenzeRegistrazione`). Se
// l'apparecchio scelto non c'e' piu' (le cuffie Bluetooth spente), accanto al
// nome compare in rosso «non c'e'»: REGISTRA non partirebbe.
//
// Dal 10-11 la striscia resta sotto la scheda anche mentre registra
// (`StrisciaInUso`), col nome dell'apparecchio che il motore ha aperto davvero
// e non quello delle preferenze. Se l'audio del PC non si e' aperto, la riga
// lo dice in rosso: prima si registrava il solo microfono senza che si
// vedesse. E gli apparecchi si cambiano anche mentre registra, dallo stesso
// menu: il motore chiude e riapre solo quello (`cambia_apparecchio`), con un
// buco di circa un secondo su quel canale.
import { useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
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
import type { ApparecchiInUso } from "@/hooks/useApparecchiInUso";
import {
  usePreferenzeRegistrazione,
  type PreferenzeRegistrazione,
} from "@/hooks/usePreferenzeRegistrazione";
import { getErrorMessage } from "@/lib/utils";

/** Il comando del motore che cambia un apparecchio a registrazione in corso. */
export const COMANDO_CAMBIA_APPARECCHIO = "cambia_apparecchio";

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

/** Mentre registra, la riga mostra quello che il motore ha aperto. */
interface InUsoRiga {
  /** il nome aperto davvero; `null` = il motore non l'ha ancora detto */
  nome: string | null;
  /** al posto del nome, in rosso: l'apparecchio non e' aperto */
  avviso?: string;
  /** il colore dell'icona, quello della sua fila di barrette */
  tinta: string;
  allarme: boolean;
  /** il motore sta chiudendo il vecchio e aprendo il nuovo */
  cambiando: boolean;
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
  /** quando il menu si apre: si rilegge l'elenco degli apparecchi */
  onApri: () => void;
  /** solo mentre registra */
  inUso?: InUsoRiga;
}

function RigaApparecchio({
  Icona,
  etichetta,
  scelto,
  predefinito,
  apparecchi,
  disabilitato,
  onScegli,
  onApri,
  inUso,
}: RigaProps) {
  const segue = scelto == null;
  // prima di REGISTRA la riga dice la scelta; mentre registra, quello aperto
  // (`…` finche' il motore non l'ha detto, un attimo alla partenza)
  const nome = (inUso ? (inUso.nome ?? "…") : segue ? predefinito : scelto) ?? "—";
  const cambiando = inUso?.cambiando ?? false;
  // la scelta salvata non e' fra gli apparecchi collegati; finche' l'elenco
  // non e' arrivato non si dice niente. Mentre registra non serve: la riga
  // dice gia' cosa e' aperto.
  const manca = !inUso && !segue && apparecchi.length > 0 && !apparecchi.includes(scelto);
  const { ref, lungo } = useTroppoLungo<HTMLSpanElement>(nome);

  const allarme = inUso?.allarme ?? false;
  const riga = (
    <DropdownMenuTrigger
      disabled={disabilitato}
      className={`riga-scelta flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ambra/40 disabled:opacity-60 ${
        allarme ? "bg-black/25 hover:bg-black/35" : "bg-secondary hover:bg-muted"
      }`}
    >
      <Icona className={`size-3.5 shrink-0 ${inUso ? inUso.tinta : "text-muted-foreground"}`} />
      <span
        className={`w-26 shrink-0 ${allarme ? "text-allarme-muted" : "text-muted-foreground"}`}
      >
        {etichetta}
      </span>
      {inUso?.avviso ? (
        <span className="min-w-0 flex-1 font-medium text-red-400">{inUso.avviso}</span>
      ) : (
        <span
          ref={ref}
          className={`min-w-0 flex-1 overflow-hidden whitespace-nowrap ${cambiando ? "opacity-50" : ""}`}
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
      )}
      {manca ? (
        <span className="shrink-0 text-[12.5px] font-medium text-red-400">non c&apos;è</span>
      ) : cambiando ? (
        <span className="shrink-0 text-[12.5px] text-muted-foreground">cambio…</span>
      ) : (
        segue &&
        !inUso?.avviso && <span className="shrink-0 text-[12.5px] text-ambra">predefinito</span>
      )}
      <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu onOpenChange={(aperto) => aperto && onApri()}>
      {/* il fumetto c'e' sempre, ma si apre solo se il nome non ci sta: se
          cambiasse l'albero la riga rinascerebbe e la misura ripartirebbe */}
      <Tooltip open={lungo && !inUso?.avviso ? undefined : false}>
        <TooltipTrigger asChild>{riga}</TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-90">
          {nome}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="menu-entra w-max max-w-[min(34rem,90vw)] border-white/10 bg-popover/95 shadow-2xl shadow-black/50 backdrop-blur-md">
        <DropdownMenuLabel className="text-[10.5px] font-normal tracking-wider text-muted-foreground uppercase">
          {etichetta}
          {inUso ? " · si cambia subito" : ""}
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
  const { prefs, ingressi, uscite, predefiniti, salvando, salva, rileggiApparecchi } = preferenze;
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
        onApri={rileggiApparecchi}
      />
      <RigaApparecchio
        Icona={Volume2}
        etichetta="Audio del PC"
        scelto={prefs?.preferred_system_device ?? null}
        predefinito={predefiniti[1]}
        apparecchi={uscite.map((d) => d.name)}
        disabilitato={disabilitato}
        onScegli={(nome) => void cambia({ preferred_system_device: nome })}
        onApri={rileggiApparecchi}
      />
    </div>
  );
}

type Posto = "microfono" | "audio_pc";

/**
 * Le due righe mentre registra, coi nomi che il motore ha aperto davvero
 * (`useApparecchiInUso`; `inUso` nullo = non li ha ancora detti). Un posto
 * senza apparecchio aperto lo dice in rosso, «non lo sto registrando».
 *
 * Gli stessi menu di prima di REGISTRA, ma la scelta cambia subito
 * l'apparecchio: prima si chiede al motore (`cambia_apparecchio`), e solo se
 * il nuovo si apre si scrive nel file delle preferenze. Un apparecchio che
 * non si apre non diventa la scelta, e la registrazione continua con quello
 * di prima.
 */
export function StrisciaInUso({
  inUso,
  allarme = false,
}: {
  inUso: ApparecchiInUso | null;
  allarme?: boolean;
}) {
  const { prefs, ingressi, uscite, predefiniti, salvando, salva, rileggiApparecchi } =
    usePreferenzeRegistrazione();
  const [cambiando, setCambiando] = useState<Posto | null>(null);
  const disabilitato = !prefs || salvando || cambiando != null;
  // il microfono manca solo se un cambio e' fallito e quello di prima non si
  // e' riaperto; l'audio del PC anche quando non si e' aperto alla partenza
  const senzaMicrofono = inUso != null && inUso.microfono == null;
  const senzaAudioPc = inUso != null && inUso.audioPc == null;

  const cambia = async (posto: Posto, nome: string | null) => {
    const predefinito = posto === "microfono" ? predefiniti[0] : predefiniti[1];
    const aperto = posto === "microfono" ? inUso?.microfono : inUso?.audioPc;
    const scelta = posto === "microfono" ? prefs?.preferred_mic_device : prefs?.preferred_system_device;
    // gia' aperto e gia' scelto: niente da cambiare, e niente buco sul file
    if ((nome ?? predefinito) === aperto && nome === (scelta ?? null)) return;
    const cosa = posto === "microfono" ? "Microfono" : "Audio del PC";
    setCambiando(posto);
    try {
      try {
        await invoke(COMANDO_CAMBIA_APPARECCHIO, { posto, nome });
      } catch (errore) {
        // la frase del motore dice gia' cosa sta registrando adesso
        toast.error(`${cosa} non cambiato`, { description: getErrorMessage(errore), duration: 10000 });
        return;
      }
      try {
        await salva(posto === "microfono" ? { preferred_mic_device: nome } : { preferred_system_device: nome });
      } catch (errore) {
        // l'apparecchio e' cambiato davvero: manca solo il ricordo per la prossima
        toast.warning(`${cosa} cambiato, ma la scelta non è salvata`, {
          description: `La prossima registrazione partirà con quello di prima. ${getErrorMessage(errore)}`,
          duration: 10000,
        });
      }
    } finally {
      setCambiando(null);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <RigaApparecchio
        Icona={senzaMicrofono ? MicOff : Mic}
        etichetta="Microfono"
        scelto={prefs?.preferred_mic_device ?? null}
        predefinito={predefiniti[0]}
        apparecchi={ingressi.map((d) => d.name)}
        disabilitato={disabilitato}
        onScegli={(nome) => void cambia("microfono", nome)}
        onApri={rileggiApparecchi}
        inUso={{
          nome: inUso?.microfono ?? null,
          avviso: senzaMicrofono && cambiando !== "microfono" ? "non lo sto registrando" : undefined,
          tinta: senzaMicrofono ? "text-red-400" : "text-ambra",
          allarme,
          cambiando: cambiando === "microfono",
        }}
      />
      <RigaApparecchio
        Icona={senzaAudioPc ? VolumeX : Volume2}
        etichetta="Audio del PC"
        scelto={prefs?.preferred_system_device ?? null}
        predefinito={predefiniti[1]}
        apparecchi={uscite.map((d) => d.name)}
        disabilitato={disabilitato}
        onScegli={(nome) => void cambia("audio_pc", nome)}
        onApri={rileggiApparecchi}
        inUso={{
          nome: inUso?.audioPc ?? null,
          avviso: senzaAudioPc && cambiando !== "audio_pc" ? "non lo sto registrando" : undefined,
          tinta: senzaAudioPc ? "text-red-400" : "text-audiopc",
          allarme,
          cambiando: cambiando === "audio_pc",
        }}
      />
    </div>
  );
}

"use client";

// La scelta del progetto (10-11), in due forme con lo stesso menu:
//
// - `RigaProgetto`, la riga «Progetto» sotto la scheda, con la stessa forma
//   delle righe degli apparecchi e sotto una riga piccola che dice dove
//   arrivera' il testo. Prima dello Stop la scelta la tiene il motore
//   (`imposta_progetto`); sulla scheda «Registrata» la cartella c'e' gia', e
//   cambiare progetto la rinomina subito.
// - `EtichettaProgetto`, il nome piccolo sulle righe di «Da trascrivere» e
//   «Trascritte»: lo stesso menu, e su una riunione gia' trascritta il
//   testo si sposta (vedi `useCambiaProgetto`).
//
// Il menu: «Nessuno», le cartelle di `Desktop\PROJECTS`, «Scrivi un nome…».
// Un nome scritto a mano che non e' fra le cartelle porta il segno «nuovo», e
// il suo testo andra' in `_RIUNIONI_SENZA_PROGETTO\<nome>`.
import { useState, type ReactNode } from "react";
import { Check, ChevronDown, FolderOpen, PenLine, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  destinazione,
  progettoDellaCartella,
  useCambiaProgetto,
  useProgetto,
  type Progetto,
} from "@/hooks/useProgetto";
import { getErrorMessage } from "@/lib/utils";

/** I caratteri che Windows non vuole nel nome di una cartella; il « · » separa il progetto. */
const VIETATI = /[\\/:*?"<>|·]/g;

const pulisci = (nome: string | null) => nome?.replace(VIETATI, "").replace(/\s+/g, " ").trim() || null;

/**
 * Il menu, e al posto del menu il campo per scrivere un nome. Ferma i clic
 * che salgono: sulla riga di «Trascritte» un clic apre la riunione, e i clic
 * nel menu (che sta in un portale) arrivano lo stesso alla riga.
 */
function SceltaProgetto({
  attuale,
  progetti,
  onScegli,
  onApri,
  disabled,
  title,
  triggerClassName,
  campoClassName,
  prefisso,
  children,
}: {
  attuale: string | null;
  progetti: Progetto[];
  onScegli: (nome: string | null) => void;
  onApri: () => void;
  disabled?: boolean;
  title?: string;
  triggerClassName: string;
  campoClassName: string;
  /** quello che sta prima del campo, al posto dell'inizio del pulsante */
  prefisso?: ReactNode;
  children: ReactNode;
}) {
  const [scrive, setScrive] = useState(false);
  const [testo, setTesto] = useState("");
  const nuovo = attuale != null && progetti.length > 0 && !progetti.some((p) => p.nome === attuale);
  const scegli = (nome: string | null) => {
    const pulito = pulisci(nome);
    if (pulito !== attuale) onScegli(pulito);
  };

  return (
    <span
      className="contents"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {scrive ? (
        <form
          className={campoClassName}
          onSubmit={(e) => {
            e.preventDefault();
            setScrive(false);
            scegli(testo);
          }}
        >
          {prefisso}
          <input
            autoFocus
            value={testo}
            onChange={(e) => setTesto(e.target.value.replace(VIETATI, ""))}
            onKeyDown={(e) => e.key === "Escape" && setScrive(false)}
            onBlur={() => setScrive(false)}
            placeholder="il nome, poi Invio"
            className="min-w-0 flex-1 bg-transparent py-0.5 outline-none placeholder:text-muted-foreground"
          />
        </form>
      ) : (
        <DropdownMenu onOpenChange={(aperto) => aperto && onApri()}>
          <DropdownMenuTrigger disabled={disabled} title={title} className={triggerClassName}>
            {children}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="menu-entra max-h-80 w-max max-w-[min(34rem,90vw)] overflow-y-auto border-white/10 bg-popover/95 shadow-2xl shadow-black/50 backdrop-blur-md">
            <DropdownMenuLabel className="text-[10.5px] font-normal tracking-wider text-muted-foreground uppercase">
              Progetto · le cartelle di PROJECTS
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => scegli(null)} className="gap-2">
              <Check className={`size-3 text-ambra ${attuale == null ? "" : "invisible"}`} />
              <span>Nessuno</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {progetti.map((p) => (
              <DropdownMenuItem key={p.nome} onSelect={() => scegli(p.nome)} className="gap-2">
                <Check className={`size-3 text-ambra ${attuale === p.nome ? "" : "invisible"}`} />
                <span>{p.nome}</span>
              </DropdownMenuItem>
            ))}
            {nuovo && (
              <DropdownMenuItem onSelect={() => scegli(attuale)} className="gap-2">
                <Check className="size-3 text-ambra" />
                <span>{attuale}</span>
                <span className="text-[11px] text-ambra">nuovo</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                setTesto(nuovo && attuale ? attuale : "");
                // dopo che il menu si e' chiuso, se no ruba il fuoco al campo
                setTimeout(() => setScrive(true), 0);
              }}
              className="gap-2"
            >
              <PenLine className="size-3 text-muted-foreground" />
              <span>Scrivi un nome…</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </span>
  );
}

/** La riga «Progetto» sotto la scheda: prima, durante e dopo la registrazione. */
export function RigaProgetto({
  folder,
  onRinominata,
  allarme = false,
}: {
  /** la cartella di una registrazione gia' ferma; senza, la scelta e' per quella che parte */
  folder?: string;
  onRinominata?: (nuova: string) => void;
  allarme?: boolean;
}) {
  const { progetti, scelto, scegli, rileggi } = useProgetto();
  const cambia = useCambiaProgetto();
  const [lavora, setLavora] = useState(false);

  const attuale = folder ? progettoDellaCartella(folder) : scelto;
  const nuovo = attuale != null && progetti.length > 0 && !progetti.some((p) => p.nome === attuale);

  const imposta = async (nome: string | null) => {
    setLavora(true);
    try {
      if (folder) await cambia(folder, nome, onRinominata);
      else await scegli(nome);
    } catch (errore) {
      toast.error("Progetto non cambiato", { description: getErrorMessage(errore), duration: 8000 });
    } finally {
      setLavora(false);
    }
  };

  const fondo = allarme ? "bg-black/25" : "bg-secondary";
  const grigio = allarme ? "text-allarme-muted" : "text-muted-foreground";

  // dove andra' il testo: si legge passandoci sopra, non in una riga in piu'
  // sotto la scheda (10-11, Greg: «il messaggio sotto non è bello»)
  const spiega = attuale
    ? `A trascrizione finita, il testo si copia in ${destinazione(attuale, progetti)}${
        nuovo ? " (la cartella la crea l'app)" : ""
      }.`
    : "Senza progetto il testo resta solo nella cartella delle registrazioni.";

  return (
    <div className="flex flex-col gap-1">
      <SceltaProgetto
        attuale={attuale}
        progetti={progetti}
        onScegli={(nome) => void imposta(nome)}
        onApri={() => void rileggi()}
        disabled={lavora}
        title={spiega}
        triggerClassName={`riga-scelta flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ambra/40 disabled:opacity-60 ${fondo} ${
          allarme ? "hover:bg-black/35" : "hover:bg-muted"
        }`}
        campoClassName={`flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-1.5 text-[14px] ring-2 ring-ambra/40 ${fondo}`}
        prefisso={
          <>
            <PenLine className={`size-3.5 shrink-0 ${grigio}`} />
            <span className={`w-26 shrink-0 ${grigio}`}>Progetto</span>
          </>
        }
      >
        <FolderOpen className={`size-3.5 shrink-0 ${attuale ? "text-ambra" : grigio}`} />
        <span className={`w-26 shrink-0 ${grigio}`}>Progetto</span>
        <span className={`min-w-0 flex-1 truncate ${attuale ? "font-medium" : grigio}`}>
          {attuale ?? "nessuno"}
        </span>
        {lavora ? (
          <span className={`shrink-0 text-[12.5px] ${grigio}`}>cambio…</span>
        ) : (
          nuovo && <span className="shrink-0 text-[12.5px] text-ambra">nuovo</span>
        )}
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </SceltaProgetto>
    </div>
  );
}

/**
 * Il progetto sulla riga di un elenco: il nome in ambra, o «+ progetto».
 * `trascritta` cambia solo le parole del suggerimento: per una riunione col
 * testo, cambiare progetto sposta il testo adesso.
 */
export function EtichettaProgetto({
  folder,
  trascritta = false,
  spenta,
  onRinominata,
}: {
  folder: string;
  trascritta?: boolean;
  /** il perche' il menu e' spento (sta trascrivendo); niente = acceso */
  spenta?: string;
  /** chi tiene il nome della cartella fuori dagli elenchi (la riga sotto la scheda) */
  onRinominata?: (nuova: string) => void;
}) {
  const { progetti, rileggi } = useProgetto();
  const cambia = useCambiaProgetto();
  const [lavora, setLavora] = useState(false);
  const attuale = progettoDellaCartella(folder);

  const imposta = async (nome: string | null) => {
    setLavora(true);
    try {
      await cambia(folder, nome, onRinominata);
    } finally {
      setLavora(false);
    }
  };

  const title =
    spenta ??
    (attuale
      ? `Il testo ${trascritta ? "sta" : "andrà"} in ${destinazione(attuale, progetti)}`
      : "Scegli il progetto della riunione");

  return (
    <SceltaProgetto
      attuale={attuale}
      progetti={progetti}
      onScegli={(nome) => void imposta(nome)}
      onApri={() => void rileggi()}
      disabled={lavora || spenta != null}
      title={title}
      triggerClassName={`pillola-progetto mt-1 inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12.5px] tracking-wide outline-none focus-visible:ring-2 focus-visible:ring-ambra/40 disabled:cursor-not-allowed disabled:opacity-50 ${
        attuale
          ? "border-ambra/30 bg-ambra/[0.06] font-medium text-ambra/90"
          : "border-dashed border-border text-muted-foreground"
      }`}
      campoClassName="mt-1 inline-flex w-52 max-w-full items-center gap-1 rounded-full border border-ambra/60 px-2.5 py-0.5 text-[12.5px] shadow-[0_0_14px_-2px_hsl(var(--ambra)/0.45)]"
      prefisso={<PenLine className="size-3 shrink-0 text-muted-foreground" />}
    >
      {attuale ? <FolderOpen className="size-3 shrink-0" /> : <Plus className="size-3 shrink-0" />}
      <span className="min-w-0 truncate">{lavora ? "cambio…" : (attuale ?? "progetto")}</span>
    </SceltaProgetto>
  );
}

"use client";

// La riga sottile di una trascrizione in corso (galleria 12, numero 2): un
// anello piccolo, la fase, quanto manca. Sta sotto la scheda in Registra e,
// nella forma corta, dentro la riga dell'elenco Da trascrivere (galleria 11,
// numero 1). Alla fine dice «Pronta · Apri» (o muta, o l'errore) e si chiude
// con la x.
import { X } from "lucide-react";

import { finito, type Lavoro } from "@/contexts/LavoriContext";
import { minutiFatti } from "@/types/avanzamento";
import { minutiRestanti } from "@/types/momento";

/** Percento fatto e minuti che mancano, stimati dal tempo passato. */
export function stimaLavoro(lavoro: Lavoro): { percento: number; restano: number } {
  const totale = lavoro.stato.totale_minuti ?? lavoro.minutes;
  if (totale <= 0) return { percento: 0, restano: 0 };
  const fatti = minutiFatti(lavoro.stato, totale);
  return {
    percento: Math.round((fatti / totale) * 100),
    restano: minutiRestanti(fatti, totale),
  };
}

/** L'anello piccolo: blu mentre lavora, verde a cose fatte, rosso se no. */
export function Anellino({ lavoro }: { lavoro: Lavoro }) {
  const { fase } = lavoro.stato;
  const colore =
    fase === "fatto"
      ? "hsl(var(--success))"
      : fase === "muta" || fase === "errore" || fase === "interrotta"
        ? "hsl(var(--destructive))"
        : "hsl(var(--info))";
  const p = finito(lavoro) ? 100 : fase === "voci" ? 100 : stimaLavoro(lavoro).percento;
  return (
    <span
      className="relative inline-block size-4.5 flex-none rounded-full"
      style={{
        background: `conic-gradient(${colore} 0 ${p}%, hsl(var(--muted)) ${p}% 100%)`,
      }}
      role="progressbar"
      aria-valuenow={p}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className="absolute inset-1 rounded-full bg-background" />
    </span>
  );
}

/** Le parole della riga, fase per fase. */
export function paroleLavoro(lavoro: Lavoro): string {
  const s = lavoro.stato;
  switch (s.fase) {
    case "avviata":
      return "Si prepara";
    case "testo": {
      const { percento, restano } = stimaLavoro(lavoro);
      return `Sta trascrivendo · ${percento} %${restano > 0 ? ` · mancano ${restano} min` : ""}`;
    }
    case "voci":
      return "Separa le voci";
    case "fatto":
      return "Pronta";
    case "muta":
      return `Muta · voce al ${s.percento_voce ?? 0} %`;
    case "errore":
      return `Non ce l'ha fatta${s.messaggio ? ` · ${s.messaggio}` : ""}`;
    case "interrotta":
      return "Interrotta";
  }
}

interface RigaLavoroProps {
  lavoro: Lavoro;
  onApri: (folder: string) => void;
  onChiudi: (folder: string) => void;
}

/** La classe del colore delle parole: blu, verde a cose fatte, rosso se no. */
export function tintaLavoro(lavoro: Lavoro): string {
  const { fase } = lavoro.stato;
  return fase === "fatto"
    ? "text-success"
    : fase === "muta" || fase === "errore" || fase === "interrotta"
      ? "text-destructive"
      : "text-info";
}

export function RigaLavoro({ lavoro, onApri, onChiudi }: RigaLavoroProps) {
  const s = lavoro.stato;
  const inCorso = !finito(lavoro);
  const tinta = tintaLavoro(lavoro);
  return (
    <div className="flex w-117.5 items-center gap-2.5 px-1.5 text-xs text-muted-foreground">
      <Anellino lavoro={lavoro} />
      <span className={`${tinta} font-medium whitespace-nowrap`}>{paroleLavoro(lavoro)}</span>
      <span className="min-w-0 truncate" title={lavoro.folder}>
        {lavoro.folder}
      </span>
      {s.fase === "fatto" && (
        <button
          type="button"
          onClick={() => onApri(lavoro.folder)}
          className="rounded-full border border-success px-2.5 py-0.5 text-[11px] font-semibold text-success hover:bg-success hover:text-success-foreground"
        >
          Apri
        </button>
      )}
      {!inCorso && (
        <button
          type="button"
          onClick={() => onChiudi(lavoro.folder)}
          aria-label="Chiudi"
          className="ml-auto rounded-sm p-0.5 hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

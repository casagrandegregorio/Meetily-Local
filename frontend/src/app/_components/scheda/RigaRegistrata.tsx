"use client";

// La riunione appena registrata, in una riga sotto la scheda (10-11).
//
// Prima, dopo lo Stop, la scheda diventava «Registrata» col tondo TRASCRIVI,
// e per registrare di nuovo bisognava passare da «Da trascrivere» e tornare.
// Greg: «servirebbe un design che mi permetta di riregistrare e allo stesso
// tempo di trascrivere l'ultima». Cosi' la scheda torna subito su REGISTRA, e
// l'ultima riunione aspetta qui sotto: ▶ per riascoltarla, il progetto,
// TRASCRIVI, e il Cestino che compare passandoci sopra. Premuto TRASCRIVI,
// al suo posto c'e' la riga del lavoro (`RigaLavoro`), stessa forma.
import { useState } from "react";
import { Trash2, X } from "lucide-react";

import { durata } from "@/types/trascritta";
import { LettoreRiga } from "@/app/_components/lettore/Lettore";

import { EtichettaProgetto } from "./RigaProgetto";
import { Quando } from "./Quando";

interface RigaRegistrataProps {
  folder: string;
  minutes: number;
  onTrascrivi: (folder: string) => void;
  onButta: (folder: string) => void;
  /** toglie la riga e basta: la riunione resta in «Da trascrivere» */
  onLascia: () => void;
  onRinominata: (nuova: string) => void;
}

/** La forma comune delle righe sotto la scheda. */
export const RIGA_SOTTO =
  "riga-elenco flex w-117.5 max-w-full items-center gap-3 border border-border/70 bg-card/60 px-3 py-2.5";

export function RigaRegistrata({
  folder,
  minutes,
  onTrascrivi,
  onButta,
  onLascia,
  onRinominata,
}: RigaRegistrataProps) {
  const [chiede, setChiede] = useState(false);
  return (
    <div className={RIGA_SOTTO}>
      <LettoreRiga folder={folder} />
      <div className="flex min-w-0 flex-1 flex-col items-start">
        <div className="flex max-w-full min-w-0 items-baseline gap-3">
          <Quando folder={folder} />
          <span className="sfuma shrink-0 font-mono text-[13px] tabular-nums text-muted-foreground/80">
            {durata(minutes)}
          </span>
        </div>
        <EtichettaProgetto folder={folder} onRinominata={onRinominata} />
      </div>

      {chiede ? (
        <span className="flex shrink-0 items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">nel Cestino?</span>
          <button
            type="button"
            onClick={() => onButta(folder)}
            className="rounded-full bg-destructive px-3 py-1 font-semibold text-destructive-foreground"
          >
            Sì
          </button>
          <button
            type="button"
            onClick={() => setChiede(false)}
            className="rounded-full border border-border px-3 py-1 text-muted-foreground hover:text-foreground"
          >
            No
          </button>
        </span>
      ) : (
        <>
          {/* il Cestino e «dopo» compaiono passandoci sopra, a sinistra di TRASCRIVI */}
          <span className="solo-sopra flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => setChiede(true)}
              aria-label="Nel Cestino"
              title="Nel Cestino di Windows"
              className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
            <button
              type="button"
              onClick={onLascia}
              aria-label="Dopo"
              title="Dopo: resta in «Da trascrivere»"
              className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </span>
          <button
            type="button"
            onClick={() => onTrascrivi(folder)}
            className="shrink-0 rounded-full border border-ambra/60 px-4 py-1.5 text-[12.5px] font-semibold tracking-[0.12em] text-ambra transition-all duration-200 hover:border-ambra hover:bg-ambra hover:text-ambra-foreground hover:shadow-[0_0_18px_-2px_hsl(var(--ambra)/0.6)]"
          >
            TRASCRIVI
          </button>
        </>
      )}
    </div>
  );
}

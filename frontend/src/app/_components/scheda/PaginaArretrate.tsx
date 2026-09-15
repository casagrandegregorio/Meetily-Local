"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

import type { Arretrata } from "@/types/arretrata";
import type { Lavoro } from "@/contexts/LavoriContext";
import { durata } from "@/types/trascritta";

import { Anellino, paroleLavoro, tintaLavoro } from "./RigaLavoro";

interface PaginaArretrateProps {
  arretrate: Arretrata[];
  /** le trascrizioni in corso: sulla loro riga, al posto del pulsante */
  lavori?: Lavoro[];
  onTrascrivi: (arretrata: Arretrata) => void;
  /** sposta la cartella nel Cestino di Windows (dopo la conferma sulla riga) */
  onCestino: (arretrata: Arretrata) => void;
}

/**
 * Il posto «Da trascrivere» (galleria 8, numero 3): una riga per
 * registrazione senza testo, il pulsante TRASCRIVI su ognuna, e il Cestino.
 *
 * Una riga **muta** — lo dice `livello.json`, o l'ultimo tentativo finito
 * «muta» — non ha TRASCRIVI: lo script la rifiuterebbe comunque (sotto il
 * 5 % di voce inventa parole). Resta il Cestino, che e' quello che serve
 * (15-09: le tre del 23 luglio). Supera la galleria 8 su «spente ma
 * premibili».
 *
 * Nata come pannello a scomparsa sotto la scheda (galleria 6); dall'08-09
 * sera e' una pagina sua, perche' Greg ha chiesto di separare il registrare
 * dal guardare le registrazioni.
 */
export function PaginaArretrate({
  arretrate,
  lavori = [],
  onTrascrivi,
  onCestino,
}: PaginaArretrateProps) {
  const lavoroDi = (folder: string) => lavori.find((l) => l.folder === folder);
  // la riga che sta chiedendo «nel Cestino?»
  const [daConfermare, setDaConfermare] = useState<string | null>(null);

  const daLavorare = arretrate.filter((a) => !muta(a));
  const minutiTotali = daLavorare.reduce((somma, a) => somma + a.minutes, 0);
  // 0,09 secondi di scheda grafica per ogni secondo di audio: la misura del
  // 06-09, con il modello grande su Intel Arc.
  const minutiDiLavoro = Math.round(minutiTotali * 0.09);
  const quanteMute = arretrate.length - daLavorare.length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline gap-3 border-b border-border px-6 py-4">
        <h2 className="text-base font-semibold">Da trascrivere</h2>
        {arretrate.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {daLavorare.length > 0
              ? `${daLavorare.length} · ${durata(minutiTotali)} · circa ${minutiDiLavoro} minuti di lavoro`
              : "niente da trascrivere"}
            {quanteMute > 0 ? ` · ${quanteMute} ${quanteMute === 1 ? "muta" : "mute"}` : ""}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">niente in attesa</p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6">
        {arretrate.map((a) => {
          const lavoro = lavoroDi(a.folder);
          const spenta = muta(a) && !lavoro;
          const chiede = daConfermare === a.folder;
          const parole = esito(a);
          return (
            <div
              key={a.folder}
              className="flex items-center gap-3 border-b border-border/60 py-3 last:border-b-0"
            >
              <div
                className={`min-w-0 flex-1 truncate text-sm ${spenta ? "text-muted-foreground/60" : ""}`}
                title={a.folder}
              >
                {a.folder}
              </div>
              <div
                className={`text-xs tabular-nums ${spenta ? "text-muted-foreground/60" : "text-muted-foreground"}`}
              >
                {durata(a.minutes)}
              </div>

              {lavoro ? (
                <div className={`flex items-center gap-2 text-xs ${tintaLavoro(lavoro)}`}>
                  <Anellino lavoro={lavoro} />
                  <span>{paroleLavoro(lavoro)}</span>
                </div>
              ) : (
                <>
                  {parole && <span className="text-xs text-destructive/80">{parole}</span>}
                  {!spenta && (
                    <button
                      type="button"
                      onClick={() => onTrascrivi(a)}
                      className="rounded-full border border-ambra px-3.5 py-1 text-xs font-semibold tracking-wide text-ambra hover:bg-ambra hover:text-ambra-foreground"
                    >
                      TRASCRIVI
                    </button>
                  )}
                  {chiede ? (
                    <span className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">nel Cestino?</span>
                      <button
                        type="button"
                        onClick={() => {
                          setDaConfermare(null);
                          onCestino(a);
                        }}
                        className="rounded-full bg-destructive px-3 py-1 font-semibold text-destructive-foreground"
                      >
                        Sì
                      </button>
                      <button
                        type="button"
                        onClick={() => setDaConfermare(null)}
                        className="rounded-full border border-border px-3 py-1 text-muted-foreground hover:text-foreground"
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDaConfermare(a.folder)}
                      aria-label="Nel Cestino"
                      title="Nel Cestino di Windows"
                      className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Muta lo dice `livello.json`, oppure l'ultimo tentativo finito «muta». */
function muta(a: Arretrata): boolean {
  return a.silent === true || a.esito?.fase === "muta";
}

/** Le parole dell'esito sulla riga; niente se non c'e' nulla da dire. */
function esito(a: Arretrata): string | null {
  if (muta(a)) {
    const p = a.percento_voce ?? a.esito?.percento_voce ?? 0;
    return `Muta · voce al ${p} %`;
  }
  switch (a.esito?.fase) {
    case "errore":
      return `Non ce l'ha fatta${a.esito.messaggio ? ` · ${a.esito.messaggio}` : ""}`;
    case "interrotta":
      return "Interrotta";
    default:
      return null;
  }
}

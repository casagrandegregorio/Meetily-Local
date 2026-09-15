"use client";

import { useState, type ReactNode } from "react";

import { minutiRestanti, type Momento } from "@/types/momento";
import { durata } from "@/types/trascritta";
import { orario } from "@/types/trascrizione";

import { SchedaFerma } from "./SchedaFerma";

interface SchedaRiunioneProps {
  momento: Momento;
  /** barrette del livello audio mentre registra, valori 0..1 */
  livelli?: number[];
  onStart: () => void;
  isStarting: boolean;
  onStop: () => void;
  onTrascrivi: (folder: string) => void;
  onButta: (folder: string) => void;
  onApri: (folder: string) => void;
}

/* ------------------------------------------------------------------ */
/* I pezzi della scheda: la cornice, e le tre figure che stanno a sinistra */

/** La cornice della scheda: figura a sinistra, colonna di testo a destra. */
function Scheda({ figura, children }: { figura: ReactNode; children: ReactNode }) {
  return (
    <div className="flex w-117.5 max-w-full items-center gap-6 rounded-2xl border border-border bg-card px-7 py-6">
      {figura}
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
    </div>
  );
}

/** Il tondo: pieno per l'azione forte (STOP), vuoto per quella da chiedere (TRASCRIVI). */
function Tondone({
  testo,
  vuoto = false,
  onClick,
}: {
  testo: string;
  vuoto?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={testo}
      className={`flex size-27 flex-none items-center justify-center rounded-full text-sm font-bold tracking-wide transition-all duration-150 hover:scale-105 active:scale-95 ${
        vuoto
          ? "border-2 border-ambra bg-transparent text-ambra hover:bg-ambra/10"
          : "bg-ambra text-ambra-foreground hover:ring-8 hover:ring-ambra/15"
      }`}
    >
      {testo}
    </button>
  );
}

/** «Butta la registrazione»: chiede conferma li' stesso, poi va nel Cestino. */
function Butta({ folder, onButta }: { folder: string; onButta: (folder: string) => void }) {
  const [chiede, setChiede] = useState(false);
  if (!chiede) {
    return (
      <button
        type="button"
        onClick={() => setChiede(true)}
        className="self-start text-sm text-ambra hover:underline"
      >
        Butta la registrazione
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Nel Cestino di Windows?</span>
      <button
        type="button"
        onClick={() => onButta(folder)}
        className="rounded-full bg-destructive px-3 py-0.5 text-xs font-semibold text-destructive-foreground"
      >
        Sì
      </button>
      <button
        type="button"
        onClick={() => setChiede(false)}
        className="rounded-full border border-border px-3 py-0.5 text-xs text-muted-foreground hover:text-foreground"
      >
        No
      </button>
    </div>
  );
}

/** L'anello della percentuale, mentre trascrive. */
function Anello({ percento }: { percento: number }) {
  const p = Math.max(0, Math.min(100, Math.round(percento)));
  return (
    <div
      className="flex size-27 flex-none items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(hsl(var(--info)) 0 ${p}%, hsl(var(--muted)) ${p}% 100%)`,
      }}
      role="progressbar"
      aria-valuenow={p}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="flex size-21 items-center justify-center rounded-full bg-card text-[17px] font-semibold">
        {p}%
      </div>
    </div>
  );
}

/** Il quadro col segno: la freccia per aprire, il punto esclamativo per la muta. */
function Quadro({
  segno,
  tinta,
  onClick,
  etichetta,
}: {
  segno: string;
  tinta: "success" | "destructive";
  onClick?: () => void;
  etichetta: string;
}) {
  // Il rosso del tema scuro e' molto cupo: da solo, sul quadro grigio, il punto
  // esclamativo non si vedeva. Per la muta il quadro e' pieno.
  const colore =
    tinta === "success"
      ? "border-success/40 bg-success/15 text-success"
      : "border-destructive bg-destructive text-destructive-foreground";
  const base = `flex size-27 flex-none items-center justify-center rounded-2xl border text-3xl ${colore}`;
  return onClick ? (
    <button type="button" onClick={onClick} aria-label={etichetta} className={`${base} hover:bg-accent`}>
      {segno}
    </button>
  ) : (
    <div className={base} aria-label={etichetta}>
      {segno}
    </div>
  );
}

/** Le barrette del livello audio. Senza dati, nove barrette basse e ferme. */
function Livello({ valori }: { valori: number[] }) {
  const barre = valori.length > 0 ? valori : Array<number>(9).fill(0.15);
  return (
    <div className="flex h-8 items-end gap-0.75" aria-hidden>
      {barre.map((v, i) => (
        <i
          key={i}
          className="block w-1.25 rounded-sm bg-ambra"
          style={{ height: `${Math.max(8, Math.min(100, v * 100))}%` }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * La scheda al centro, in uno dei suoi sei momenti (galleria 5). Una scheda
 * sola: cambia la figura a sinistra e quello che c'e' scritto a destra.
 */
export function SchedaRiunione({
  momento,
  livelli = [],
  onStart,
  isStarting,
  onStop,
  onTrascrivi,
  onButta,
  onApri,
}: SchedaRiunioneProps) {
  switch (momento.tipo) {
    case "ferma":
      return <SchedaFerma onStart={onStart} isStarting={isStarting} />;

    case "registra":
      return (
        <Scheda figura={<Tondone testo="STOP" onClick={onStop} />}>
          <div className="text-[38px] leading-none font-light tabular-nums">
            {momento.secondi === null ? "00:00" : orario(momento.secondi)}
          </div>
          <Livello valori={livelli} />
        </Scheda>
      );

    case "registrata":
      return (
        <Scheda
          figura={<Tondone testo="TRASCRIVI" vuoto onClick={() => onTrascrivi(momento.folder)} />}
        >
          <div className="text-lg font-medium">Registrata · {durata(momento.minutes)}</div>
          <div className="truncate text-sm text-muted-foreground" title={momento.folder}>
            {momento.folder}
          </div>
          <Butta folder={momento.folder} onButta={onButta} />
        </Scheda>
      );

    case "trascrive": {
      const percento = (momento.fatti / momento.totale) * 100;
      const restano = minutiRestanti(momento.fatti, momento.totale);
      return (
        <Scheda figura={<Anello percento={percento} />}>
          <div className="text-lg font-medium">Trascrivo</div>
          <div className="text-sm text-muted-foreground">
            {momento.fatti} minuti su {momento.totale}
            {restano > 0 ? ` · ${restano === 1 ? "ancora 1 minuto" : `altri ${restano} min`}` : ""}
          </div>
          <div className="text-sm text-muted-foreground">
            puoi chiudere la finestra, va avanti da solo
          </div>
        </Scheda>
      );
    }

    case "pronta":
      return (
        <Scheda
          figura={
            <Quadro segno="↗" tinta="success" etichetta="Apri il testo" onClick={() => onApri(momento.folder)} />
          }
        >
          <div className="text-lg font-medium">
            Pronta · {durata(momento.minutes)} · {momento.voices}{" "}
            {momento.voices === 1 ? "voce" : "voci"}
          </div>
          {/* i nomi grigi e non ambra: e' un assaggio del foglio chiaro, dove
              l'ambra non entra (galleria 10, numero 1) */}
          <div className="text-[13.5px] leading-[1.7] text-foreground/80">
            {momento.prime.slice(0, 3).map((t, i) => (
              <div key={i} className="truncate">
                <span className="font-semibold text-muted-foreground">{t.who}</span> {t.text}
              </div>
            ))}
          </div>
        </Scheda>
      );

    case "muta":
      return (
        <Scheda figura={<Quadro segno="!" tinta="destructive" etichetta="Nessuna voce dentro" />}>
          <div className="text-lg font-medium">Nessuna voce dentro</div>
          <div className="text-sm text-muted-foreground">
            {durata(momento.minutes)} registrati, voce nel {momento.percentoVoce}% del
            tempo. Non la trascrivo.
          </div>
          <button
            type="button"
            onClick={() => onTrascrivi(momento.folder)}
            className="self-start text-sm text-ambra hover:underline"
          >
            Trascrivila lo stesso
          </button>
        </Scheda>
      );
  }
}

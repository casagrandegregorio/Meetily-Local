"use client";

import { useState, type ReactNode } from "react";

import { NIENTE, type DueLivelli } from "@/hooks/useLivelliRegistrazione";
import { minutiRestanti, type Momento } from "@/types/momento";
import { durata } from "@/types/trascritta";
import { orario } from "@/types/trascrizione";

import { SchedaFerma } from "./SchedaFerma";

interface SchedaRiunioneProps {
  momento: Momento;
  /** le due file di barrette mentre registra, valori 0..1 */
  livelli?: DueLivelli;
  onStart: () => void;
  isStarting: boolean;
  onStop: () => void;
  onTrascrivi: (folder: string) => void;
  onButta: (folder: string) => void;
  onApri: (folder: string) => void;
}

/* ------------------------------------------------------------------ */
/* I pezzi della scheda: la cornice, e le tre figure che stanno a sinistra */

/**
 * La cornice della scheda: figura a sinistra, colonna di testo a destra.
 *
 * Con `allarme` la scheda si tinge di rosso scuro e sta dentro una schermata
 * rossa che respira: e' il segnale della sentinella del silenzio (galleria 20,
 * il 2 col 3). Ci si e' arrivati per gradi, nello stesso giorno: prima una riga
 * di testo rossa sotto le barrette, che provandola Greg non ha riconosciuto
 * come un avviso; poi un filo rosso attorno alla scheda (galleria 19, A3), che
 * con Teams a tutto schermo si vede ancora troppo poco.
 */
function Scheda({
  figura,
  allarme = false,
  children,
}: {
  figura: ReactNode;
  allarme?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex w-117.5 max-w-full items-center gap-6 rounded-2xl border px-7 py-6 ${
        allarme ? "border-transparent bg-allarme-scheda" : "border-border bg-card"
      }`}
    >
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

/** Una fila di nove barrette. Senza dati, nove barrette basse e ferme. */
function Fila({
  valori,
  colore,
  verso,
}: {
  valori: number[];
  colore: string;
  verso: "su" | "giu";
}) {
  const barre = valori.length > 0 ? valori : Array<number>(9).fill(0.15);
  return (
    <div
      className={`flex h-6.5 gap-0.75 ${verso === "su" ? "items-end" : "items-start"}`}
      aria-hidden
    >
      {barre.map((v, i) => (
        <i
          key={i}
          className={`block w-1.25 rounded-sm ${colore}`}
          style={{ height: `${Math.max(8, Math.min(100, v * 100))}%` }}
        />
      ))}
    </div>
  );
}

/**
 * I due livelli mentre registra: il microfono cresce in su dalla linea di
 * mezzo, l'audio del PC cresce in giu' (galleria 19, B3, scelta il 24-09).
 *
 * Due file e non una: fino al 24-09 c'era solo il microfono, e guardando la
 * scheda non si poteva sapere se la voce degli altri — su Teams arriva
 * dall'audio del PC — stesse entrando davvero. I nomi stanno scritti sotto per
 * esteso: la fila si deve poter leggere senza sapere cosa vuol dire un colore.
 */
function DueLivelliBarre({ livelli }: { livelli: DueLivelli }) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* w-fit: la linea di mezzo e' larga quanto le barrette, non quanto la
          scheda — e' il pavimento da cui le due file crescono */}
      <div className="flex w-fit flex-col">
        <Fila valori={livelli.microfono} colore="bg-ambra" verso="su" />
        <div className="my-0.75 h-px bg-border" />
        <Fila valori={livelli.audioPc} colore="bg-audiopc" verso="giu" />
      </div>
      <div className="flex gap-3.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <i className="block size-2 rounded-xs bg-ambra" aria-hidden />
          microfono
        </span>
        <span className="flex items-center gap-1.5">
          <i className="block size-2 rounded-xs bg-audiopc" aria-hidden />
          audio del PC
        </span>
      </div>
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
  livelli = NIENTE,
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

    case "registra": {
      const tempo = momento.secondi === null ? "00:00" : orario(momento.secondi);
      // Quando la sentinella non sente niente la scheda smette di essere il
      // cronometro e diventa il messaggio: via le barrette (sono spente, non
      // hanno niente da dire), la scritta grande, e il tempo che resta
      // leggibile piu' piccolo sotto. Il tondo STOP non si sposta mai.
      if (momento.silenzio != null)
        return (
          <Scheda figura={<Tondone testo="STOP" onClick={onStop} />} allarme>
            <div className="text-[34px] leading-[1.1] font-extrabold text-allarme-foreground">
              NON SENTO
              <br />
              NIENTE
            </div>
            <div className="text-[15px] text-allarme-muted">
              Da {durata(Math.round(momento.silenzio / 60))}. Controlla il microfono e l&apos;audio
              del PC.
            </div>
            <div className="text-[22px] leading-none font-light tabular-nums text-allarme-foreground">
              {tempo}
            </div>
          </Scheda>
        );
      return (
        <Scheda figura={<Tondone testo="STOP" onClick={onStop} />}>
          <div className="text-[38px] leading-none font-light tabular-nums">{tempo}</div>
          <DueLivelliBarre livelli={livelli} />
        </Scheda>
      );
    }

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

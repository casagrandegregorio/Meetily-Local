"use client";

// Un foglio scritto a mano accanto al testo: il riassunto (incollato da
// Claude) o le note di Greg. Si legge, si copia con l'icona nell'angolo,
// si modifica, si butta (nel Cestino di Windows). Vive sul disco nella
// cartella della riunione (`riassunto.md`, `note.md`: `read_sheet`,
// `write_sheet`, `trash_sheet`).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import { getErrorMessage } from "@/lib/utils";

import { Markdown } from "./Markdown";

export type NomeFoglio = "riassunto.md" | "note.md";

const BOTTONE =
  "rounded-full border border-ambra px-3.5 py-1 text-xs font-semibold tracking-wide text-ambra hover:bg-ambra hover:text-ambra-foreground disabled:opacity-40";
const BOTTONE_TENUE =
  "rounded-full border border-border px-3.5 py-1 text-xs text-muted-foreground hover:text-foreground";

/** L'icona «copia», due riquadri uno dentro l'altro, nell'angolo del foglio. */
export function Copia({ testo, nome }: { testo: string; nome: string }) {
  const copia = async () => {
    try {
      await navigator.clipboard.writeText(testo);
      toast.success(`${nome} copiato`, { duration: 2000 });
    } catch (e) {
      toast.error("Non copiato", { description: getErrorMessage(e), duration: 6000 });
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copia()}
      aria-label={`Copia ${nome.toLowerCase()}`}
      title="Copia tutto"
      className="absolute top-3 right-3 rounded-md p-1.5 text-foglio-muted hover:bg-foglio-muted/15 hover:text-foglio-foreground"
    >
      <Copy className="size-4" />
    </button>
  );
}

/** La carta: lo stesso foglio chiaro del testo, con l'angolo per l'icona. */
export function Carta({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background pt-6">
      <article className="relative mx-auto w-175 max-w-full rounded-t-lg bg-foglio px-9 pt-7 pb-16 font-serif text-[16px] leading-[1.75] text-foglio-foreground">
        {children}
      </article>
    </div>
  );
}

interface FoglioScrittoProps {
  folder: string;
  nome: NomeFoglio;
  /** «Riassunto», «Note»: per i messaggi */
  etichetta: string;
  /** cosa dire quando il foglio e' vuoto */
  invito: string;
}

export function FoglioScritto({ folder, nome, etichetta, invito }: FoglioScrittoProps) {
  const [testo, setTesto] = useState<string | null>(null);
  const [caricato, setCaricato] = useState(false);
  const [modifica, setModifica] = useState(false);
  const [bozza, setBozza] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [chiedeButta, setChiedeButta] = useState(false);

  useEffect(() => {
    let annullato = false;
    void invoke<string | null>("read_sheet", { folder, name: nome })
      .then((t) => {
        if (annullato) return;
        setTesto(t);
        setModifica(false);
        setCaricato(true);
      })
      .catch((e) => {
        console.info("[foglio] non letto", nome, e);
        if (!annullato) setCaricato(true);
      });
    return () => {
      annullato = true;
    };
  }, [folder, nome]);

  const salva = async () => {
    const pulito = bozza.trim();
    if (!pulito) return;
    setSalvando(true);
    try {
      await invoke("write_sheet", { folder, name: nome, text: pulito });
      setTesto(pulito);
      setModifica(false);
      toast.success(`${etichetta} salvato`, { duration: 2500 });
    } catch (e) {
      toast.error("Non salvato", { description: getErrorMessage(e), duration: 8000 });
    } finally {
      setSalvando(false);
    }
  };

  const butta = async () => {
    setChiedeButta(false);
    try {
      await invoke("trash_sheet", { folder, name: nome });
      setTesto(null);
      setBozza("");
      toast.success(`${etichetta} nel Cestino`, { duration: 3000 });
    } catch (e) {
      toast.error("Non ci sono riuscita", { description: getErrorMessage(e), duration: 8000 });
    }
  };

  if (!caricato) return <Carta>{null}</Carta>;

  // scrittura: vuoto, o in modifica
  if (testo === null || modifica) {
    return (
      <Carta>
        {testo === null && <p className="font-sans text-sm text-foglio-muted">{invito}</p>}
        <textarea
          value={bozza}
          onChange={(e) => setBozza(e.target.value)}
          placeholder={`Scrivi qui ${etichetta.toLowerCase() === "note" ? "le note" : "il riassunto"}`}
          rows={16}
          spellCheck={false}
          className="mt-3 w-full resize-y rounded-md border border-foglio-muted/40 bg-transparent p-3 font-serif text-[15px] leading-relaxed outline-none focus:border-ambra"
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void salva()}
            disabled={salvando || bozza.trim() === ""}
            className={BOTTONE}
          >
            SALVA
          </button>
          {modifica && (
            <button
              type="button"
              onClick={() => {
                setModifica(false);
                setBozza("");
              }}
              className={BOTTONE_TENUE}
            >
              Annulla
            </button>
          )}
        </div>
      </Carta>
    );
  }

  // lettura
  return (
    <Carta>
      <Copia testo={testo} nome={etichetta} />
      <Markdown testo={testo} />
      <div className="mt-8 flex items-center gap-2 border-t border-foglio-muted/30 pt-4 font-sans">
        <button
          type="button"
          onClick={() => {
            setBozza(testo);
            setModifica(true);
          }}
          className={BOTTONE}
        >
          MODIFICA
        </button>
        {chiedeButta ? (
          <span className="flex items-center gap-2 text-xs">
            <span className="text-foglio-muted">nel Cestino?</span>
            <button
              type="button"
              onClick={() => void butta()}
              className="rounded-full bg-destructive px-3 py-1 font-semibold text-destructive-foreground"
            >
              Sì
            </button>
            <button type="button" onClick={() => setChiedeButta(false)} className={BOTTONE_TENUE}>
              No
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setChiedeButta(true)} className={BOTTONE_TENUE}>
            Butta
          </button>
        )}
      </div>
    </Carta>
  );
}

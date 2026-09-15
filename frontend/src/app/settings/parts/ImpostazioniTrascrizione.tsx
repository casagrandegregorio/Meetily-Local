"use client";

// Le sezioni Trascrizione e Persone (galleria 15, numero 2).
//
// Trascrizione: dove stanno i nostri script (la cartella con `riunione.py`);
// l'app la ricorda in `trascrivi.json` (`get/set_transcriber_folder`).
// Persone: chi gli script conoscono gia' — solo lettura, i nomi si danno con
// `battesimo.py`; il file coi nomi veri non arriva mai qui.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { getErrorMessage } from "@/lib/utils";

const classeValore =
  "min-w-0 flex-1 truncate rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground";
const classeBottone =
  "shrink-0 rounded-full border border-ambra px-3.5 py-1 text-xs font-semibold tracking-wide text-ambra hover:bg-ambra hover:text-ambra-foreground disabled:opacity-40";

export function ImpostazioniTrascrizione() {
  const [salvata, setSalvata] = useState<string | null>(null);
  const [cartella, setCartella] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let annullato = false;
    void invoke<string | null>("get_transcriber_folder")
      .then((c) => {
        if (annullato) return;
        setSalvata(c);
        setCartella(c ?? "");
      })
      .catch((errore) => console.info("[impostazioni] cartella script non leggibile", errore));
    return () => {
      annullato = true;
    };
  }, []);

  const salva = async () => {
    setSalvando(true);
    try {
      await invoke("set_transcriber_folder", { folder: cartella });
      setSalvata(cartella);
      toast.success("Salvato", { duration: 2000 });
    } catch (errore) {
      toast.error("Non salvato", { description: getErrorMessage(errore), duration: 8000 });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-4 border-b border-border/60 py-3.5">
        <div className="w-52 shrink-0 text-sm">
          Cartella degli script
          <span className="block text-xs text-muted-foreground">
            quella con dentro <code>riunione.py</code>
          </span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            className={classeValore}
            value={cartella}
            placeholder="non ancora detta"
            disabled={salvando}
            onChange={(e) => setCartella(e.target.value)}
            spellCheck={false}
          />
          <button
            type="button"
            className={classeBottone}
            disabled={salvando || cartella === (salvata ?? "") || cartella.trim() === ""}
            onClick={() => void salva()}
          >
            CAMBIA
          </button>
        </div>
      </div>
      <p className="pt-4 text-xs text-muted-foreground">
        Il testo lo fanno gli script sulla scheda grafica, quando premi TRASCRIVI. Serve{" "}
        <code>uv</code> sul PC: se manca, l&apos;app lo dice.
      </p>
    </div>
  );
}

interface Persona {
  nome: string;
  riunioni: number;
}

export function ImpostazioniPersone() {
  const [persone, setPersone] = useState<Persona[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    let annullato = false;
    void invoke<Persona[]>("list_known_voices")
      .then((p) => {
        if (!annullato) setPersone(Array.isArray(p) ? p : []);
      })
      .catch((e) => {
        if (!annullato) setErrore(getErrorMessage(e));
      });
    return () => {
      annullato = true;
    };
  }, []);

  if (errore) return <p className="text-sm text-muted-foreground">{errore}</p>;
  if (!persone) return null;
  if (persone.length === 0) {
    return <p className="text-sm text-muted-foreground">Nessuna voce conosciuta ancora.</p>;
  }
  return (
    <div>
      {persone.map((p) => (
        <div
          key={p.nome}
          className="flex items-center gap-4 border-b border-border/60 py-3 last:border-b-0"
        >
          <span className="flex-1 text-sm">{p.nome}</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {p.riunioni} {p.riunioni === 1 ? "riunione" : "riunioni"}
          </span>
        </div>
      ))}
      <p className="pt-4 text-xs text-muted-foreground">
        I nomi si danno alle voci con <code>battesimo.py</code>, dopo una trascrizione: da li&apos;
        la persona viene riconosciuta da sola nelle riunioni dopo.
      </p>
    </div>
  );
}

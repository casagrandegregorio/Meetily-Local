"use client";

// La sezione Registrazione (galleria 15, numero 2): da dove si prende l'audio
// e dove finisce, piu' «Prova il microfono». Prende il posto di
// `RecordingSettings` di Meetily, che resta nel repo.
//
// I due apparecchi sono `MenuApparecchi`, lo stesso pezzo che sta sulla
// scheda: scrivono nel file delle preferenze, l'unica memoria della scelta
// (18-09, vedi `usePreferenzeRegistrazione`).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { MenuApparecchi } from "@/app/_components/MenuApparecchi";
import { useAudioLevels } from "@/hooks/useAudioLevels";
import { useBarrette } from "@/hooks/useBarrette";
import { usePreferenzeRegistrazione } from "@/hooks/usePreferenzeRegistrazione";
import { getErrorMessage } from "@/lib/utils";

function Campo({
  nome,
  sotto,
  children,
}: {
  nome: string;
  sotto?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 border-b border-border/60 py-3.5 last:border-b-0">
      <div className="w-52 shrink-0 text-sm">
        {nome}
        {sotto && <span className="block text-xs text-muted-foreground">{sotto}</span>}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

const classeValore =
  "min-w-0 flex-1 truncate rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground";
const classeBottone =
  "shrink-0 rounded-full border border-ambra px-3.5 py-1 text-xs font-semibold tracking-wide text-ambra hover:bg-ambra hover:text-ambra-foreground disabled:opacity-40";

/** Le barrette del livello, come sulla scheda mentre registra. */
function Barrette({ valori }: { valori: number[] }) {
  const barre = valori.length > 0 ? valori : Array<number>(9).fill(0.15);
  return (
    <div className="flex h-6 items-end gap-0.75" aria-hidden>
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

export function ImpostazioniRegistrazione() {
  const preferenze = usePreferenzeRegistrazione();
  const { prefs, salvando } = preferenze;
  const [cartella, setCartella] = useState("");
  const [provaMicrofono, setProvaMicrofono] = useState(false);

  // la cartella si scrive a mano e si conferma con CAMBIA: parte dal file
  const cartellaSalvata = prefs?.save_folder;
  useEffect(() => {
    if (cartellaSalvata !== undefined) setCartella(cartellaSalvata);
  }, [cartellaSalvata]);

  const salva = (nuove: Parameters<typeof preferenze.salva>[0]) =>
    preferenze.salva(nuove).then(
      () => toast.success("Salvato", { duration: 2000 }),
      (errore) =>
        toast.error("Non salvato", { description: getErrorMessage(errore), duration: 8000 }),
    );

  // il microfono che si ascolta nella prova: quello scelto, oppure «default»,
  // il nome che il monitor del backend risolve da solo (sulla scheda mentre
  // registra si fa cosi'; il nome lungo di Windows il 15-09 non combaciava)
  const microfonoInUso = prefs?.preferred_mic_device ?? "default";
  const livelli = useAudioLevels(provaMicrofono ? [microfonoInUso] : null);
  const valori = useBarrette(livelli);

  return (
    <div>
      <MenuApparecchi preferenze={preferenze} forma="campo" className={classeValore} Campo={Campo} />

      <Campo nome="Cartella delle registrazioni">
        <input
          className={classeValore}
          value={cartella}
          disabled={!prefs || salvando}
          onChange={(e) => setCartella(e.target.value)}
          spellCheck={false}
        />
        <button
          type="button"
          className={classeBottone}
          disabled={!prefs || salvando || cartella === prefs?.save_folder}
          onClick={() => void salva({ save_folder: cartella })}
        >
          CAMBIA
        </button>
        <button
          type="button"
          className={classeBottone}
          onClick={() => void invoke("open_recordings_folder").catch(() => undefined)}
        >
          APRI
        </button>
      </Campo>

      <Campo nome="Prova il microfono" sotto="parla, e guardi le barrette">
        {provaMicrofono && <Barrette valori={valori} />}
        <button
          type="button"
          className={classeBottone}
          onClick={() => setProvaMicrofono((v) => !v)}
        >
          {provaMicrofono ? "BASTA" : "PROVA"}
        </button>
      </Campo>
    </div>
  );
}

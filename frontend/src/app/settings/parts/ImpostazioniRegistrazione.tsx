"use client";

// La sezione Registrazione (galleria 15, numero 2): da dove si prende l'audio
// e dove finisce, piu' «Prova il microfono». Prende il posto di
// `RecordingSettings` di Meetily, che resta nel repo.
//
// I due apparecchi sono quelli che la registrazione usa davvero: se non c'e'
// una scelta, i predefiniti di Windows (`get_default_audio_devices`), gli
// stessi che prende `start_recording`.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import type { AudioDevice } from "@/components/DeviceSelection";
import type { RecordingPreferences } from "@/components/RecordingSettings";
import { useAudioLevels } from "@/hooks/useAudioLevels";
import { useBarrette } from "@/hooks/useBarrette";
import { getErrorMessage } from "@/lib/utils";

const PREDEFINITO = "";

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
  const [prefs, setPrefs] = useState<RecordingPreferences | null>(null);
  const [apparecchi, setApparecchi] = useState<AudioDevice[]>([]);
  const [predefiniti, setPredefiniti] = useState<[string | null, string | null]>([null, null]);
  const [cartella, setCartella] = useState("");
  const [provaMicrofono, setProvaMicrofono] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let annullato = false;
    void (async () => {
      try {
        const p = await invoke<RecordingPreferences>("get_recording_preferences");
        if (annullato) return;
        setPrefs(p);
        setCartella(p.save_folder);
      } catch (errore) {
        console.info("[impostazioni] preferenze non leggibili", errore);
      }
      try {
        const elenco = await invoke<AudioDevice[]>("get_audio_devices");
        if (!annullato && Array.isArray(elenco)) setApparecchi(elenco);
      } catch (errore) {
        console.info("[impostazioni] apparecchi non leggibili", errore);
      }
      try {
        const coppia = await invoke<[string | null, string | null]>("get_default_audio_devices");
        if (!annullato && Array.isArray(coppia)) setPredefiniti(coppia);
      } catch (errore) {
        console.info("[impostazioni] predefiniti non leggibili", errore);
      }
    })();
    return () => {
      annullato = true;
    };
  }, []);

  const salva = async (nuove: Partial<RecordingPreferences>) => {
    if (!prefs) return;
    const p = { ...prefs, ...nuove };
    setSalvando(true);
    try {
      await invoke("set_recording_preferences", { preferences: p });
      setPrefs(p);
      toast.success("Salvato", { duration: 2000 });
    } catch (errore) {
      toast.error("Non salvato", { description: getErrorMessage(errore), duration: 8000 });
    } finally {
      setSalvando(false);
    }
  };

  const ingressi = apparecchi.filter((d) => d.device_type === "Input" && d.name !== "default");
  const uscite = apparecchi.filter((d) => d.device_type === "Output" && d.name !== "default");

  // il microfono che si ascolta nella prova: quello scelto, oppure «default»,
  // il nome che il monitor del backend risolve da solo (sulla scheda mentre
  // registra si fa cosi'; il nome lungo di Windows il 15-09 non combaciava)
  const microfonoInUso = prefs?.preferred_mic_device ?? "default";
  const livelli = useAudioLevels(provaMicrofono ? [microfonoInUso] : null);
  const valori = useBarrette(livelli);

  return (
    <div>
      <Campo nome="Microfono">
        <select
          className={classeValore}
          value={prefs?.preferred_mic_device ?? PREDEFINITO}
          disabled={!prefs || salvando}
          onChange={(e) => void salva({ preferred_mic_device: e.target.value || null })}
        >
          <option value={PREDEFINITO}>
            Predefinito di Windows{predefiniti[0] ? ` · ${predefiniti[0]}` : ""}
          </option>
          {ingressi.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>
      </Campo>

      <Campo nome="Audio del PC" sotto="quello che senti tu: Teams, le cuffie">
        <select
          className={classeValore}
          value={prefs?.preferred_system_device ?? PREDEFINITO}
          disabled={!prefs || salvando}
          onChange={(e) => void salva({ preferred_system_device: e.target.value || null })}
        >
          <option value={PREDEFINITO}>
            Predefinito di Windows{predefiniti[1] ? ` · ${predefiniti[1]}` : ""}
          </option>
          {uscite.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>
      </Campo>

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

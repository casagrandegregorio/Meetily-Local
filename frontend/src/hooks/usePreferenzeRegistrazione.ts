"use client";

// La scelta del microfono e dell'audio del PC ha UNA memoria sola: il file
// delle preferenze del backend (`recording_preferences.json`). Questo hook e'
// l'unico modo con cui la pagina la legge e la scrive.
//
// Perche' cosi': il 18-09 la pagina teneva una sua copia della scelta
// (`selectedDevices` nel ConfigContext), letta una volta all'avvio. Le
// Impostazioni scrivevano il file, la copia restava vecchia, Registra mandava
// la copia, e una riunione di 37 minuti e' uscita muta sui predefiniti di
// Windows. Adesso Registra non manda nomi: il motore legge il file da solo al
// momento dello Start (`scegli_apparecchi` in `recording_commands.rs`). La
// pagina legge il file solo per MOSTRARE la scelta e per cambiarla.
//
// Piu' copie di questo hook (la scheda e le Impostazioni) si tengono allineate
// con un evento sulla finestra: chi salva lo dice, gli altri rileggono.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { AudioDevice } from "@/components/DeviceSelection";
import type { RecordingPreferences } from "@/components/RecordingSettings";

const EVENTO = "preferenze-registrazione-cambiate";

export interface PreferenzeRegistrazione {
  /** il file, o `null` finche' non e' arrivato */
  prefs: RecordingPreferences | null;
  /** l'elenco degli apparecchi, senza la voce «default» di CPAL */
  ingressi: AudioDevice[];
  uscite: AudioDevice[];
  /** i predefiniti di Windows: [microfono, uscita] */
  predefiniti: [string | null, string | null];
  /** il nome che la registrazione usera' davvero: la scelta, o il predefinito */
  microfonoInUso: string | null;
  audioPcInUso: string | null;
  salvando: boolean;
  /** scrive nel file e avvisa le altre copie; lancia se il backend dice di no */
  salva: (nuove: Partial<RecordingPreferences>) => Promise<void>;
  /**
   * rilegge l'elenco e i predefiniti di Windows: lo chiede il menu quando si
   * apre, cosi' le cuffie accese dopo (anche a registrazione in corso, 10-11)
   * compaiono senza riaprire la pagina
   */
  rileggiApparecchi: () => void;
}

export function usePreferenzeRegistrazione(): PreferenzeRegistrazione {
  const [prefs, setPrefs] = useState<RecordingPreferences | null>(null);
  const [apparecchi, setApparecchi] = useState<AudioDevice[]>([]);
  const [predefiniti, setPredefiniti] = useState<[string | null, string | null]>([null, null]);
  const [salvando, setSalvando] = useState(false);

  const leggiPrefs = useCallback(async () => {
    try {
      setPrefs(await invoke<RecordingPreferences>("get_recording_preferences"));
    } catch (errore) {
      console.info("[preferenze] non leggibili", errore);
    }
  }, []);

  // `vivo` dice se la copia dell'hook c'e' ancora: una risposta che arriva
  // dopo che la scheda e' sparita non scrive niente
  const vivo = useRef(true);
  const leggiApparecchi = useCallback(async () => {
    try {
      const elenco = await invoke<AudioDevice[]>("get_audio_devices");
      if (vivo.current && Array.isArray(elenco)) setApparecchi(elenco);
    } catch (errore) {
      console.info("[preferenze] apparecchi non leggibili", errore);
    }
    try {
      const coppia = await invoke<[string | null, string | null]>("get_default_audio_devices");
      if (vivo.current && Array.isArray(coppia)) setPredefiniti(coppia);
    } catch (errore) {
      console.info("[preferenze] predefiniti non leggibili", errore);
    }
  }, []);

  useEffect(() => {
    vivo.current = true;
    void leggiPrefs();
    void leggiApparecchi();
    const rileggi = () => void leggiPrefs();
    window.addEventListener(EVENTO, rileggi);
    return () => {
      vivo.current = false;
      window.removeEventListener(EVENTO, rileggi);
    };
  }, [leggiPrefs, leggiApparecchi]);

  const rileggiApparecchi = useCallback(() => void leggiApparecchi(), [leggiApparecchi]);

  const salva = useCallback(
    async (nuove: Partial<RecordingPreferences>) => {
      if (!prefs) return;
      const p = { ...prefs, ...nuove };
      setSalvando(true);
      try {
        await invoke("set_recording_preferences", { preferences: p });
        setPrefs(p);
        window.dispatchEvent(new Event(EVENTO));
      } finally {
        setSalvando(false);
      }
    },
    [prefs],
  );

  const ingressi = apparecchi.filter((d) => d.device_type === "Input" && d.name !== "default");
  const uscite = apparecchi.filter((d) => d.device_type === "Output" && d.name !== "default");

  return {
    prefs,
    ingressi,
    uscite,
    predefiniti,
    microfonoInUso: prefs?.preferred_mic_device ?? predefiniti[0],
    audioPcInUso: prefs?.preferred_system_device ?? predefiniti[1],
    salvando,
    salva,
    rileggiApparecchi,
  };
}

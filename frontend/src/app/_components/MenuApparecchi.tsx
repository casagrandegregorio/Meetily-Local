"use client";

// I due menu del microfono e dell'audio del PC nelle Impostazioni. Scrivono
// nel file delle preferenze, tramite `usePreferenzeRegistrazione`. Sulla
// scheda «Pronta a registrare» dal 25-09 c'e' `StrisciaApparecchi` (galleria
// 22), che scrive nello stesso file; la forma «pastiglia» di qui e' caduta.
//
// La prima voce e' sempre «Predefinito di Windows», col nome di quello che
// Windows ha in quel momento: senza una scelta la registrazione va li'.
import { toast } from "sonner";

import type { PreferenzeRegistrazione } from "@/hooks/usePreferenzeRegistrazione";
import { getErrorMessage } from "@/lib/utils";

const PREDEFINITO = "";

interface MenuApparecchiProps {
  preferenze: PreferenzeRegistrazione;
  /** lo stile del menu (lo da' la pagina Impostazioni) */
  className?: string;
  /** cosa avvolge ciascun menu */
  Campo: (props: { nome: string; sotto?: string; children: React.ReactNode }) => React.ReactNode;
}

export function MenuApparecchi({ preferenze, className, Campo }: MenuApparecchiProps) {
  const { prefs, ingressi, uscite, predefiniti, salvando, salva } = preferenze;

  const cambia = (nuove: Parameters<typeof salva>[0]) =>
    salva(nuove).then(
      () => toast.success("Salvato", { duration: 2000 }),
      (errore) =>
        toast.error("Non salvato", { description: getErrorMessage(errore), duration: 8000 }),
    );

  const classe = className;

  const menuMicrofono = (
    <select
      className={classe}
      aria-label="Microfono"
      value={prefs?.preferred_mic_device ?? PREDEFINITO}
      disabled={!prefs || salvando}
      onChange={(e) => void cambia({ preferred_mic_device: e.target.value || null })}
    >
      <option value={PREDEFINITO}>
        {`Predefinito di Windows${predefiniti[0] ? ` · ${predefiniti[0]}` : ""}`}
      </option>
      {ingressi.map((d) => (
        <option key={d.name} value={d.name}>
          {d.name}
        </option>
      ))}
    </select>
  );

  const menuAudioPc = (
    <select
      className={classe}
      aria-label="Audio del PC"
      value={prefs?.preferred_system_device ?? PREDEFINITO}
      disabled={!prefs || salvando}
      onChange={(e) => void cambia({ preferred_system_device: e.target.value || null })}
    >
      <option value={PREDEFINITO}>
        {`Predefinito di Windows${predefiniti[1] ? ` · ${predefiniti[1]}` : ""}`}
      </option>
      {uscite.map((d) => (
        <option key={d.name} value={d.name}>
          {d.name}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <Campo nome="Microfono">{menuMicrofono}</Campo>
      <Campo nome="Audio del PC" sotto="quello che senti tu: Teams, le cuffie">
        {menuAudioPc}
      </Campo>
    </>
  );
}

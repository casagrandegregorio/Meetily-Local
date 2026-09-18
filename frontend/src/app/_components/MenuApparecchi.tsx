"use client";

// I due menu del microfono e dell'audio del PC: lo stesso pezzo nelle
// Impostazioni e sulla scheda «Pronta a registrare» (Greg, 18-09: cambiarli
// anche dalla pagina Registra, non solo dalle Impostazioni). Scrivono tutti e
// due nel file delle preferenze, tramite `usePreferenzeRegistrazione`.
//
// La prima voce e' sempre «Predefinito di Windows», col nome di quello che
// Windows ha in quel momento: senza una scelta la registrazione va li'.
import { toast } from "sonner";

import type { PreferenzeRegistrazione } from "@/hooks/usePreferenzeRegistrazione";
import { getErrorMessage } from "@/lib/utils";

const PREDEFINITO = "";

// I nomi degli apparecchi sono lunghi («Microphone Array (Intel Smart
// Sound)»): nella forma a pastiglia si tiene solo la parte prima della
// parentesi, come facevano le pastiglie di prima.
export const nomeCorto = (nome?: string | null) =>
  nome ? nome.split("(")[0].trim() : "";

interface MenuApparecchiProps {
  preferenze: PreferenzeRegistrazione;
  /** «pastiglia»: i due menu piccoli e affiancati, per la scheda */
  forma: "campo" | "pastiglia";
  /** lo stile del menu nella forma «campo» (lo da' la pagina Impostazioni) */
  className?: string;
  /** cosa avvolge ciascun menu nella forma «campo» */
  Campo?: (props: { nome: string; sotto?: string; children: React.ReactNode }) => React.ReactNode;
}

export function MenuApparecchi({ preferenze, forma, className, Campo }: MenuApparecchiProps) {
  const { prefs, ingressi, uscite, predefiniti, salvando, salva } = preferenze;

  const cambia = (nuove: Parameters<typeof salva>[0]) =>
    salva(nuove).then(
      () => forma === "campo" && toast.success("Salvato", { duration: 2000 }),
      (errore) =>
        toast.error("Non salvato", { description: getErrorMessage(errore), duration: 8000 }),
    );

  const pastiglia =
    "max-w-52 truncate rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground hover:text-foreground";
  const classe = forma === "pastiglia" ? pastiglia : className;

  const menuMicrofono = (
    <select
      className={classe}
      aria-label="Microfono"
      value={prefs?.preferred_mic_device ?? PREDEFINITO}
      disabled={!prefs || salvando}
      onChange={(e) => void cambia({ preferred_mic_device: e.target.value || null })}
    >
      <option value={PREDEFINITO}>
        {forma === "pastiglia"
          ? `${nomeCorto(predefiniti[0]) || "Microfono"} · predefinito`
          : `Predefinito di Windows${predefiniti[0] ? ` · ${predefiniti[0]}` : ""}`}
      </option>
      {ingressi.map((d) => (
        <option key={d.name} value={d.name}>
          {forma === "pastiglia" ? nomeCorto(d.name) : d.name}
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
        {forma === "pastiglia"
          ? `${nomeCorto(predefiniti[1]) || "Audio del PC"} · predefinito`
          : `Predefinito di Windows${predefiniti[1] ? ` · ${predefiniti[1]}` : ""}`}
      </option>
      {uscite.map((d) => (
        <option key={d.name} value={d.name}>
          {forma === "pastiglia" ? nomeCorto(d.name) : d.name}
        </option>
      ))}
    </select>
  );

  if (forma === "pastiglia" || !Campo) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {menuMicrofono}
        {menuAudioPc}
      </div>
    );
  }
  return (
    <>
      <Campo nome="Microfono">{menuMicrofono}</Campo>
      <Campo nome="Audio del PC" sotto="quello che senti tu: Teams, le cuffie">
        {menuAudioPc}
      </Campo>
    </>
  );
}

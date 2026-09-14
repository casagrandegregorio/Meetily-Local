"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useConfig } from "@/contexts/ConfigContext";
import { usePermissionCheck } from "@/hooks/usePermissionCheck";
import { useTrascritte } from "@/hooks/useTrascritte";
import { Spinner } from "@/components/ui/spinner";
import type { AudioDevice } from "@/components/DeviceSelection";
import { chiCera, durata, giorno } from "@/types/trascritta";

interface SchedaFermaProps {
  onStart: () => void;
  isStarting: boolean;
}

/**
 * Lo stato «ferma» della scheda al centro: il tondo ambra per partire e i due
 * apparecchi che ascoltano.
 *
 * E' la scheda della galleria 1 numero 4, col colore della galleria 2 numero 1
 * e la figura che cambia col lavoro della galleria 4 numero 2 — qui nel suo
 * primo momento. Gli altri cinque momenti (registra, registrata, trascrive,
 * pronta, muta) arrivano dopo, sulla stessa scheda.
 */
export function SchedaFerma({ onStart, isStarting }: SchedaFermaProps) {
  const { selectedDevices } = useConfig();
  const { hasMicrophone } = usePermissionCheck();
  const { trascritte } = useTrascritte();

  const disabilitato = isStarting || !hasMicrophone;

  // Nel contesto `null` vuol dire «quello di sistema», non «nessuno»: per
  // scrivere un nome sulla scheda serve comunque chiedere l'elenco.
  const [apparecchiVisti, setApparecchiVisti] = useState<AudioDevice[]>([]);
  useEffect(() => {
    let annullato = false;
    void (async () => {
      try {
        const elenco = await invoke<AudioDevice[]>("get_audio_devices");
        if (!annullato) setApparecchiVisti(elenco);
      } catch (errore) {
        console.info("[scheda] apparecchi non leggibili", errore);
      }
    })();
    return () => {
      annullato = true;
    };
  }, []);

  const primoDelTipo = (tipo: "Input" | "Output") =>
    apparecchiVisti.find((d) => d.device_type === tipo && d.name !== "default")
      ?.name ?? null;

  // I nomi degli apparecchi sono lunghi («Microphone Array (Intel Smart
  // Sound)»): sulla scheda si tiene solo la parte prima della parentesi.
  const nomeCorto = (nome?: string | null) =>
    nome ? nome.split("(")[0].trim() : null;
  const apparecchi = [
    nomeCorto(selectedDevices?.micDevice ?? primoDelTipo("Input")),
    nomeCorto(selectedDevices?.systemDevice ?? primoDelTipo("Output")),
  ].filter((n): n is string => Boolean(n));

  // L'ultima riunione con un testo, dallo stesso elenco di «Trascritte»: la
  // riga sulla scheda ha la stessa forma di quelle dell'elenco, data · chi
  // c'era · durata. Prima leggeva `useSidebar().meetings`, cioe' l'archivio
  // di Meetily, che nel finto aveva un titolo inventato.
  const ultima = trascritte[0];

  return (
    <div className="flex w-full flex-col items-center justify-center gap-4 px-6 py-10">
      <div className="flex w-117.5 max-w-full items-center gap-6 rounded-2xl border border-border bg-card px-7 py-6">
        <button
          type="button"
          onClick={onStart}
          disabled={disabilitato}
          aria-label="Registra"
          className={`flex size-27 flex-none items-center justify-center rounded-full text-sm font-bold tracking-wide transition-all duration-150 ${
            disabilitato
              ? "cursor-not-allowed bg-muted text-muted-foreground"
              : "bg-ambra text-ambra-foreground hover:scale-105 hover:ring-8 hover:ring-ambra/15 active:scale-95"
          }`}
        >
          {isStarting ? <Spinner size="lg" /> : "REGISTRA"}
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="text-lg font-medium">
            {hasMicrophone ? "Pronta a registrare" : "Nessun microfono"}
          </div>

          {apparecchi.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {apparecchi.map((nome) => (
                <span
                  key={nome}
                  className="inline-flex rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground"
                >
                  {nome}
                </span>
              ))}
            </div>
          )}

          {ultima && (
            <div className="text-sm text-muted-foreground">
              Ultima: {giorno(ultima.recorded_at)} · {chiCera(ultima)} ·{" "}
              {durata(ultima.minutes)}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

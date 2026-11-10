"use client";

// Il microfono spento mentre registra (10-11).
//
// Greg in ufficio: la gente intorno parla sopra la riunione. Spegnendo il
// microfono, nella registrazione resta solo l'audio del PC (Teams). Il motore
// pero' continua ad ASCOLTARE il microfono, senza registrarlo: se sente
// parlare forte e a lungo manda `parli-da-muto`, e qui compare l'avviso con
// «Riaccendi» (piu' una notifica di Windows, che si vede anche con Teams a
// tutto schermo). Non sa distinguere la voce di Greg da quella di un collega
// vicino: per questo e' un avviso, mai un'accensione da sola.
//
// Ogni registrazione parte col microfono acceso: lo rimette il motore allo
// Start e allo Stop.
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

import { getErrorMessage } from "@/lib/utils";

export const COMANDO_MUTO = "imposta_muto";
export const COMANDO_E_MUTO = "microfono_muto";
export const EVENTO_PARLI_DA_MUTO = "parli-da-muto";

export function useMicrofonoMuto(registra: boolean) {
  const [muto, setMuto] = useState(false);

  // a ogni registrazione nuova si chiede al motore com'e' (parte acceso)
  useEffect(() => {
    if (!registra) {
      const t = setTimeout(() => setMuto(false), 0);
      return () => clearTimeout(t);
    }
    let vivo = true;
    invoke<boolean>(COMANDO_E_MUTO)
      .then((m) => vivo && setMuto(m === true))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [registra]);

  const imposta = useCallback(async (nuovo: boolean) => {
    try {
      await invoke(COMANDO_MUTO, { muto: nuovo });
      setMuto(nuovo);
      toast.dismiss(EVENTO_PARLI_DA_MUTO);
    } catch (errore) {
      toast.error(nuovo ? "Microfono non spento" : "Microfono non riacceso", {
        description: getErrorMessage(errore),
      });
    }
  }, []);

  // l'avviso: uno alla volta (stesso id), con «Riaccendi»
  useEffect(() => {
    if (!registra) return;
    let via: (() => void) | undefined;
    let annullato = false;
    void (async () => {
      try {
        const smetti = await listen(EVENTO_PARLI_DA_MUTO, () => {
          toast.warning("Stai parlando? Il microfono è spento", {
            id: EVENTO_PARLI_DA_MUTO,
            description: "Quello che dici adesso non va nella registrazione.",
            duration: 15000,
            action: { label: "Riaccendi", onClick: () => void imposta(false) },
          });
        });
        if (annullato) smetti();
        else via = smetti;
      } catch (errore) {
        console.warn("[muto] non ascolto l'avviso", errore);
      }
    })();
    return () => {
      annullato = true;
      via?.();
    };
  }, [registra, imposta]);

  return { muto, alterna: () => void imposta(!muto) };
}

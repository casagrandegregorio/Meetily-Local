"use client";

import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";

import { Page } from "@/components/layout/Page";
import { useArretrate } from "@/hooks/useArretrate";
import { useLavori } from "@/contexts/LavoriContext";
import { getErrorMessage } from "@/lib/utils";
import { COMANDO_CESTINO, type Arretrata } from "@/types/arretrata";

import { PaginaArretrate } from "@/app/_components/scheda/PaginaArretrate";

/** Il posto «Da trascrivere»: le registrazioni sul disco senza testo. */
export default function DaTrascrivere() {
  const { arretrate } = useArretrate();
  const { lavori, avvia, segnala } = useLavori();

  // TRASCRIVI su una riga: l'anello compare sulla riga stessa e si resta qui
  // (galleria 11, numero 1). Si puo' registrare intanto: la trascrizione e'
  // un programma a parte.
  const trascrivi = (arretrata: Arretrata) => {
    avvia(arretrata.folder, arretrata.minutes).catch((errore) =>
      toast.error("Non parte", { description: getErrorMessage(errore), duration: 12000 }),
    );
  };

  // Nel Cestino di Windows, non cancellata: si recupera da li'. La conferma
  // e' sulla riga. Dopo, gli elenchi e il pallino si ricaricano.
  const cestino = (arretrata: Arretrata) => {
    invoke(COMANDO_CESTINO, { folder: arretrata.folder })
      .then(() => {
        toast.success("Nel Cestino", { description: arretrata.folder, duration: 4000 });
        segnala();
      })
      .catch((errore) =>
        toast.error("Non ci sono riuscita", { description: getErrorMessage(errore), duration: 8000 }),
      );
  };

  return (
    <Page>
      <PaginaArretrate
        arretrate={arretrate}
        lavori={lavori}
        onTrascrivi={trascrivi}
        onCestino={cestino}
      />
    </Page>
  );
}

"use client";

import { toast } from "sonner";

import { Page } from "@/components/layout/Page";
import { useArretrate } from "@/hooks/useArretrate";
import { useLavori } from "@/contexts/LavoriContext";
import { getErrorMessage } from "@/lib/utils";
import type { Arretrata } from "@/types/arretrata";

import { PaginaArretrate } from "@/app/_components/scheda/PaginaArretrate";

/** Il posto «Da trascrivere»: le registrazioni sul disco senza testo. */
export default function DaTrascrivere() {
  const { arretrate } = useArretrate();
  const { lavori, avvia } = useLavori();

  // TRASCRIVI su una riga: l'anello compare sulla riga stessa e si resta qui
  // (galleria 11, numero 1). Si puo' registrare intanto: la trascrizione e'
  // un programma a parte.
  const trascrivi = (arretrata: Arretrata) => {
    avvia(arretrata.folder, arretrata.minutes).catch((errore) =>
      toast.error("Non parte", { description: getErrorMessage(errore), duration: 12000 }),
    );
  };

  return (
    <Page>
      <PaginaArretrate arretrate={arretrate} lavori={lavori} onTrascrivi={trascrivi} />
    </Page>
  );
}

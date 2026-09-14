"use client";

import { Page } from "@/components/layout/Page";
import { useArretrate } from "@/hooks/useArretrate";
import type { Arretrata } from "@/types/arretrata";

import { PaginaArretrate } from "@/app/_components/scheda/PaginaArretrate";

/** Il posto «Da trascrivere»: le registrazioni sul disco senza testo. */
export default function DaTrascrivere() {
  const { arretrate } = useArretrate();

  // La trascrizione vera arriva con l'idraulica. Per ora si vede solo che il
  // pulsante e' vivo e sa quale registrazione ha sotto.
  const trascrivi = (arretrata: Arretrata) => {
    console.info("[arretrate] TRASCRIVI", arretrata.folder);
  };

  return (
    <Page>
      <PaginaArretrate arretrate={arretrate} onTrascrivi={trascrivi} />
    </Page>
  );
}

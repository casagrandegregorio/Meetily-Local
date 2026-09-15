// I riassunti in corso, fuori da React: sopravvivono al cambio di pagina.
//
// RIASSUMI (galleria 14, numero 1) chiede al motore di Meetily
// (`api_process_transcript`, il modello locale «builtin-ai») un riassunto del
// testo; il motore lavora per `meeting_id` e le sue tabelle puntano a
// `meetings(id)`, per questo prima si crea la riga (`ensure_meeting_for_folder`,
// id = nome della cartella). Poi si chiede a che punto e' ogni tre secondi
// (`api_get_summary`) e, a cose fatte, il markdown si scrive accanto al testo
// (`write_summary` → `riassunto.md`): anche il riassunto lo ricorda il disco.
//
// Il modello gira sul processore: su una riunione lunga puo' volerci un
// quarto d'ora. Meetily stesso si arrende dopo 15 minuti; qui il tetto e' 40.
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

export type StatoRiassunto =
  | { fase: "lavora"; iniziatoAlle: number }
  | { fase: "fatto"; markdown: string }
  | { fase: "errore"; messaggio: string };

const OGNI_MS = 3000;
const TETTO_MS = 40 * 60 * 1000;
const TEMPLATE = "standard_meeting";
const PROMPT = "Scrivi tutto in italiano, in modo chiaro e breve.";

const stati = new Map<string, StatoRiassunto>();
const ascoltatori = new Set<() => void>();

function avvisa() {
  for (const f of ascoltatori) f();
}

function metti(folder: string, stato: StatoRiassunto) {
  stati.set(folder, stato);
  avvisa();
}

/** Il modello locale da usare: quello scelto in Meetily se e' «builtin-ai», altrimenti il primo disponibile. */
async function modelloLocale(preferito: string | null): Promise<string> {
  if (preferito) return preferito;
  const disponibile = await invoke<string | null>("builtin_ai_get_available_summary_model");
  if (!disponibile) {
    throw new Error(
      "Nessun modello locale per il riassunto: scaricalo in Impostazioni → Riassunto.",
    );
  }
  return disponibile;
}

function pausa(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fa partire il riassunto di una riunione. `testo` e' `trascrizione.md`
 * com'e'; `modelloPreferito` e' quello delle impostazioni, se locale.
 */
export function avviaRiassunto(folder: string, testo: string, modelloPreferito: string | null): void {
  const corrente = stati.get(folder);
  if (corrente?.fase === "lavora") return;
  metti(folder, { fase: "lavora", iniziatoAlle: Date.now() });

  void (async () => {
    try {
      const modello = await modelloLocale(modelloPreferito);
      const meetingId = await invoke<string>("ensure_meeting_for_folder", { folder });
      await invoke("api_process_transcript", {
        text: testo,
        model: "builtin-ai",
        modelName: modello,
        meetingId,
        chunkSize: 40000,
        overlap: 1000,
        customPrompt: PROMPT,
        templateId: TEMPLATE,
      });

      const dal = Date.now();
      for (;;) {
        await pausa(OGNI_MS);
        if (Date.now() - dal > TETTO_MS) {
          throw new Error("Il riassunto non e' arrivato in 40 minuti.");
        }
        const esito = await invoke<{
          status: string;
          data?: { markdown?: string } | null;
          error?: string | null;
        }>("api_get_summary", { meetingId });
        const stato = (esito?.status ?? "").toLowerCase();
        if (stato === "completed") {
          const markdown = esito.data?.markdown?.trim();
          if (!markdown) throw new Error("Il motore ha finito ma il riassunto e' vuoto.");
          await invoke("write_summary", { folder, text: markdown });
          metti(folder, { fase: "fatto", markdown });
          return;
        }
        if (stato === "failed" || stato === "error" || stato === "cancelled") {
          throw new Error(esito.error || `Il motore si e' fermato (${stato}).`);
        }
      }
    } catch (e) {
      metti(folder, { fase: "errore", messaggio: e instanceof Error ? e.message : String(e) });
    }
  })();
}

/** Mette da parte l'esito (dopo che e' stato letto o mostrato). */
export function dimenticaRiassunto(folder: string): void {
  if (stati.delete(folder)) avvisa();
}

function iscrivi(f: () => void) {
  ascoltatori.add(f);
  return () => {
    ascoltatori.delete(f);
  };
}

/** Lo stato del riassunto di una cartella, vivo: `undefined` se non se ne sta facendo uno. */
export function useStatoRiassunto(folder: string | null): StatoRiassunto | undefined {
  return useSyncExternalStore(
    iscrivi,
    () => (folder ? stati.get(folder) : undefined),
    () => undefined,
  );
}

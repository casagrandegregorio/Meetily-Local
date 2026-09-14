// I sei momenti della scheda al centro (galleria 5).
//
// La scheda e' una sola e cambia figura col lavoro (galleria 4, numero 2): il
// tondo mentre registra, l'anello della percentuale mentre trascrive, le prime
// righe del testo quando e' pronta. Questo tipo dice, momento per momento,
// cosa la scheda deve sapere per disegnarsi.
//
// I primi due momenti li da' Meetily (`RecordingStatus`). Gli altri quattro
// Meetily non li ha, perche' trascrive dal vivo: qui invece dopo lo Stop la
// registrazione resta «registrata» finche' Greg non preme TRASCRIVI (deciso
// l'08-09). Sono il contratto che il lato Rust dovra' rispettare.
import type { Turno } from "./trascrizione";

export type Momento =
  | { tipo: "ferma" }
  | {
      tipo: "registra";
      /** secondi dall'inizio; `null` finche' il backend non li manda */
      secondi: number | null;
    }
  | {
      tipo: "registrata";
      folder: string;
      minutes: number;
    }
  | {
      tipo: "trascrive";
      folder: string;
      /** minuti di audio gia' trascritti e minuti totali */
      fatti: number;
      totale: number;
    }
  | {
      tipo: "pronta";
      folder: string;
      minutes: number;
      voices: number;
      /** i primi turni del testo, quanti bastano per tre righe */
      prime: Turno[];
    }
  | {
      tipo: "muta";
      folder: string;
      minutes: number;
      /** quanto tempo, in percento, aveva voce dentro */
      percentoVoce: number;
    };

export type TipoMomento = Momento["tipo"];

export const TIPI_MOMENTO: TipoMomento[] = [
  "ferma",
  "registra",
  "registrata",
  "trascrive",
  "pronta",
  "muta",
];

/**
 * Quanto manca, in minuti, a finire una trascrizione: 0,09 secondi di scheda
 * grafica per ogni secondo di audio, misurato il 06-09 col modello grande su
 * Intel Arc.
 */
export const RAPPORTO_TRASCRIZIONE = 0.09;

export function minutiRestanti(fatti: number, totale: number): number {
  return Math.max(0, Math.ceil((totale - fatti) * RAPPORTO_TRASCRIZIONE));
}

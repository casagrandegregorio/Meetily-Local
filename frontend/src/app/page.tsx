"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { Page } from "@/components/layout/Page";
import {
  useRecordingState,
  RecordingStatus,
} from "@/contexts/RecordingStateContext";
import { useTranscripts } from "@/contexts/TranscriptContext";
import { useConfig } from "@/contexts/ConfigContext";
import { useModalState } from "@/hooks/useModalState";
import { useRecordingStateSync } from "@/hooks/useRecordingStateSync";
import { useRecordingStart } from "@/hooks/useRecordingStart";
import { useFermaRegistrazione } from "@/hooks/useFermaRegistrazione";
import { useTranscriptRecovery } from "@/hooks/useTranscriptRecovery";
import { TranscriptRecovery } from "@/components/TranscriptRecovery";
import { indexedDBService } from "@/services/indexedDBService";
import { getErrorMessage } from "@/lib/utils";

import { StatusOverlays } from "@/app/_components/StatusOverlays";
import { SettingsModals } from "./_components/SettingsModal";
// La scheda al centro nei suoi sei momenti prende il posto di `RecordingHero`
// (la schermata ferma di Meetily) e di `RecordingTopBar` + `TranscriptPanel`
// (il testo dal vivo mentre registra: qui non c'e', deciso da Greg). Restano
// nel repo, non montati.
import { SchedaRiunione } from "./_components/scheda/SchedaRiunione";
import { useLivelliRegistrazione } from "@/hooks/useLivelliRegistrazione";
import { useMomentoFinto } from "@/lib/momenti-finti";
import type { Momento } from "@/types/momento";
import { useLavori } from "@/contexts/LavoriContext";
import { useLettore } from "@/contexts/LettoreContext";
import { RigaLavoro } from "./_components/scheda/RigaLavoro";
import { COMANDO_CESTINO } from "@/types/arretrata";

export default function Home() {
  const router = useRouter();
  const recordingState = useRecordingState();
  const { transcriptModelConfig } = useConfig();
  const { setIsMeetingActive, refetchMeetings } = useSidebar();
  const { modals, messages, showModal, hideModal } =
    useModalState(transcriptModelConfig);

  const { status } = recordingState;

  // Page-local mirror of `isRecording`. The cross-cutting hook below keeps
  // this in sync with the global recording-state context (the "page only
  // updates after a successful Tauri response" semantic that several
  // call-sites depend on).
  const [isRecording, setIsRecordingState] = useState(false);
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const { isRecordingDisabled, setIsRecordingDisabled } = useRecordingStateSync(
    isRecording,
    setIsRecordingState,
    setIsMeetingActive,
  );
  const { handleRecordingStart } = useRecordingStart(
    isRecording,
    setIsRecordingState,
    showModal,
  );
  // Lo Stop nostro: ferma il backend e basta, la registrazione resta
  // «registrata». `useRecordingStop` di Meetily (trascrizione, database,
  // salto a meeting-details) resta nel repo, non usato.
  const { registrata, ferma, scarta } = useFermaRegistrazione(setIsRecordingState);
  // le trascrizioni in corso: la riga sottile sotto la scheda (galleria 12)
  const { lavori, avvia, chiudi, segnala } = useLavori();
  const { scarica } = useLettore();

  // Recovery
  const {
    recoverableMeetings,
    isRecovering: _isRecovering,
    checkForRecoverableTranscripts,
    recoverMeeting,
    loadMeetingTranscripts,
    deleteRecoverableMeeting,
  } = useTranscriptRecovery();
  void _isRecovering;

  // Startup checks (cleanup + recovery dialog) — same intent as the
  // previous version, just lifted into this composer.
  useEffect(() => {
    (async () => {
      try {
        if (
          recordingState.isRecording ||
          status === RecordingStatus.STOPPING ||
          status === RecordingStatus.PROCESSING_TRANSCRIPTS ||
          status === RecordingStatus.SAVING
        ) {
          return;
        }
        try {
          await indexedDBService.deleteOldMeetings(7);
        } catch (err) {
          console.warn("Failed to clean up old meetings:", err);
        }
        try {
          await indexedDBService.deleteSavedMeetings(24);
        } catch (err) {
          console.warn("Failed to clean up saved meetings:", err);
        }
        // La finestra «Recover Interrupted Meetings» di Meetily non si apre
        // piu' (16-09): parlava del suo archivio dei testi dal vivo, che qui
        // non si usa. Il controllo resta, per il registro.
        const meetings = await checkForRecoverableTranscripts();
        if (meetings.length > 0) {
          console.info("[avvio] riunioni recuperabili di Meetily, ignorate:", meetings.length);
        }
      } catch (err) {
        console.error("Startup checks failed:", err);
      }
    })();
  }, [checkForRecoverableTranscripts, recordingState.isRecording, status]);

  // Se il motore dice di no allo Start — per esempio il microfono scelto
  // non c'e' (le cuffie spente): «scegline un altro» — lo si legge in un
  // avviso. Nessuno disegna lo stato ERROR: senza questo il tondo tornava
  // ambra e basta, senza dire perche'.
  const handleStartClick = async () => {
    if (isRecordingDisabled || isRecording || isStarting) return;
    setIsStarting(true);
    try {
      await handleRecordingStart();
    } catch (errore) {
      toast.error("Non parte", { description: getErrorMessage(errore), duration: 12000 });
    } finally {
      setIsStarting(false);
    }
  };

  const handleRecovery = async (meetingId: string) => {
    try {
      const result = await recoverMeeting(meetingId);
      if (result.success) {
        toast.success("Meeting recovered successfully!", {
          description:
            result.audioRecoveryStatus?.status === "success"
              ? "Transcripts and audio recovered"
              : "Transcripts recovered (no audio available)",
          action: result.meetingId
            ? {
                label: "View Meeting",
                onClick: () =>
                  router.push(`/meeting-details?id=${result.meetingId}`),
              }
            : undefined,
          duration: 10000,
        });
        await refetchMeetings();
        if (recoverableMeetings.length === 0) {
          sessionStorage.removeItem("recovery_dialog_shown");
        }
        if (result.meetingId) {
          setTimeout(() => {
            router.push(`/meeting-details?id=${result.meetingId}`);
          }, 2000);
        }
      }
    } catch (err) {
      toast.error("Failed to recover meeting", {
        description: getErrorMessage(err),
      });
      throw err;
    }
  };

  const handleDialogClose = () => {
    setShowRecoveryDialog(false);
    if (recoverableMeetings.length === 0) {
      sessionStorage.removeItem("recovery_dialog_shown");
    }
  };

  // Surface backend transcription errors as page-level modals — the
  // legacy `RecordingControls` did this internally; we pulled it up here
  // when the new top bar replaced it.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await listen<{ message?: string; error?: string }>(
          "transcript-error",
          (event) => {
            const message =
              event.payload?.message ??
              event.payload?.error ??
              "Transcription error";
            showModal("errorAlert", message);
          },
        );
      } catch (err) {
        console.error("Failed to subscribe to transcript-error:", err);
      }
    })();
    return () => unlisten?.();
  }, [showModal]);

  // Auto-start hook: the sidebar may set this flag right before pushing
  // the user to home, asking us to start a recording immediately on
  // mount. Same protocol as the legacy implementation.
  useEffect(() => {
    if (sessionStorage.getItem("autoStartRecording") === "true") {
      sessionStorage.removeItem("autoStartRecording");
      void handleStartClick();
    }
    const onSidebarStart = () => {
      void handleStartClick();
    };
    window.addEventListener("start-recording-from-sidebar", onSidebarStart);
    return () =>
      window.removeEventListener(
        "start-recording-from-sidebar",
        onSidebarStart,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  // La sentinella del silenzio del motore (`sentinella_silenzio.rs`): dopo un
  // minuto e mezzo senza niente sopra il silenzio manda `registrazione-muta`
  // coi secondi, e `registrazione-suono` quando torna qualcosa. Qui: la
  // scheda lo scrive e un avviso resta finche' non si chiude. La notifica di
  // Windows la manda il motore da solo, per chi sta su Teams a tutto schermo.
  // Si tiene il secondo del cronometro in cui il silenzio e' cominciato
  // (l'avviso arriva coi secondi gia' guardati), cosi' la scheda dice da
  // quanto e il numero cresce col cronometro: fino al 25-09 restava fermo a
  // «Da 2 min» (90 s arrotondati).
  const cronometro = useRef(0);
  useEffect(() => {
    cronometro.current = recordingState.recordingDuration ?? 0;
  }, [recordingState.recordingDuration]);
  const [mutaDal, setMutaDal] = useState<number | null>(null);
  const silenzio =
    mutaDal == null ? null : Math.max(0, (recordingState.recordingDuration ?? 0) - mutaDal);
  useEffect(() => {
    if (!isRecording) {
      setMutaDal(null);
      return;
    }
    let viaMuta: (() => void) | undefined;
    let viaSuono: (() => void) | undefined;
    (async () => {
      try {
        viaMuta = await listen<{ secondi: number }>("registrazione-muta", (e) => {
          setMutaDal(cronometro.current - e.payload.secondi);
          toast.error("Non sento niente", {
            id: "registrazione-muta",
            description:
              "Negli ultimi 90 secondi non e' entrato quasi niente: controlla il microfono e l'audio del PC.",
            duration: Infinity,
          });
        });
        viaSuono = await listen("registrazione-suono", () => {
          setMutaDal(null);
          toast.dismiss("registrazione-muta");
        });
      } catch (errore) {
        console.error("Sentinella del silenzio non ascoltabile:", errore);
      }
    })();
    return () => {
      viaMuta?.();
      viaSuono?.();
      toast.dismiss("registrazione-muta");
    };
  }, [isRecording]);

  // Il momento della scheda, letto dallo stato vero: ferma, registra, e dopo
  // lo Stop «registrata» finche' non si preme TRASCRIVI. Poi la scheda torna
  // «ferma» subito (galleria 12, numero 2): la trascrizione si segue nella
  // riga sottile sotto, non sulla scheda. I momenti trascrive / pronta /
  // muta della scheda restano per il finto (`/?momento=pronta`).
  const momentoVero: Momento = isRecording
    ? { tipo: "registra", secondi: recordingState.recordingDuration, silenzio }
    : registrata
      ? { tipo: "registrata", ...registrata }
      : { tipo: "ferma" };

  // Nel finto, `/?momento=pronta` mostra un momento a scelta, con dati veri:
  // e' la galleria 5 dal vivo. Nell'app vera questa riga non fa niente.
  const momentoChiesto = useMomentoFinto();
  const momento = momentoChiesto ?? momentoVero;

  // Le due file di barrette mentre registra: microfono e audio del PC, mandate
  // dal motore dall'interno della registrazione (`misura_livelli.rs`), dove le
  // due sorgenti sono ancora separate. Fino al 24-09 qui si accendeva il
  // monitor dei livelli sul solo microfono: una fila sola, e dell'audio del PC
  // non si vedeva niente. Il monitor dei livelli resta acceso dove serve
  // ancora, cioe' in Impostazioni, «Prova il microfono».
  const livelli = useLivelliRegistrazione(momento.tipo === "registra");

  // la schermata in allarme: solo mentre registra, e solo se la sentinella
  // dice che non sta entrando niente
  const inAllarme = momento.tipo === "registra" && momento.silenzio != null;

  // TRASCRIVI: lancia il lavoro e libera la scheda; se il backend dice di no
  // (manca `uv`, o non sa dove sono gli script) lo dice in un avviso.
  // «Butta» mette la cartella nel Cestino di Windows, dopo la conferma
  // sulla scheda.
  const trascrivi = (folder: string) => {
    const minuti = momento.tipo === "registrata" ? momento.minutes : 0;
    avvia(folder, minuti).catch((errore) =>
      toast.error("Non parte", { description: getErrorMessage(errore), duration: 12000 }),
    );
    scarta();
  };
  const butta = (folder: string) => {
    scarica(folder);
    invoke(COMANDO_CESTINO, { folder })
      .then(() => {
        toast.success("Nel Cestino", { description: folder, duration: 4000 });
        segnala();
      })
      .catch((errore) =>
        toast.error("Non ci sono riuscita", { description: getErrorMessage(errore), duration: 8000 }),
      );
    scarta();
  };
  const apri = (folder: string) =>
    router.push(`/trascritte/leggi?folder=${encodeURIComponent(folder)}`);

  return (
    <Page>
      <SettingsModals modals={modals} messages={messages} onClose={hideModal} />

      <TranscriptRecovery
        isOpen={showRecoveryDialog}
        onClose={handleDialogClose}
        recoverableMeetings={recoverableMeetings}
        onRecover={handleRecovery}
        onDelete={deleteRecoverableMeeting}
        onLoadPreview={loadMeetingTranscripts}
      />

      {/* Quando la sentinella non sente niente diventa rossa tutta la
          schermata, e respira (galleria 20, il 2 col 3, scelto il 24-09): un
          filo rosso attorno alla scheda, con Teams a tutto schermo, non si
          vedeva. La colonna di sinistra resta com'e'. */}
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
          inAllarme ? "allarme-respira" : ""
        }`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={momento.tipo}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="flex min-h-0 w-full flex-1 items-center justify-center overflow-y-auto"
          >
            <div className="flex flex-col items-center gap-4">
              <SchedaRiunione
                momento={momento}
                livelli={livelli}
                onStart={handleStartClick}
                isStarting={isStarting || isRecordingDisabled}
                onStop={() => void ferma(recordingState.recordingDuration)}
                onTrascrivi={trascrivi}
                onButta={butta}
                onApri={apri}
              />
              {/* le trascrizioni in corso, subito sotto la scheda (galleria 12) */}
              {lavori.map((l) => (
                <RigaLavoro key={l.folder} lavoro={l} onApri={apri} onChiudi={chiudi} />
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <StatusOverlays
        isProcessing={
          status === RecordingStatus.PROCESSING_TRANSCRIPTS &&
          !recordingState.isRecording
        }
        isSaving={status === RecordingStatus.SAVING}
      />
    </Page>
  );
}

"use client";

import { useEffect, useState } from "react";
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
import { useAudioLevels } from "@/hooks/useAudioLevels";
import { useBarrette } from "@/hooks/useBarrette";
import { useMomentoFinto } from "@/lib/momenti-finti";
import type { Momento } from "@/types/momento";
import { useLavori } from "@/contexts/LavoriContext";
import { useLettore } from "@/contexts/LettoreContext";
import { RigaLavoro } from "./_components/scheda/RigaLavoro";
import { COMANDO_CESTINO } from "@/types/arretrata";

export default function Home() {
  const router = useRouter();
  const recordingState = useRecordingState();
  const { transcriptModelConfig, selectedDevices } = useConfig();
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

  const handleStartClick = async () => {
    if (isRecordingDisabled || isRecording || isStarting) return;
    setIsStarting(true);
    try {
      await handleRecordingStart();
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


  // Le barrette del livello mentre registra: l'apparecchio scelto, o quello di
  // sistema. Fuori dalla registrazione il monitor sta spento.
  const nomiDaAscoltare = isRecording
    ? [selectedDevices?.micDevice ?? "default"]
    : null;
  const livelliAudio = useAudioLevels(nomiDaAscoltare);
  const livelli = useBarrette(livelliAudio);

  // Il momento della scheda, letto dallo stato vero: ferma, registra, e dopo
  // lo Stop «registrata» finche' non si preme TRASCRIVI. Poi la scheda torna
  // «ferma» subito (galleria 12, numero 2): la trascrizione si segue nella
  // riga sottile sotto, non sulla scheda. I momenti trascrive / pronta /
  // muta della scheda restano per il finto (`/?momento=pronta`).
  const momentoVero: Momento = isRecording
    ? { tipo: "registra", secondi: recordingState.recordingDuration }
    : registrata
      ? { tipo: "registrata", ...registrata }
      : { tipo: "ferma" };

  // Nel finto, `/?momento=pronta` mostra un momento a scelta, con dati veri:
  // e' la galleria 5 dal vivo. Nell'app vera questa riga non fa niente.
  const momentoChiesto = useMomentoFinto();
  const momento = momentoChiesto ?? momentoVero;

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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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

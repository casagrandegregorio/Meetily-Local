"use client";

import { Toaster } from "sonner";

// Fuori da Tauri (cioe' nel browser, durante lo sviluppo) l'app morirebbe alla
// prima chiamata di finestra: il finto la tiene in piedi. Dentro l'app vera non
// fa niente. Vedi src/lib/tauri-finto.ts.
import { installaTauriFinto } from "@/lib/tauri-finto";

installaTauriFinto();

import { TooltipProvider } from "@/components/ui/tooltip";
import { RecordingStateProvider } from "@/contexts/RecordingStateContext";
import { OllamaDownloadProvider } from "@/contexts/OllamaDownloadContext";
import { TranscriptProvider } from "@/contexts/TranscriptContext";
import { ConfigProvider } from "@/contexts/ConfigContext";
import { OnboardingProvider } from "@/contexts/OnboardingContext";
import { SidebarProvider } from "@/components/Sidebar/SidebarProvider";
// `RecordingPostProcessingProvider` non si monta piu': ascoltava
// `recording-stop-complete` e, da qualunque pagina, faceva partire la
// trascrizione, salvava nel database e saltava a meeting-details. Qui allo
// Stop la registrazione resta «registrata» finche' non si preme TRASCRIVI
// (deciso l'08-09). Resta nel repo; il nostro Stop e' `useFermaRegistrazione`.
import { ImportDialogProvider } from "@/contexts/ImportDialogContext";
import { LavoriProvider } from "@/contexts/LavoriContext";

import { TitleBar } from "@/components/TitleBar";
import { TauriThemeSync } from "@/components/TauriThemeSync";
import { ProviderStack } from "@/components/ProviderStack";
import { AppShell } from "@/components/layout/AppShell";
import { DownloadProgressToastProvider } from "@/components/shared/DownloadProgressToast";

import { ProductionContextMenuBlocker } from "@/components/bridges/ProductionContextMenuBlocker";
import { TrayRecordingBridge } from "@/components/bridges/TrayRecordingBridge";
import { FileDropBridge } from "@/components/bridges/FileDropBridge";

// Outer-to-inner. Each provider may consume the providers above it.
const PROVIDERS = [
  RecordingStateProvider,
  TranscriptProvider,
  ConfigProvider,
  OllamaDownloadProvider,
  OnboardingProvider,
  SidebarProvider,
  TooltipProvider,
  ImportDialogProvider,
  // le trascrizioni in corso, viste da Registra, Da trascrivere e dalla barra
  LavoriProvider,
];

// Client side of the root layout: providers, bridges, dynamic UI. The
// server-side `layout.tsx` owns <html>/<body> + metadata and wraps this.
export default function RootLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* App-wide DOM/window concerns. Each does one thing. */}
      <TauriThemeSync />
      <ProductionContextMenuBlocker />

      {/* TitleBar replaces native window decorations on every platform
          (Tauri/GTK forces CSD on Linux, which never matches the system
          theme). It sits outside the provider stack since it only needs
          the Tauri window API. */}
      <div className="flex h-screen flex-col">
        <TitleBar />
        <ProviderStack providers={PROVIDERS}>
          {/* Bridges from native (tray, drag-drop) to in-app actions.
              They live inside the provider stack so they can consume
              useOnboarding / useConfig / useImportDialog. */}
          <TrayRecordingBridge />
          <FileDropBridge />
          <DownloadProgressToastProvider />
          <AppShell>{children}</AppShell>
        </ProviderStack>
      </div>

      <Toaster position="bottom-center" richColors closeButton />
    </>
  );
}

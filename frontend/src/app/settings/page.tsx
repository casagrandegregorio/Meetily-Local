"use client";

// Impostazioni (galleria 15, numero 2, piu' il Calendario, meno il Riassunto
// — tolto il 15-09 col modello locale): quattro sezioni,
// solo le cose che sappiamo funzionare. Le sette di Meetily — General,
// Recordings, Speakers, Transcription, Summary, Calendar, Beta — stanno in
// `page-meetily.tsx.txt`, accanto, fuori dalla compilazione: la scelta del
// modello Whisper, le Beta e le preferenze generali non servono piu' (la
// trascrizione dal vivo e' spenta, il testo lo fanno i nostri script).
//
// Il Calendario e' il componente di Meetily com'era: «se funziona, e' carino».
import { useState } from "react";
import { ArrowLeft, CalendarDays, Mic, Users, FileText } from "lucide-react";
import { useRouter } from "next/navigation";

import { CalendarSettings } from "@/components/CalendarSettings";
import { Button } from "@/components/ui/button";
import { Page, PageBody } from "@/components/layout/Page";

import { SettingsSidebar, type SettingsCategory } from "./parts/SettingsSidebar";
import { SettingsSection } from "./parts/SettingsSection";
import { ImpostazioniRegistrazione } from "./parts/ImpostazioniRegistrazione";
import { ImpostazioniPersone, ImpostazioniTrascrizione } from "./parts/ImpostazioniTrascrizione";

const SEZIONI: readonly SettingsCategory[] = [
  {
    id: "registrazione",
    label: "Registrazione",
    description: "Da dove si prende l'audio, e dove finisce.",
    icon: Mic,
  },
  {
    id: "trascrizione",
    label: "Trascrizione",
    description: "Gli script che fanno il testo e riconoscono chi parla.",
    icon: FileText,
  },
  {
    id: "persone",
    label: "Persone",
    description: "Le voci che gli script conoscono gia'.",
    icon: Users,
  },
  {
    id: "calendario",
    label: "Calendario",
    description: "Un calendario (ICS) per dare un nome alle registrazioni.",
    icon: CalendarDays,
  },
] as const;

const PRIMA = SEZIONI[0].id;

export default function Impostazioni() {
  const router = useRouter();
  // `/settings#persone` apre direttamente quella sezione
  const [attiva, setAttiva] = useState<string>(() => {
    if (typeof window === "undefined") return PRIMA;
    const dalCancelletto = window.location.hash.replace(/^#/, "");
    return SEZIONI.some((s) => s.id === dalCancelletto) ? dalCancelletto : PRIMA;
  });

  const scegli = (id: string) => {
    setAttiva(id);
    window.history.replaceState(null, "", `#${id}`);
  };

  const sezione = SEZIONI.find((s) => s.id === attiva) ?? SEZIONI[0];

  return (
    <Page>
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-6 py-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2">
          <ArrowLeft className="size-4" />
          <span>Indietro</span>
        </Button>
        <h1 className="text-lg font-semibold">Impostazioni</h1>
      </div>

      <PageBody>
        <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-background">
          <SettingsSidebar categories={SEZIONI} activeId={attiva} onSelect={scegli} />
          <main className="min-w-0 flex-1">
            <SettingsSection title={sezione.label} description={sezione.description}>
              {sezione.id === "registrazione" && <ImpostazioniRegistrazione />}
              {sezione.id === "trascrizione" && <ImpostazioniTrascrizione />}
              {sezione.id === "persone" && <ImpostazioniPersone />}
              {sezione.id === "calendario" && <CalendarSettings />}
            </SettingsSection>
          </main>
        </div>
      </PageBody>
    </Page>
  );
}

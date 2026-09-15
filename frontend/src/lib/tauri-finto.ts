// Un finto Tauri, solo per lo sviluppo nel browser.
//
// Il frontend gira dentro Tauri, e le sue chiamate passano da
// `window.__TAURI_INTERNALS__`. Aperto in un browser normale quell'oggetto non
// esiste, e la barra del titolo muore subito su `getCurrentWindow()`: senza
// questo finto non si riesce nemmeno a GUARDARE l'interfaccia fuori dall'app,
// e per lavorare sul disegno delle schermate servirebbe ogni volta una
// compilazione completa.
//
// Non entra mai nell'app vera: si installa solo se `__TAURI_INTERNALS__` manca,
// cioe' quando NON siamo dentro Tauri.
const oggi = new Date();
const quandoFinto = (giorniFa: number) =>
  new Date(oggi.getTime() - giorniFa * 86400000).toISOString();

/** Vero quando gira il finto, cioe' nel browser e non dentro Tauri. */
export function siamoNelFinto(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).__TAURI_FINTO__);
}

// La registrazione finta: si accende con `start_recording*`, si spegne con
// `stop_recording`, e `is_recording` / `get_recording_state` dicono la verita'.
// Senza questo stato, dopo REGISTRA l'app chiedeva «sto registrando?» e la
// risposta fissa `false` la rimetteva ferma un attimo dopo.
let registrazioneFinta: { dal: number; folder: string } | null = null;
const statoRegistrazioneFinta = () => ({
  is_recording: registrazioneFinta !== null,
  is_paused: false,
  is_active: registrazioneFinta !== null,
  recording_duration: registrazioneFinta
    ? Math.floor((Date.now() - registrazioneFinta.dal) / 1000)
    : null,
  active_duration: registrazioneFinta
    ? Math.floor((Date.now() - registrazioneFinta.dal) / 1000)
    : null,
});

// Gli ascoltatori registrati con `listen` di Tauri, per poter mandare gli
// eventi che il backend vero manda: senza `recording-started` il contesto di
// Meetily non fa partire l'orologio, senza `recording-stopped` la scheda non
// sa in che cartella e' finita la registrazione.
const ascoltatoriFinti = new Map<number, { event: string; handler: number }>();
let prossimoAscoltatore = 1;
function emettiFinto(event: string, payload: unknown) {
  for (const { event: nome, handler } of ascoltatoriFinti.values()) {
    if (nome !== event) continue;
    const callback = (window as any)[`_${handler}`];
    if (typeof callback === "function") callback({ event, id: handler, payload });
  }
}

/** La cartella che Meetily creerebbe adesso: `Meeting AAAA-MM-GG_hh-mm-ss_...`. */
function cartellaFintaDiAdesso(): string {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, "0");
  const locale = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  const ora = `${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
  const utc = `${z(d.getUTCHours())}-${z(d.getUTCMinutes())}`;
  return `Meeting ${locale}_${ora}_${locale}_${utc}`;
}

function avviaRegistrazioneFinta() {
  registrazioneFinta = { dal: Date.now(), folder: cartellaFintaDiAdesso() };
  // il backend vero lo manda dopo un attimo, non dentro la chiamata
  setTimeout(() => emettiFinto("recording-started", null), 50);
  return null;
}

function fermaRegistrazioneFinta() {
  const folder = registrazioneFinta?.folder;
  registrazioneFinta = null;
  setTimeout(
    () =>
      emettiFinto("recording-stopped", {
        message: "Recording stopped",
        folder_path: folder ? `C:\\Users\\gcasagrande\\Music\\meetily-recordings\\${folder}` : undefined,
        meeting_name: folder,
      }),
    50,
  );
  return null;
}

// Le trascrizioni finte. Nell'app vera `start_transcription` lancia lo script
// e `transcription_progress` legge `avanzamento.json`; qui le fasi passano da
// sole, VENTI volte piu' veloci del vero (64 minuti di audio sarebbero 6
// minuti di scheda grafica: qui 17 secondi). `iniziato_il` viene spostato
// indietro dello stesso fattore, cosi' la stima dell'app (0,09 s per secondo
// di audio, `minutiFatti`) vede la fase del testo avanzare come nel vero.
// Le tre arretrate vere sono mute: la loro trascrizione finisce «muta»,
// come farebbe lo script.
const PIU_VELOCE = 20;
const RAPPORTO = 0.09;
interface TrascrizioneFinta {
  fase: "avviata" | "testo" | "voci" | "fatto" | "muta";
  dal: number; // ms, inizio della fase
  totale: number; // minuti
  timer?: ReturnType<typeof setTimeout>;
}
const trascrizioniFinte = new Map<string, TrascrizioneFinta>();
const ARRETRATE_FINTE = [
  { folder: "Meeting 2026-07-23_11-34-54_2026-07-23_09-34", minutes: 64, silent: true, percento_voce: 0 },
  { folder: "audio_2026-07-23_10-43", minutes: 64, silent: true, percento_voce: 0 },
  { folder: "audio_2026-07-23_10-41", minutes: 64, silent: true, percento_voce: 0 },
];
// le cartelle messe nel Cestino finto: spariscono dagli elenchi
const cestinoFinto = new Set<string>();
const fogliFinti = new Map<string, string>();
const testiButtati = new Set<string>();
const oraLocale = (ms: number) => {
  const d = new Date(ms);
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
};

function avviaTrascrizioneFinta({ folder }: { folder?: string }) {
  if (!folder) throw new Error("start_transcription: manca `folder`");
  const gia = trascrizioniFinte.get(folder);
  if (gia && gia.fase !== "fatto" && gia.fase !== "muta") {
    throw new Error(`"${folder}" si sta gia' trascrivendo.`);
  }
  const arretrata = ARRETRATE_FINTE.find((a) => a.folder === folder);
  const totale = arretrata?.minutes ?? 12;
  const t: TrascrizioneFinta = { fase: "avviata", dal: Date.now(), totale };
  trascrizioniFinte.set(folder, t);
  const passa = (fase: TrascrizioneFinta["fase"], dopoMs: number, poi?: () => void) => {
    t.timer = setTimeout(() => {
      t.fase = fase;
      t.dal = Date.now();
      poi?.();
    }, dopoMs);
  };
  const fine = (fase: "fatto" | "muta") =>
    passa(fase, fase === "muta" ? 1500 : 4000, () =>
      emettiFinto("transcription-finished", { folder, ok: fase === "fatto" }),
    );
  if (arretrata?.silent) {
    passa("avviata", 0, () => fine("muta"));
  } else {
    const msTesto = (totale * 60 * RAPPORTO * 1000) / PIU_VELOCE;
    passa("testo", 1500, () => passa("voci", msTesto, () => fine("fatto")));
  }
  return null;
}

function avanzamentoFinto({ folder }: { folder?: string }) {
  const t = folder ? trascrizioniFinte.get(folder) : undefined;
  if (!t) return null;
  const passatiVeri = (Date.now() - t.dal) * PIU_VELOCE;
  return {
    fase: t.fase,
    totale_minuti: t.fase === "avviata" ? null : t.totale,
    iniziato_il: oraLocale(Date.now() - passatiVeri),
    aggiornato_il: oraLocale(t.dal),
    percento_voce: t.fase === "muta" ? 1 : null,
    messaggio: null,
  };
}

const TRASCRITTE_FINTE = [
    trascritta("Meeting 2026-09-04_09-02-34_2026-09-04_07-02", 94, 3, ["Greg", "Marco"]),
    trascritta("Meeting 2026-09-03_09-22-44_2026-09-03_07-22", 24, 4, ["Stefano", "Marco", "Fabio"]),
    trascritta("Meeting 2026-08-27_15-02-24_2026-08-27_13-02", 64, 1, []),
    trascritta("Meeting 2026-08-26_10-03-33_2026-08-26_08-03", 37, 4, ["Marco"]),
    trascritta("Meeting 2026-08-25_15-37-27_2026-08-25_13-37", 34, 3, ["Greg"]),
    trascritta("Meeting 2026-08-14_15-12-20_2026-08-14_13-12", 45, 3, ["Greg"]),
    trascritta("Meeting 2026-07-30_12-16-02_2026-07-30_10-16", 26, 2, ["Marco"]),
    trascritta("Meeting 2026-07-30_10-06-15_2026-07-30_08-06", 105, 4, ["Marco"]),
    trascritta("Meeting 2026-07-28_17-24-48_2026-07-28_15-24", 1, 2, []),
    trascritta("Meeting 2026-07-28_17-02-58_2026-07-28_15-02", 2, 1, []),
    trascritta("Meeting 2026-07-28_16-29-10_2026-07-28_14-29", 3, 5, []),
    trascritta("Meeting 2026-07-14_14-39-40_2026-07-14_12-39", 88, 4, ["Marco"]),
    trascritta("Meeting 2026-07-13_10-25-22_2026-07-13_08-25", 11, 5, ["Marco"]),
    trascritta("Meeting 2026-07-13_10-16-15_2026-07-13_08-16", 8, 4, []),
    trascritta("Meeting 2026-07-13_10-12-15_2026-07-13_08-12", 4, 3, []),
    trascritta("Meeting 2026-07-13_10-05-53_2026-07-13_08-05", 3, 3, []),
    trascritta("audio_2026-07-30_12-18", 26, 2, ["Marco"]),
    trascritta("audio_2026-07-30_07-02", 1, 2, []),
    trascritta("audio_2026-07-29_16-47", 1, 2, []),
    trascritta("audio_2026-07-29_16-09", 1, 2, []),
    trascritta("audio_2026-07-29_15-52", 1, 2, []),
    trascritta("audio_2026-07-29_11-53", 1, 2, []),
    trascritta("audio_2026-07-29_11-49", 1, 2, []),
    trascritta("audio_2026-07-29_09-35", 1, 2, []),
    trascritta("audio_2026-07-14_14-16", 88, 5, ["Marco"]),
];

// due riunioni finte, coi nomi di fantasia gia' in uso nel progetto
const risposteFinte: Record<string, unknown> = {
  api_get_meetings: [
    { id: "finta-1", title: "Riunione CLEANER", updated_at: quandoFinto(0),
      created_at: quandoFinto(0) },
    { id: "finta-2", title: "Box termiche - ESATAN", updated_at: quandoFinto(3),
      created_at: quandoFinto(3) },
  ],
  // Il campo si chiama `device_type` con l'iniziale maiuscola: e' quello che
  // legge `usePermissionCheck`. Con `kind: "input"` l'app diceva «Nessun
  // microfono» e teneva spento il pulsante per registrare.
  get_audio_devices: [
    { name: "Microphone Array (Intel Smart Sound)", device_type: "Input", is_default: true },
    { name: "Headphones (Bose QC)", device_type: "Output", is_default: true },
  ],
  // i predefiniti di Windows, quelli che la registrazione usa davvero
  get_default_audio_devices: ["Microphone Array (Intel Smart Sound)", "Headphones (Bose QC)"],
  get_recording_preferences: {
    save_folder: "C:\\Users\\gcasagrande\\Music\\meetily-recordings",
    auto_save: true, file_format: "mp4", preferred_mic_device: null, preferred_system_device: null,
  },
  set_recording_preferences: null,
  get_transcriber_folder: "C:\\Users\\gcasagrande\\.claude\\hub\\meeting-notes\\trascrivi",
  set_transcriber_folder: null,
  // le persone che gli script conoscono (memoria/voci-note.json, contate il
  // 15-09): i nomi di fantasia gia' in uso nel progetto
  list_known_voices: [
    { nome: "Greg", riunioni: 3 }, { nome: "Marco", riunioni: 3 }, { nome: "Dario", riunioni: 1 },
    { nome: "Elena", riunioni: 1 }, { nome: "Fabio", riunioni: 1 }, { nome: "Paolo", riunioni: 1 },
    { nome: "Stefano", riunioni: 1 },
  ],
  // Servono scritti qui: la risposta di ripiego e' la lista vuota, e in
  // JavaScript `[]` vale VERO. Senza, l'app credeva di stare registrando e la
  // schermata ferma non si vedeva mai.
  is_recording: () => registrazioneFinta !== null,
  is_recording_paused: false,
  get_recording_state: () => statoRegistrazioneFinta(),
  // stessa trappola: `[]` vale vero, e l'app diceva «collegata a un evento
  // del calendario» che non esiste
  calendar_find_event_for_now: null,
  start_recording: avviaRegistrazioneFinta,
  start_recording_with_meeting_name: avviaRegistrazioneFinta,
  start_recording_with_devices: avviaRegistrazioneFinta,
  start_recording_with_devices_and_meeting: avviaRegistrazioneFinta,
  stop_recording: fermaRegistrazioneFinta,
  // il monitor dei livelli audio: nel finto non manda eventi, e le barrette
  // restano ferme. Basta che i comandi non esplodano.
  start_audio_level_monitoring: null,
  stop_audio_level_monitoring: null,
  whisper_has_available_models: true,
  // niente primo avvio e niente procedura guidata: si vede subito l'app vera,
  // che e' quella su cui dobbiamo lavorare
  check_first_launch: false,
  get_onboarding_status: {
    completed: true,
    currentStep: "done",
    parakeetDownloaded: true,
    summaryModelDownloaded: true,
  },
  is_onboarding_completed: true,
  api_get_api_key: null,
  // Le registrazioni che stanno sul disco senza `trascrizione.md`. Sono le TRE
  // vere, ricontate il 09-09 in Music/meetily-recordings: 28 cartelle con
  // audio, 25 con `trascrizione.md`. Sono tutte e tre del 23 luglio, tutte e
  // tre mute. Durate da `trascrivi/registrazioni.md`.
  //
  // La quarta muta (27 agosto) NON e' qui perche' un `trascrizione.md` ce
  // l'ha, anche se dentro sono parole inventate dal modello sul silenzio:
  // vedi la correzione del 09-09 in `hub/meeting-notes/DECISIONI.md`.
  list_pending_recordings: () =>
    [
      ...ARRETRATE_FINTE,
      ...TRASCRITTE_FINTE.filter((t) => testiButtati.has(t.folder)).map((t) => ({
        folder: t.folder, minutes: t.minutes, silent: false, percento_voce: 94,
      })),
    ]
      .filter((a) => trascrizioniFinte.get(a.folder)?.fase !== "fatto" && !cestinoFinto.has(a.folder))
      .map((a) => ({ ...a, esito: avanzamentoFinto({ folder: a.folder }) })),
  trash_recording: ({ folder }: { folder?: string }) => {
    if (!folder) throw new Error("trash_recording: manca `folder`");
    cestinoFinto.add(folder);
    return null;
  },
  start_transcription: avviaTrascrizioneFinta,
  transcription_progress: avanzamentoFinto,
  // Le 25 riunioni VERE con `trascrizione.md`, contate il 09-09. Durate da
  // `trascrivi/registrazioni.md`; voci e nomi riconosciuti da
  // `trascrivi/arretrate.md` (stato al 06-09). I nomi sono quelli di fantasia
  // gia' in uso nel progetto. L'ora viene dal nome della cartella.
  list_transcribed_recordings: () =>
    TRASCRITTE_FINTE.filter((t) => !cestinoFinto.has(t.folder) && !testiButtati.has(t.folder)),
  // Il testo VERO di una riunione, letto dal disco. Il browser non puo'
  // aprire un file, quindi lo chiede a un servetto che serve la cartella
  // delle registrazioni (vedi il MANUALE, «la faccia nel browser»):
  //
  //   npx serve "%USERPROFILE%\Music\meetily-recordings" -l tcp://127.0.0.1:3119 --cors
  //
  // `127.0.0.1` e' obbligatorio: la cartella ha dentro gli audio delle
  // riunioni, e senza il servetto li offrirebbe a tutta la rete aziendale.
  // Niente entra nel repo: il testo resta sul disco, il servetto e' solo per
  // guardare la schermata. Dentro Tauri lo stesso comando lo fa Rust.
  // i fogli scritti a mano (riassunto.md, note.md) nel finto vivono in
  // memoria: si scrivono, si rileggono, si buttano
  read_sheet: ({ folder, name }: { folder?: string; name?: string }) =>
    fogliFinti.get(`${folder}/${name}`) ?? null,
  write_sheet: ({ folder, name, text }: { folder?: string; name?: string; text?: string }) => {
    if (folder && name && text) fogliFinti.set(`${folder}/${name}`, text);
    return null;
  },
  trash_sheet: ({ folder, name }: { folder?: string; name?: string }) => {
    fogliFinti.delete(`${folder}/${name}`);
    return null;
  },
  // il testo nel Cestino: la riunione torna fra le arretrate (nel finto, in
  // fondo all'elenco, 64 minuti come le altre)
  trash_transcript: ({ folder }: { folder?: string }) => {
    if (!folder) throw new Error("trash_transcript: manca `folder`");
    testiButtati.add(folder);
    return null;
  },
  // l'audio da riascoltare: nel finto e' gia' un indirizzo (convertFileSrc
  // finto lascia tutto com'e'), nell'app vera e' un percorso sul disco
  recording_audio_path: ({ folder }: { folder?: string }) => {
    if (!folder) throw new Error("recording_audio_path: manca `folder`");
    return `http://127.0.0.1:3119/${encodeURIComponent(folder)}/audio.mp4`;
  },
  read_transcript: async ({ folder }: { folder?: string }) => {
    if (!folder) throw new Error("read_transcript: manca `folder`");
    const via = `http://localhost:3119/${encodeURIComponent(folder)}/trascrizione.md`;
    const risposta = await fetch(via);
    if (!risposta.ok) {
      throw new Error(
        `read_transcript: ${risposta.status} da ${via} — il servetto sulla 3119 e' acceso?`,
      );
    }
    return risposta.text();
  },
};

/**
 * Una riga di `list_transcribed_recordings`. L'ora la legge dal nome della
 * cartella: Meetily le chiama `Meeting AAAA-MM-GG_hh-mm-ss_...`, i nostri
 * script `audio_AAAA-MM-GG_hh-mm`.
 */
function trascritta(
  folder: string,
  minutes: number,
  voices: number,
  speakers: string[],
) {
  const m = folder.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})/);
  const recorded_at = m
    ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).toISOString()
    : "";
  return { folder, recorded_at, minutes, voices, speakers };
}

export function installaTauriFinto() {
  if (typeof window === "undefined") return;
  if ((window as any).__TAURI_INTERNALS__) return; // dentro Tauri: non si tocca niente

  const finestraFinta = {
    label: "main",
    isMaximized: async () => false,
    isMinimized: async () => false,
    isFullscreen: async () => false,
    minimize: async () => {},
    maximize: async () => {},
    unmaximize: async () => {},
    toggleMaximize: async () => {},
    close: async () => {},
    startDragging: async () => {},
    onResized: async () => () => {},
    onCloseRequested: async () => () => {},
    listen: async () => () => {},
    emit: async () => {},
  };

  // la bandierina che dice «qui gira il finto»: la legge `siamoNelFinto()`,
  // e serve per le comodita' che nell'app vera non devono esistere
  (window as any).__TAURI_FINTO__ = true;
  (window as any).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    plugins: {},
    // Le risposte finte. Servono a far VEDERE il disegno: un elenco vuoto dove
    // il codice si aspetta una lista, e due riunioni finte perche' una barra
    // laterale vuota non dice niente su come sara' davvero.
    invoke: async (comando: string, argomenti?: Record<string, unknown>) => {
      // Gli eventi. `listen` di Tauri chiama `plugin:event|listen` passando
      // il numero della callback (fatto da `transformCallback`); qui lo si
      // tiene da parte, e `emettiFinto` lo richiama quando serve.
      if (comando === "plugin:event|listen") {
        const { event, handler } = argomenti as { event: string; handler: number };
        const id = prossimoAscoltatore++;
        ascoltatoriFinti.set(id, { event, handler });
        return id;
      }
      if (comando === "plugin:event|unlisten") {
        ascoltatoriFinti.delete((argomenti as { eventId: number }).eventId);
        return null;
      }
      const risposta = risposteFinte[comando];
      // una risposta puo' essere una funzione degli argomenti: e' il caso dei
      // comandi che leggono un file dal disco
      if (typeof risposta === "function") return risposta(argomenti ?? {});
      if (risposta !== undefined) return risposta;
      // per tutto il resto: lista vuota. E' la forma che il codice si aspetta
      // piu' spesso, e non fa esplodere le `.map()`
      console.info(`[tauri finto] ${comando} -> []`);
      return [];
    },
    transformCallback: (callback?: (dati: unknown) => void) => {
      const id = Math.floor(Math.random() * 1e9);
      (window as any)[`_${id}`] = callback ?? (() => {});
      return id;
    },
    convertFileSrc: (percorso: string) => percorso,
    // gli ascoltatori di eventi: si registrano e si tolgono senza fare niente
    unregisterListener: async () => {},
    registerListener: async () => {},
  };

  // gli eventi di Tauri passano da un oggetto tutto loro
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: async () => {},
    registerListener: async () => {},
  };

  // il pezzo che dice su che sistema gira: senza, l'app si ferma su «platform»
  (window as any).__TAURI_OS_PLUGIN_INTERNALS__ = {
    os_type: "windows",
    platform: "windows",
    family: "windows",
    version: "11",
    arch: "x86_64",
    exe_extension: ".exe",

  };

  (window as any).__TAURI__ = { window: { getCurrentWindow: () => finestraFinta } };
  console.info("[tauri finto] installato: interfaccia visibile nel browser");
}

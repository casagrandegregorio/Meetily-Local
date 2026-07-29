import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Eye, EyeOff, Lock, Unlock } from "lucide-react";
import { ModelManager } from "./WhisperModelManager";
import { SettingsCard } from "@/app/settings/parts/SettingsCard";

export interface TranscriptModelProps {
  provider:
    | "localWhisper"
    | "deepgram"
    | "elevenLabs"
    | "groq"
    | "openai";
  model: string;
  apiKey?: string | null;
}

export interface TranscriptSettingsProps {
  transcriptModelConfig: TranscriptModelProps;
  setTranscriptModelConfig: (config: TranscriptModelProps) => void;
  onModelSelect?: () => void;
}

export function TranscriptSettings({
  transcriptModelConfig,
  setTranscriptModelConfig,
  onModelSelect,
}: TranscriptSettingsProps) {
  const [apiKey, setApiKey] = useState<string | null>(
    transcriptModelConfig.apiKey || null,
  );
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [isApiKeyLocked, setIsApiKeyLocked] = useState<boolean>(true);
  const [isLockButtonVibrating, setIsLockButtonVibrating] =
    useState<boolean>(false);
  const [uiProvider, setUiProvider] = useState<
    TranscriptModelProps["provider"]
  >(transcriptModelConfig.provider);

  // Sync uiProvider when backend config changes (e.g., after model selection or initial load).
  // uiProvider is mutable local state (changes when user picks a provider in the UI),
  // so it cannot be purely derived from the prop.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUiProvider(transcriptModelConfig.provider);
  }, [transcriptModelConfig.provider]);

  // Clear API key when switching to a provider that doesn't use one
  useEffect(() => {
    if (transcriptModelConfig.provider === "localWhisper") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setApiKey(null);
    }
  }, [transcriptModelConfig.provider]);

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const fetchApiKey = async (provider: string) => {
    try {
      const data = (await invoke("api_get_transcript_api_key", {
        provider,
      })) as string;

      setApiKey(data || "");
    } catch (err) {
      console.error("Error fetching API key:", err);
      setApiKey(null);
    }
  };

  /// Write the choice to the database.
  ///
  /// Until now the only caller of api_save_transcript_config in the whole app
  /// was WhisperModelManager, which hardcodes provider: "localWhisper". Picking
  /// a cloud provider here therefore updated React state and nothing else: the
  /// selection was gone on restart, and the API key field below had no save
  /// path at all, so a pasted key was silently discarded and recording quietly
  /// kept using local Whisper.
  const persistConfig = async (
    provider: TranscriptModelProps["provider"],
    model: string,
    key: string | null,
  ) => {
    setSaveState("saving");
    try {
      await invoke("api_save_transcript_config", {
        provider,
        model,
        apiKey: key && key.trim() !== "" ? key.trim() : null,
      });
      setTranscriptModelConfig({ ...transcriptModelConfig, provider, model });
      setSaveState("saved");
    } catch (err) {
      console.error("Failed to save transcription settings:", err);
      setSaveState("error");
    }
  };
  const modelOptions = {
    localWhisper: [], // Model selection handled by ModelManager component
    deepgram: ["nova-2-phonecall"],
    elevenLabs: ["eleven_multilingual_v2"],
    // Speech-to-text models, not chat models: these are the same Whisper
    // weights the local engine runs, hosted on Groq's accelerators.
    groq: ["whisper-large-v3-turbo", "whisper-large-v3"],
    openai: ["gpt-4o"],
  };
  // Keyed off the dropdown's current value, not the saved one: the key field
  // has to be reachable *before* anything is saved, otherwise there is no way
  // to enter the key that saving requires.
  const requiresApiKey = uiProvider !== "localWhisper";

  const handleInputClick = () => {
    if (isApiKeyLocked) {
      setIsLockButtonVibrating(true);
      setTimeout(() => setIsLockButtonVibrating(false), 500);
    }
  };

  // Stable refs so the memoized callback below doesn't capture changing
  // values. This is the difference between "re-creates on every render"
  // (which propagates to WhisperModelManager and re-fires its effects)
  // and "stable for the component's lifetime".
  const configRef = useRef(transcriptModelConfig);
  const setConfigRef = useRef(setTranscriptModelConfig);
  const onModelSelectRef = useRef(onModelSelect);
  useEffect(() => {
    configRef.current = transcriptModelConfig;
    setConfigRef.current = setTranscriptModelConfig;
    onModelSelectRef.current = onModelSelect;
  }, [transcriptModelConfig, setTranscriptModelConfig, onModelSelect]);

  // Stable for the component's lifetime — WhisperModelManager's effects
  // can include this in deps without re-firing on every parent render.
  const handleWhisperModelSelect = useCallback((modelName: string) => {
    setConfigRef.current({
      ...configRef.current,
      provider: "localWhisper",
      model: modelName,
    });
    onModelSelectRef.current?.();
  }, []);

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Transcription provider"
        description="Local Whisper runs on your machine; cloud providers send audio to a third-party API."
      >
        <div className="flex flex-wrap gap-2">
          <Select
            value={uiProvider}
            onValueChange={(value) => {
              const provider = value as TranscriptModelProps["provider"];
              setUiProvider(provider);
              setSaveState("idle");
              if (provider !== "localWhisper") {
                fetchApiKey(provider);
                // Persist the choice straight away, with this provider's first
                // model, so picking a provider and stopping there still leaves
                // the app in the state the user believes it is in.
                void persistConfig(provider, modelOptions[provider][0], apiKey);
              }
            }}
          >
            <SelectTrigger className="
              w-full max-w-xs
              focus:border-info focus:ring-1 focus:ring-info
            ">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="localWhisper">
                🏠 Local Whisper (High Accuracy)
              </SelectItem>
              <SelectItem value="groq">
                ☁️ Groq (Fast — audio leaves this computer)
              </SelectItem>
              {/* The remaining cloud providers stay disabled until their flows
                  are wired end to end:
                  <SelectItem value="deepgram">☁️ Deepgram</SelectItem>
                  <SelectItem value="elevenLabs">☁️ ElevenLabs</SelectItem>
                  <SelectItem value="openai">☁️ OpenAI</SelectItem> */}
            </SelectContent>
          </Select>

          {uiProvider !== "localWhisper" && (
            <Select
              value={transcriptModelConfig.model}
              onValueChange={(value) => {
                const model = value as TranscriptModelProps["model"];
                void persistConfig(uiProvider, model, apiKey);
              }}
            >
              <SelectTrigger className="
                w-full max-w-xs
                focus:border-info focus:ring-1 focus:ring-info
              ">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {modelOptions[uiProvider].map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </SettingsCard>

      {uiProvider === "localWhisper" && (
        <SettingsCard
          title="Whisper model"
          description="Larger models are slower but more accurate. Pick one that fits your hardware."
        >
          <ModelManager
            selectedModel={
              transcriptModelConfig.provider === "localWhisper"
                ? transcriptModelConfig.model
                : undefined
            }
            onModelSelect={handleWhisperModelSelect}
            autoSave={true}
          />
        </SettingsCard>
      )}

      {requiresApiKey && (
        <SettingsCard
          title="API key"
          description="Required for the selected cloud provider. The key is stored locally."
        >
          <div className="relative">
            <Input
              type={showApiKey ? "text" : "password"}
              className={`
                pr-24
                focus:border-info focus:ring-1 focus:ring-info
                ${isApiKeyLocked ? "cursor-not-allowed bg-muted" : ""}
              `}
              value={apiKey || ""}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={isApiKeyLocked}
              onClick={handleInputClick}
              placeholder="Enter your API key"
            />
            {isApiKeyLocked && (
              <div
                onClick={handleInputClick}
                className="
                  absolute inset-0 flex cursor-not-allowed items-center
                  justify-center rounded-md bg-muted/50
                "
              />
            )}
            <div className="absolute inset-y-0 right-0 flex items-center pr-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setIsApiKeyLocked(!isApiKeyLocked)}
                className={`
                  transition-colors duration-200
                  ${isLockButtonVibrating
                    ? "animate-vibrate text-destructive"
                    : ""}
                `}
                title={
                  isApiKeyLocked ? "Unlock to edit" : "Lock to prevent editing"
                }
              >
                {isApiKeyLocked ? (
                  <Lock className="size-4" />
                ) : (
                  <Unlock className="size-4" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Without this the key went nowhere: the field wrote to React state
              and no code path ever sent it to the backend. Confirmation is part
              of the fix, not decoration — a key that silently fails to save
              looks identical to one that saved, and the only symptom is that
              transcription quietly keeps running on the local engine. */}
          <div className="mt-3 flex items-center gap-3">
            <Button
              size="sm"
              disabled={
                isApiKeyLocked ||
                saveState === "saving" ||
                !apiKey ||
                apiKey.trim() === ""
              }
              onClick={() => {
                void persistConfig(
                  uiProvider,
                  transcriptModelConfig.model || modelOptions[uiProvider][0],
                  apiKey,
                ).then(() => setIsApiKeyLocked(true));
              }}
            >
              {saveState === "saving" ? "Saving…" : "Save key"}
            </Button>
            {saveState === "saved" && (
              <span className="text-sm text-success">
                Saved. Transcription will use {uiProvider}.
              </span>
            )}
            {saveState === "error" && (
              <span className="text-sm text-destructive">
                Could not save — the key was not stored.
              </span>
            )}
            {isApiKeyLocked && saveState === "idle" && (
              <span className="text-sm text-muted-foreground">
                Click the padlock to edit, then save.
              </span>
            )}
          </div>
        </SettingsCard>
      )}
    </div>
  );
}

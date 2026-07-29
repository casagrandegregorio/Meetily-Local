// audio/transcription/batch.rs
//
// Engine selection for the *batch* transcription paths — importing an audio
// file and re-transcribing an existing recording.
//
// The live worker pool picks its engine in engine.rs. These two paths used to
// be hardwired to local Whisper, which meant the transcript that actually
// matters (the one produced from the whole saved recording, rather than the
// live draft) was also the slowest one to produce. This lets them follow the
// same provider setting as live recording.

use super::provider::{TranscriptionError, TranscriptionProvider};
use anyhow::{anyhow, Result};
use log::info;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};

/// Whichever engine a batch job should feed its audio segments to.
pub enum BatchTranscriber {
    Whisper(Arc<crate::whisper_engine::WhisperEngine>),
    Remote(Arc<dyn TranscriptionProvider>),
}

impl BatchTranscriber {
    /// Transcribe one segment. Returns the text only — batch callers keep their
    /// own timing and speaker data and have no use for a confidence score.
    pub async fn transcribe(
        &self,
        samples: Vec<f32>,
        language: Option<String>,
    ) -> Result<String> {
        match self {
            Self::Whisper(engine) => {
                let (text, _confidence, _partial) = engine
                    .transcribe_audio_with_confidence(samples, language)
                    .await?;
                Ok(text)
            }
            Self::Remote(provider) => match provider.transcribe(samples, language).await {
                Ok(result) => Ok(result.text),
                // A segment below the provider's floor is not a failure of the
                // job: skip it the same way an empty transcription is skipped,
                // instead of aborting an hour-long import over one short blip.
                Err(TranscriptionError::AudioTooShort { .. }) => Ok(String::new()),
                Err(e) => Err(anyhow!("{}", e)),
            },
        }
    }

    pub fn engine_name(&self) -> &'static str {
        match self {
            Self::Whisper(_) => "local Whisper",
            Self::Remote(provider) => provider.provider_name(),
        }
    }
}

/// Build a remote transcriber from the saved settings, or `None` when the
/// configured provider is local Whisper (or a remote one without a key, which
/// callers must treat as "use local" rather than as an error — a batch job can
/// always fall back, unlike a live recording where the fallback would silently
/// run an entire meeting at a tenth of real time).
pub async fn remote_from_settings<R: Runtime>(
    app: &AppHandle<R>,
) -> Option<Arc<dyn TranscriptionProvider>> {
    let state = app.try_state::<crate::state::AppState>()?;

    let row: Option<(String, String)> =
        sqlx::query_as("SELECT provider, model FROM transcript_settings WHERE id = '1'")
            .fetch_optional(state.db_manager.pool())
            .await
            .ok()?;

    let (provider, model) = row?;
    if provider != "groq" {
        return None;
    }

    let key = crate::database::repositories::setting::SettingsRepository::get_transcript_api_key(
        state.db_manager.pool(),
        "groq",
    )
    .await
    .ok()
    .flatten();

    let model = if model.trim().is_empty() {
        None
    } else {
        Some(model)
    };

    let groq = super::groq_provider::from_settings(key, model)?;
    info!("☁️ Batch transcription will run on Groq");
    Some(Arc::new(groq))
}

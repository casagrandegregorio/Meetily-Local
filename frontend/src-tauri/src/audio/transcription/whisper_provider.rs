// audio/transcription/whisper_provider.rs
//
// Whisper transcription provider implementation.

use super::provider::{TranscriptResult, TranscriptionError, TranscriptionProvider};
use async_trait::async_trait;
use std::sync::Arc;

/// Whisper transcription provider (wraps WhisperEngine)
pub struct WhisperProvider {
    engine: Arc<crate::whisper_engine::WhisperEngine>,
}

impl WhisperProvider {
    pub fn new(engine: Arc<crate::whisper_engine::WhisperEngine>) -> Self {
        Self { engine }
    }
}

#[async_trait]
impl TranscriptionProvider for WhisperProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
        preceding_text: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError> {
        // The local engine accepts no prompt through this binding, so the
        // history is dropped here rather than used. Stated plainly instead of
        // being quietly ignored: local Whisper produces slightly worse joins
        // between consecutive chunks than Groq does, and this is why. Wiring it
        // means exposing whisper.cpp's `initial_prompt` through
        // `transcribe_audio_with_confidence`.
        let _ = preceding_text;

        match self
            .engine
            .transcribe_audio_with_confidence(audio, language)
            .await
        {
            Ok((text, confidence, is_partial)) => Ok(TranscriptResult {
                text: text.trim().to_string(),
                // The local engine's per-segment timings are not surfaced
                // through this binding, so it reports no breakdown and callers
                // fall back to one span for the whole input.
                spans: Vec::new(),
                confidence,
                is_partial,
            }),
            Err(e) => Err(TranscriptionError::EngineFailed(e.to_string())),
        }
    }

    async fn is_model_loaded(&self) -> bool {
        self.engine.is_model_loaded().await
    }

    async fn get_current_model(&self) -> Option<String> {
        self.engine.get_current_model().await
    }

    fn provider_name(&self) -> &'static str {
        "Whisper"
    }
}

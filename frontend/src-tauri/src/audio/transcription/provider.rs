// audio/transcription/provider.rs
//
// Defines the unified TranscriptionProvider trait and common types for all
// transcription engines (Whisper today; future remote providers plug in here).

use async_trait::async_trait;

// ============================================================================
// TRANSCRIPTION PROVIDER TRAIT & ERROR TYPES
// ============================================================================

/// Granular error types for transcription operations
#[derive(Debug, Clone)]
pub enum TranscriptionError {
    ModelNotLoaded,
    AudioTooShort { samples: usize, minimum: usize },
    EngineFailed(String),
    UnsupportedLanguage(String),
}

impl std::fmt::Display for TranscriptionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ModelNotLoaded => write!(f, "No transcription model is loaded"),
            Self::AudioTooShort { samples, minimum } => write!(
                f,
                "Audio too short: {} samples (minimum {})",
                samples, minimum
            ),
            Self::EngineFailed(msg) => write!(f, "Transcription engine failed: {}", msg),
            Self::UnsupportedLanguage(lang) => {
                write!(f, "Language '{}' is not supported by this provider", lang)
            }
        }
    }
}

impl std::error::Error for TranscriptionError {}

/// One sentence-sized piece of a transcription, timed relative to the start of
/// the audio that was submitted (not to the recording).
///
/// Exists because the alternative — cutting the audio finer before sending it —
/// makes transcription *worse*: the model guesses better with more context, and
/// a silence-threshold cut lands mid-thought. Letting the model return its own
/// sentence boundaries gives short, readable lines without shortening the audio
/// it reasons over.
#[derive(Debug, Clone)]
pub struct TranscriptSpan {
    pub text: String,
    pub start_s: f64,
    pub end_s: f64,
}

/// Unified transcription result across all providers
#[derive(Debug, Clone)]
pub struct TranscriptResult {
    pub text: String,
    /// Sentence-level breakdown, when the provider reports one. Empty otherwise
    /// — callers then treat `text` as a single span covering the whole input.
    pub spans: Vec<TranscriptSpan>,
    pub confidence: Option<f32>, // None if provider doesn't support confidence scores
    pub is_partial: bool,
}

/// Trait for transcription providers (Whisper today; future remote providers).
#[async_trait]
pub trait TranscriptionProvider: Send + Sync {
    /// Transcribe audio samples to text
    ///
    /// # Arguments
    /// * `audio` - Audio samples (16kHz mono, f32 format)
    /// * `language` - Optional language hint (e.g., "en", "es", "fr")
    ///
    /// # Returns
    /// * `TranscriptResult` with text, optional confidence, and partial flag
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError>;

    /// Check if a model is currently loaded
    async fn is_model_loaded(&self) -> bool;

    /// Get the name of the currently loaded model
    async fn get_current_model(&self) -> Option<String>;

    /// Get the provider name (for logging/debugging)
    fn provider_name(&self) -> &'static str;
}

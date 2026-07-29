// audio/transcription/mod.rs
//
// Transcription module: Provider abstraction, engine management, and worker pool.

pub mod batch;
pub mod engine;
pub mod groq_provider;
pub mod provider;
pub mod whisper_provider;
pub mod worker;

// Re-export commonly used types
pub use engine::{
    get_or_init_transcription_engine, get_or_init_whisper, validate_transcription_model_ready,
    TranscriptionEngine,
};
pub use batch::{remote_from_settings, BatchTranscriber};
pub use groq_provider::GroqProvider;
pub use provider::{TranscriptResult, TranscriptionError, TranscriptionProvider};
pub use whisper_provider::WhisperProvider;
pub use worker::{
    reset_speech_detected_flag, start_transcription_task, transcription_progress, TranscriptUpdate,
};

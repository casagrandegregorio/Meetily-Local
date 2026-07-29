// audio/transcription/groq_provider.rs
//
// Groq transcription provider: sends each audio chunk to Groq's hosted Whisper
// endpoint instead of running the model on the local CPU.
//
// Why this exists: whisper.cpp on this class of hardware runs many times slower
// than real time (measured: ~350s of compute per 30s window with
// large-v3-turbo-q5_0), which makes live meeting transcription unusable. Groq
// runs the *same* Whisper weights on its own accelerators at roughly 200x real
// time, so the model quality is unchanged — only where it executes moves.
//
// The trade-off is not money (the free tier covers meeting-scale use) but
// privacy: meeting audio, including other participants' voices, leaves the
// machine. That is a deliberate, user-made choice, surfaced by picking this
// provider in settings.

use super::provider::{TranscriptResult, TranscriptionError, TranscriptionProvider};
use async_trait::async_trait;
use log::{info, warn};

const GROQ_TRANSCRIPTION_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";

/// Sample rate the worker pool resamples every chunk to before transcription.
const TARGET_SAMPLE_RATE: u32 = 16_000;

/// Groq rejects anything under 0.01s. We use a slightly higher floor so the
/// request is worth making at all.
const MIN_SAMPLES: usize = TARGET_SAMPLE_RATE as usize / 10; // 100ms

pub struct GroqProvider {
    api_key: String,
    model: String,
    client: reqwest::Client,
}

impl GroqProvider {
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            api_key,
            model,
            client: reqwest::Client::new(),
        }
    }
}

/// Encode 32-bit float mono samples as a 16-bit PCM WAV file in memory.
///
/// Written by hand rather than pulled from a crate: the format is 44 bytes of
/// header plus the samples, and the repo already dropped its WAV dependency for
/// the same reason.
fn wav_from_f32_mono(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let bits_per_sample: u16 = 16;
    let channels: u16 = 1;
    let byte_rate = sample_rate * channels as u32 * (bits_per_sample / 8) as u32;
    let block_align = channels * (bits_per_sample / 8);
    let data_len = (samples.len() * 2) as u32;

    let mut out = Vec::with_capacity(44 + data_len as usize);

    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVE");

    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // PCM chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // format = PCM
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits_per_sample.to_le_bytes());

    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for &sample in samples {
        // Clamp before scaling: values outside [-1, 1] would wrap round to the
        // opposite sign and turn a loud passage into noise.
        let clamped = sample.clamp(-1.0, 1.0);
        out.extend_from_slice(&((clamped * i16::MAX as f32) as i16).to_le_bytes());
    }

    out
}

#[async_trait]
impl TranscriptionProvider for GroqProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError> {
        if audio.len() < MIN_SAMPLES {
            return Err(TranscriptionError::AudioTooShort {
                samples: audio.len(),
                minimum: MIN_SAMPLES,
            });
        }

        let wav = wav_from_f32_mono(&audio, TARGET_SAMPLE_RATE);

        let file_part = reqwest::multipart::Part::bytes(wav)
            .file_name("chunk.wav")
            .mime_str("audio/wav")
            .map_err(|e| TranscriptionError::EngineFailed(format!("Invalid mime type: {}", e)))?;

        let mut form = reqwest::multipart::Form::new()
            .part("file", file_part)
            .text("model", self.model.clone())
            .text("response_format", "json")
            // Deterministic decoding: the same audio should not transcribe
            // differently between runs.
            .text("temperature", "0");

        // "auto" means let Whisper detect the language, which is what omitting
        // the field does. "auto-translate" would need Groq's separate
        // translations endpoint; until that is wired, treat it as auto and
        // transcribe in the spoken language rather than silently doing nothing.
        match language.as_deref() {
            Some("auto") | Some("auto-translate") | None => {}
            Some(code) => form = form.text("language", code.to_string()),
        }

        let response = self
            .client
            .post(GROQ_TRANSCRIPTION_URL)
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| TranscriptionError::EngineFailed(format!("Request to Groq failed: {}", e)))?;

        let status = response.status();
        if !status.is_success() {
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "<no response body>".to_string());
            warn!("Groq transcription rejected the chunk: {} {}", status, body);
            return Err(TranscriptionError::EngineFailed(format!(
                "Groq returned {}: {}",
                status, body
            )));
        }

        let payload: serde_json::Value = response.json().await.map_err(|e| {
            TranscriptionError::EngineFailed(format!("Could not read Groq response: {}", e))
        })?;

        let text = payload
            .get("text")
            .and_then(|t| t.as_str())
            .unwrap_or_default()
            .trim()
            .to_string();

        Ok(TranscriptResult {
            text,
            // Groq's verbose response carries avg_logprob and no_speech_prob,
            // neither of which is a transcription confidence on a 0..1 scale.
            // Report nothing rather than manufacture a number — the same
            // mistake the local engine used to make.
            confidence: None,
            is_partial: false,
        })
    }

    async fn is_model_loaded(&self) -> bool {
        // Nothing to load: the model lives on Groq's side. Having a key is the
        // whole readiness condition.
        !self.api_key.is_empty()
    }

    async fn get_current_model(&self) -> Option<String> {
        Some(self.model.clone())
    }

    fn provider_name(&self) -> &'static str {
        "Groq"
    }
}

/// Default Groq model. Same Whisper weights as the local large model, so the
/// output quality matches what the CPU build produced — only much faster.
pub const DEFAULT_GROQ_MODEL: &str = "whisper-large-v3-turbo";

/// Build a provider from the saved settings, if Groq is configured with a key.
pub fn from_settings(api_key: Option<String>, model: Option<String>) -> Option<GroqProvider> {
    let key = api_key?;
    if key.trim().is_empty() {
        return None;
    }
    let model = match model {
        Some(m) if !m.trim().is_empty() => m,
        _ => DEFAULT_GROQ_MODEL.to_string(),
    };
    info!("☁️ Groq transcription configured with model '{}'", model);
    Some(GroqProvider::new(key, model))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_header_describes_the_payload() {
        let samples = vec![0.0f32; 1600];
        let wav = wav_from_f32_mono(&samples, 16_000);

        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        // 44-byte header + two bytes per sample
        assert_eq!(wav.len(), 44 + 1600 * 2);
        // data chunk length field
        assert_eq!(
            u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]),
            3200
        );
    }

    #[test]
    fn samples_beyond_full_scale_clamp_instead_of_wrapping() {
        let wav = wav_from_f32_mono(&[2.0, -2.0], 16_000);
        let first = i16::from_le_bytes([wav[44], wav[45]]);
        let second = i16::from_le_bytes([wav[46], wav[47]]);

        assert!(first > 32_000, "positive overload must stay positive");
        assert!(second < -32_000, "negative overload must stay negative");
    }

    #[test]
    fn a_blank_key_yields_no_provider() {
        assert!(from_settings(None, None).is_none());
        assert!(from_settings(Some("   ".to_string()), None).is_none());
        assert!(from_settings(Some("gsk_test".to_string()), None).is_some());
    }
}

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

use super::provider::{
    TranscriptResult, TranscriptSpan, TranscriptionError, TranscriptionProvider,
};
use async_trait::async_trait;
use log::{info, warn};

const GROQ_TRANSCRIPTION_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";

/// Sample rate the worker pool resamples every chunk to before transcription.
const TARGET_SAMPLE_RATE: u32 = 16_000;

/// Groq rejects anything under 0.01s. We use a slightly higher floor so the
/// request is worth making at all.
const MIN_SAMPLES: usize = TARGET_SAMPLE_RATE as usize / 10; // 100ms

/// Longest we wait for one segment to come back.
///
/// `reqwest` has no default timeout, and there is exactly one transcription
/// worker, so a connection that hangs rather than fails blocks *every*
/// remaining chunk for as long as the socket stays open. During a live
/// recording that shows up as a transcript that simply stops; at shutdown the
/// stall watchdog eventually gives up, but only after 20 minutes of an
/// apparently frozen app.
///
/// The work itself is fast — Groq runs Whisper at roughly 200x real time, so
/// even a 25-second segment (the largest the batch paths emit) is sub-second of
/// compute plus about 800 kB of upload. Two minutes is far beyond any healthy
/// request and still well inside the watchdog's window, so a wedged connection
/// surfaces as an error we can report instead of a freeze.
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// Separate, much tighter budget for establishing the connection: a reachable
/// Groq answers in well under a second, and failing fast here is what lets a
/// dropped network surface immediately rather than at the full request budget.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// How many times one segment is attempted before the job gives up.
///
/// Four attempts with the linear backoff below spans roughly a minute, which
/// covers a per-minute rate-limit window — the failure this exists for.
const MAX_ATTEMPTS: u32 = 4;

/// Base wait between attempts, multiplied by the attempt number. Used only when
/// the server does not send a `Retry-After` header of its own.
const BASE_RETRY_DELAY: std::time::Duration = std::time::Duration::from_secs(5);

/// Ceiling on any single wait, including a server-supplied `Retry-After`. Keeps
/// one unlucky segment from parking a live recording's only worker for minutes.
const MAX_RETRY_DELAY: std::time::Duration = std::time::Duration::from_secs(30);

pub struct GroqProvider {
    api_key: String,
    model: String,
    client: reqwest::Client,
}

impl GroqProvider {
    pub fn new(api_key: String, model: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .unwrap_or_else(|e| {
                // Only fails if the TLS backend won't initialise. An untimed
                // client still transcribes; say so rather than killing
                // recording over it.
                warn!(
                    "Could not build a timed HTTP client ({}); falling back to an untimed one",
                    e
                );
                reqwest::Client::new()
            });

        Self {
            api_key,
            model,
            client,
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

        // Retry on the failures that are known to pass. Rebuilding a one-hour
        // meeting is ~150 sequential requests, which on the free tier will meet
        // the per-minute cap; without this, one 429 two thirds of the way in
        // aborts the whole job — after the old transcript has already been
        // deleted. Transport errors and 5xx get the same treatment for the same
        // reason. A 4xx that is not 429 (bad key, bad model, audio rejected)
        // will never pass, so it fails immediately.
        let mut attempt = 0u32;
        let payload: serde_json::Value = loop {
            attempt += 1;

            // The form owns the file bytes and is consumed by send(), so it has
            // to be rebuilt per attempt.
            let file_part = reqwest::multipart::Part::bytes(wav.clone())
                .file_name("chunk.wav")
                .mime_str("audio/wav")
                .map_err(|e| {
                    TranscriptionError::EngineFailed(format!("Invalid mime type: {}", e))
                })?;

            let mut form = reqwest::multipart::Form::new()
                .part("file", file_part)
                .text("model", self.model.clone())
                // verbose_json rather than json: it carries the model's own
                // sentence boundaries and their times. Without them one request
                // collapses into one line of transcript however long the audio
                // was — a ten-second block of speech shown as a single
                // unreadable paragraph.
                .text("response_format", "verbose_json")
                .text("timestamp_granularities[]", "segment")
                // Deterministic decoding: the same audio should not transcribe
                // differently between runs.
                .text("temperature", "0");

            // "auto" means let Whisper detect the language, which is what
            // omitting the field does. "auto-translate" would need Groq's
            // separate translations endpoint; until that is wired, treat it as
            // auto and transcribe in the spoken language rather than silently
            // doing nothing.
            match language.as_deref() {
                Some("auto") | Some("auto-translate") | None => {}
                Some(code) => form = form.text("language", code.to_string()),
            }

            let attempt_result = self
                .client
                .post(GROQ_TRANSCRIPTION_URL)
                .bearer_auth(&self.api_key)
                .multipart(form)
                .send()
                .await;

            let retry_after = match attempt_result {
                Err(e) => {
                    if e.is_timeout() || e.is_connect() || e.is_request() {
                        Some((BASE_RETRY_DELAY * attempt, format!("{}", e)))
                    } else {
                        return Err(TranscriptionError::EngineFailed(format!(
                            "Request to Groq failed: {}",
                            e
                        )));
                    }
                }
                Ok(response) => {
                    let status = response.status();
                    if status.is_success() {
                        break response.json().await.map_err(|e| {
                            TranscriptionError::EngineFailed(format!(
                                "Could not read Groq response: {}",
                                e
                            ))
                        })?;
                    }

                    // Groq states how long to wait; honour it when present,
                    // since guessing shorter just burns another request.
                    let server_delay = response
                        .headers()
                        .get(reqwest::header::RETRY_AFTER)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.parse::<u64>().ok())
                        .map(std::time::Duration::from_secs);

                    let body = response
                        .text()
                        .await
                        .unwrap_or_else(|_| "<no response body>".to_string());

                    if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
                        Some((
                            server_delay.unwrap_or(BASE_RETRY_DELAY * attempt),
                            format!("{} {}", status, body),
                        ))
                    } else {
                        warn!("Groq rejected the chunk: {} {}", status, body);
                        return Err(TranscriptionError::EngineFailed(format!(
                            "Groq returned {}: {}",
                            status, body
                        )));
                    }
                }
            };

            let (delay, reason) = retry_after.expect("non-retryable paths return above");
            if attempt >= MAX_ATTEMPTS {
                return Err(TranscriptionError::EngineFailed(format!(
                    "Groq still failing after {} attempts: {}",
                    MAX_ATTEMPTS, reason
                )));
            }

            let delay = delay.min(MAX_RETRY_DELAY);
            warn!(
                "Groq attempt {}/{} failed ({}); retrying in {:?}",
                attempt, MAX_ATTEMPTS, reason, delay
            );
            tokio::time::sleep(delay).await;
        };

        let text = payload
            .get("text")
            .and_then(|t| t.as_str())
            .unwrap_or_default()
            .trim()
            .to_string();

        // Empty-text spans are dropped: Whisper emits them for music stings and
        // pure silence, and they would otherwise become blank transcript lines.
        let spans: Vec<TranscriptSpan> = payload
            .get("segments")
            .and_then(|s| s.as_array())
            .map(|segments| {
                segments
                    .iter()
                    .filter_map(|s| {
                        let text = s.get("text")?.as_str()?.trim().to_string();
                        if text.is_empty() {
                            return None;
                        }
                        Some(TranscriptSpan {
                            text,
                            start_s: s.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0),
                            end_s: s.get("end").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(TranscriptResult {
            text,
            spans,
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

    /// A hung request must fail inside the shutdown watchdog's patience, not
    /// outlast it. The watchdog (`recording_commands.rs`, `STALL_LIMIT`) gives
    /// the queue 20 minutes without a completed chunk before declaring the
    /// engine wedged; if a single request could run longer than that, a stuck
    /// socket would be reported to the user as a wedged engine and the whole
    /// remaining queue discarded, rather than as one failed segment.
    #[test]
    fn a_request_cannot_outlast_the_shutdown_stall_watchdog() {
        const STALL_LIMIT: std::time::Duration = std::time::Duration::from_secs(1200);
        assert!(
            REQUEST_TIMEOUT < STALL_LIMIT,
            "request timeout {:?} must stay under the {:?} stall limit",
            REQUEST_TIMEOUT,
            STALL_LIMIT
        );
        assert!(CONNECT_TIMEOUT < REQUEST_TIMEOUT);
    }

    /// ...but it must also be generous enough for the largest segment the batch
    /// paths actually produce, or healthy work gets cut off. Import and
    /// retranscription split anything longer than 25 s, which is ~800 kB of
    /// 16-bit mono WAV.
    #[test]
    fn the_timeout_leaves_room_for_the_largest_segment_we_send() {
        let largest_segment_samples = 25 * TARGET_SAMPLE_RATE as usize;
        let upload_bytes = wav_from_f32_mono(&vec![0.0; largest_segment_samples], TARGET_SAMPLE_RATE).len();

        assert!(
            upload_bytes < 1_000_000,
            "largest upload is {} bytes; the timeout was sized for well under 1 MB",
            upload_bytes
        );
        assert!(
            REQUEST_TIMEOUT >= std::time::Duration::from_secs(60),
            "too tight for a slow network carrying {} bytes",
            upload_bytes
        );
    }

    #[test]
    fn a_blank_key_yields_no_provider() {
        assert!(from_settings(None, None).is_none());
        assert!(from_settings(Some("   ".to_string()), None).is_none());
        assert!(from_settings(Some("gsk_test".to_string()), None).is_some());
    }
}

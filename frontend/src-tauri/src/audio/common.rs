use crate::api::TranscriptSegment;
use anyhow::Result;
use log::{debug, info};
use std::path::Path;
use uuid::Uuid;

/// Unload the Whisper model after a batch job (import or retranscription).
/// Skips unloading if a live recording is currently in progress, since recording
/// uses the same global engine instance.
pub(crate) async fn unload_engine_after_batch() {
    if crate::audio::recording_commands::is_recording().await {
        log::info!("Skipping model unload after batch: recording in progress");
        return;
    }

    use crate::whisper_engine::commands::WHISPER_ENGINE;
    let engine = {
        let guard = WHISPER_ENGINE.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_ref().cloned()
    };
    if let Some(e) = engine {
        e.unload_model().await;
    }
}

/// Which local Whisper model a batch job should load.
///
/// Called only once a batch job has already decided to run locally — either
/// because the saved provider *is* local Whisper, or because a remote provider
/// was configured without an API key and
/// [`remote_from_settings`](crate::audio::transcription::remote_from_settings)
/// declined to build one.
///
/// That second case is why this returns a model rather than a `Result`. A batch
/// job always has a working fallback: the audio is already on disk, so running
/// it locally costs time and nothing else. Refusing to transcribe at all
/// because settings happen to name a remote provider strands the user with a
/// recording they cannot get a transcript out of.
///
/// `saved` is the `(provider, model)` row from `transcript_settings`; the model
/// it carries belongs to whichever provider is named, so it is only usable when
/// that provider is a local Whisper one.
pub(crate) fn whisper_model_for_batch(
    requested: Option<&str>,
    saved: Option<(String, String)>,
) -> String {
    if let Some(model) = requested.map(str::trim).filter(|m| !m.is_empty()) {
        return model.to_string();
    }

    match saved {
        Some((provider, model))
            if (provider == "localWhisper" || provider == "whisper")
                && !model.trim().is_empty() =>
        {
            model
        }
        _ => crate::config::DEFAULT_WHISPER_MODEL.to_string(),
    }
}

/// One transcribed segment from a batch (import / retranscription) job.
/// `speaker`/`voice_profile_id` are populated when a [`Diarizer`] is
/// available for the batch; otherwise they're `None`.
///
/// [`Diarizer`]: crate::speaker_diarization::Diarizer
#[derive(Debug, Clone)]
pub(crate) struct BatchTranscript {
    pub text: String,
    pub start_ms: f64,
    pub end_ms: f64,
    pub speaker: Option<String>,
    pub voice_profile_id: Option<String>,
}

/// Create transcript segments from a batch transcription result.
pub(crate) fn create_transcript_segments(
    transcripts: &[BatchTranscript],
) -> Vec<TranscriptSegment> {
    transcripts
        .iter()
        .map(|t| {
            let start_seconds = t.start_ms / 1000.0;
            let end_seconds = t.end_ms / 1000.0;
            let duration = end_seconds - start_seconds;

            TranscriptSegment {
                id: format!("transcript-{}", Uuid::new_v4()),
                text: t.text.trim().to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
                audio_start_time: Some(start_seconds),
                audio_end_time: Some(end_seconds),
                duration: Some(duration),
                speaker: t.speaker.clone(),
                voice_profile_id: t.voice_profile_id.clone(),
            }
        })
        .collect()
}

/// Write transcripts.json to a meeting folder (atomic write with temp file)
pub(crate) fn write_transcripts_json(folder: &Path, segments: &[TranscriptSegment]) -> Result<()> {
    let transcript_path = folder.join("transcripts.json");
    let temp_path = folder.join(".transcripts.json.tmp");

    let json = serde_json::json!({
        "version": "1.0",
        "last_updated": chrono::Utc::now().to_rfc3339(),
        "total_segments": segments.len(),
        "segments": segments.iter().enumerate().map(|(i, s)| {
            serde_json::json!({
                "id": s.id,
                "text": s.text,
                "timestamp": s.timestamp,
                "audio_start_time": s.audio_start_time,
                "audio_end_time": s.audio_end_time,
                "duration": s.duration,
                "speaker": s.speaker,
                "voice_profile_id": s.voice_profile_id,
                "sequence_id": i
            })
        }).collect::<Vec<_>>()
    });

    let json_string = serde_json::to_string_pretty(&json)?;
    std::fs::write(&temp_path, &json_string)?;
    std::fs::rename(&temp_path, &transcript_path)?;

    info!(
        "Wrote transcripts.json with {} segments to {}",
        segments.len(),
        transcript_path.display()
    );
    Ok(())
}

/// Split a long speech segment at the lowest-energy (silence) point near the target size.
///
/// Scans for 100ms windows with minimal RMS energy within +/-3 seconds of each target
/// split point. If no clear silence is found, falls back to a 1-second overlap split
/// to avoid cutting words at boundaries.
pub(crate) fn split_segment_at_silence(
    segment: &crate::audio::vad::SpeechSegment,
    max_samples: usize,
) -> Vec<crate::audio::vad::SpeechSegment> {
    const SAMPLE_RATE: usize = 16000;
    // 100ms window for energy measurement (1600 samples at 16kHz)
    const ENERGY_WINDOW: usize = SAMPLE_RATE / 10;
    // Search +/-3 seconds around the target split point
    const SEARCH_RADIUS: usize = SAMPLE_RATE * 3;
    // RMS threshold below which we consider a window "silent"
    const SILENCE_RMS_THRESHOLD: f32 = 0.02;
    // Overlap to use when no silence boundary is found (1 second)
    const FALLBACK_OVERLAP: usize = SAMPLE_RATE;

    let total = segment.samples.len();
    if total <= max_samples {
        return vec![segment.clone()];
    }

    let ms_per_sample =
        (segment.end_timestamp_ms - segment.start_timestamp_ms) / segment.samples.len() as f64;
    let mut result = Vec::new();
    let mut pos = 0usize;

    while pos < total {
        let remaining = total - pos;
        if remaining <= max_samples {
            // Last chunk - take everything remaining
            let chunk_samples = segment.samples[pos..].to_vec();
            let chunk_start_ms = segment.start_timestamp_ms + (pos as f64 * ms_per_sample);
            let chunk_end_ms = segment.end_timestamp_ms;
            result.push(crate::audio::vad::SpeechSegment {
                samples: chunk_samples,
                start_timestamp_ms: chunk_start_ms,
                end_timestamp_ms: chunk_end_ms,
                confidence: segment.confidence,
                source: segment.source,
            });
            break;
        }

        // Target split point
        let target = pos + max_samples;

        // Search window: [target - SEARCH_RADIUS, target + SEARCH_RADIUS]
        let search_start = target.saturating_sub(SEARCH_RADIUS).max(pos + SAMPLE_RATE);
        let search_end = (target + SEARCH_RADIUS).min(total.saturating_sub(ENERGY_WINDOW));

        // Find the lowest-energy 100ms window in the search range
        let mut best_split = target.min(total); // fallback: exact target
        let mut best_rms = f32::MAX;

        if search_start + ENERGY_WINDOW <= search_end {
            let mut idx = search_start;
            while idx + ENERGY_WINDOW <= search_end {
                let window = &segment.samples[idx..idx + ENERGY_WINDOW];
                let rms = (window.iter().map(|s| s * s).sum::<f32>() / ENERGY_WINDOW as f32).sqrt();
                if rms < best_rms {
                    best_rms = rms;
                    best_split = idx + ENERGY_WINDOW / 2; // split at center of quiet window
                }
                // Step by 10ms (160 samples) for efficiency
                idx += SAMPLE_RATE / 100;
            }
        }

        let split_at = best_split;
        if best_rms <= SILENCE_RMS_THRESHOLD {
            debug!(
                "Splitting at silence boundary: sample {} (RMS={:.4})",
                split_at, best_rms
            );
        } else {
            debug!(
                "No silence found near target (best RMS={:.4}), splitting with overlap at sample {}",
                best_rms, split_at
            );
        }

        // Determine the actual end of this chunk (with overlap if no silence)
        let chunk_end = if best_rms > SILENCE_RMS_THRESHOLD {
            (split_at + FALLBACK_OVERLAP).min(total)
        } else {
            split_at
        };

        let chunk_samples = segment.samples[pos..chunk_end].to_vec();
        let chunk_start_ms = segment.start_timestamp_ms + (pos as f64 * ms_per_sample);
        let chunk_end_ms = segment.start_timestamp_ms + (chunk_end as f64 * ms_per_sample);

        result.push(crate::audio::vad::SpeechSegment {
            samples: chunk_samples,
            start_timestamp_ms: chunk_start_ms,
            end_timestamp_ms: chunk_end_ms,
            confidence: segment.confidence,
            source: segment.source,
        });

        // Advance position to where the current chunk actually ends
        // to avoid transcribing the overlap region twice
        pos = chunk_end;
    }

    result
}

#[cfg(test)]
mod batch_model_tests {
    use super::whisper_model_for_batch;
    use crate::config::DEFAULT_WHISPER_MODEL;

    fn saved(provider: &str, model: &str) -> Option<(String, String)> {
        Some((provider.to_string(), model.to_string()))
    }

    /// The defect this function was extracted to fix.
    ///
    /// Settings name Groq but no API key is saved, so the batch job fell back to
    /// running locally. Retranscription used to refuse outright here — it read
    /// the provider, saw "groq", and returned "Retranscription requires
    /// Whisper", aborting a job whose audio was sitting on disk ready to go.
    /// Import, on the same input, quietly used the default model. The two paths
    /// are meant to behave identically.
    #[test]
    fn a_remote_provider_falls_back_to_the_default_local_model() {
        assert_eq!(
            whisper_model_for_batch(None, saved("groq", "whisper-large-v3-turbo")),
            DEFAULT_WHISPER_MODEL
        );
    }

    /// The Groq row's model name belongs to Groq and means nothing to
    /// whisper.cpp — loading it would fail. It must not leak through.
    #[test]
    fn a_remote_providers_model_name_is_never_handed_to_whisper() {
        let chosen = whisper_model_for_batch(None, saved("groq", "whisper-large-v3-turbo"));
        assert_ne!(chosen, "whisper-large-v3-turbo");
    }

    #[test]
    fn a_local_whisper_setting_is_honoured() {
        assert_eq!(whisper_model_for_batch(None, saved("localWhisper", "small")), "small");
        assert_eq!(whisper_model_for_batch(None, saved("whisper", "medium")), "medium");
    }

    #[test]
    fn an_explicit_request_wins_over_the_saved_setting() {
        assert_eq!(
            whisper_model_for_batch(Some("tiny"), saved("localWhisper", "small")),
            "tiny"
        );
    }

    #[test]
    fn a_blank_request_is_ignored_rather_than_loaded() {
        assert_eq!(
            whisper_model_for_batch(Some("   "), saved("localWhisper", "small")),
            "small"
        );
    }

    #[test]
    fn unconfigured_settings_yield_the_default() {
        assert_eq!(whisper_model_for_batch(None, None), DEFAULT_WHISPER_MODEL);
        assert_eq!(
            whisper_model_for_batch(None, saved("localWhisper", "")),
            DEFAULT_WHISPER_MODEL
        );
    }
}

//! Voice activity detection — wraps sherpa-onnx's `VoiceActivityDetector`.
//!
//! Previously used `silero-rs` (which depends on the `ort` crate). That worked
//! fine in isolation, but having `ort` in the same binary as `sherpa-onnx-sys`
//! (used for speaker embedding) caused glibc `free(): invalid pointer` aborts
//! at sherpa-onnx's first model load on Linux/CUDA — two static onnxruntime
//! copies in one process don't coexist on every platform. Switching to
//! sherpa-onnx's bundled VAD eliminates the second runtime entirely.
//!
//! Behaviour we preserve:
//! - Same `SpeechSegment` shape (samples + start/end timestamps + source tag).
//! - Same `ContinuousVadProcessor` API (`new`, `new_with_source`, `process_audio`, `flush`).
//! - Same `extract_speech_16k`, `get_speech_chunks`, `get_speech_chunks_with_progress` helpers.
//! - 16 kHz mono input; resampling from any input rate happens here.
//!
//! What changed under the hood:
//! - The "redemption_time_ms" parameter now maps to sherpa's
//!   `min_silence_duration` (the trailing silence gap that terminates a
//!   speech segment). Same intent, slightly different name.
//! - Sherpa accepts arbitrary chunk sizes (no 30 ms windowing here);
//!   internal windowing is fixed at 512 samples per silero-vad's spec.

use anyhow::{anyhow, Result};
use log::{debug, info, warn};
use sherpa_onnx::{SileroVadModelConfig, VadModelConfig, VoiceActivityDetector};

use super::recording_state::DeviceType;

/// Represents a complete speech segment detected by VAD.
#[derive(Debug, Clone)]
pub struct SpeechSegment {
    pub samples: Vec<f32>,
    pub start_timestamp_ms: f64,
    pub end_timestamp_ms: f64,
    pub confidence: f32,
    /// Which audio stream this segment came from (Mic or System).
    /// Set by the VAD processor based on its construction-time source tag.
    pub source: DeviceType,
}

/// Streaming VAD processor that emits complete speech segments.
pub struct ContinuousVadProcessor {
    detector: VoiceActivityDetector,
    /// Sample rate of the *input* audio (we resample to 16 kHz before feeding sherpa).
    sample_rate: u32,
    /// Total 16 kHz samples consumed so far. Used to convert sherpa's
    /// segment-relative sample indices into absolute timestamps.
    processed_samples_16k: u64,
    /// Source tag stamped onto every emitted segment (Mic or System).
    source: DeviceType,
}

const VAD_SAMPLE_RATE: i32 = 16_000;

/// silero-vad's window: 512 samples (32 ms at 16 kHz). Sherpa slides the model
/// over the accepted audio in steps of exactly this size.
const VAD_WINDOW_SAMPLES: usize = 512;

/// Largest slice we hand to the detector in a single `accept_waveform` call.
///
/// This is a correctness constraint, not a tuning knob. Sherpa's
/// `VoiceActivityDetectorImpl::AcceptWaveform` (verified against sherpa-onnx
/// v1.13.0, `sherpa-onnx/csrc/voice-activity-detector.cc`) runs the model over
/// every window in the call but folds the per-window verdicts into a *single*
/// boolean:
///
/// ```text
/// for (int32_t i = 0; i < k; ++i, p += window_shift) {
///   buffer_.Push(p, window_shift);
///   is_speech = is_speech || model_->IsSpeech(p, window_size);
/// }
/// ```
///
/// The segment-boundary logic then runs **once per call**, not once per window.
/// So a call can only ever produce one speech/silence transition, and when it
/// opens a segment it anchors the start near the *end* of everything the call
/// pushed:
///
/// ```text
/// start_ = max(buffer_.Tail() - 2 * WindowSize() - MinSpeechDurationSamples(),
///              buffer_.Head());
/// ```
///
/// Hand it a whole 42-second file and `Tail()` is the end of the file, so the
/// only segment it can report is the last 2*512 + 4000 = 5024 samples — 314 ms
/// at the very tail — no matter how much speech the file contains. That is
/// exactly the failure this constant exists to prevent.
///
/// Feeding at most one window shift per call keeps `k` at one, so every call
/// yields one honest verdict and boundaries land within 32 ms of the truth.
/// This is also how sherpa's own offline examples drive the detector.
const VAD_FEED_SAMPLES: usize = VAD_WINDOW_SAMPLES;

/// The detector as the feeding loop sees it: something you push one window into
/// and pull finished segments out of.
///
/// Exists so the feeding policy — the thing that was wrong — can be exercised
/// without an ONNX runtime or a model file on disk. The production
/// implementation is [`ContinuousVadProcessor`]; the tests substitute a
/// transcription of sherpa's own C++ algorithm.
trait SegmentSink {
    /// Accept at most [`VAD_FEED_SAMPLES`] samples of 16 kHz mono audio and
    /// return any segments the detector finished as a result.
    fn accept_window(&mut self, window_16k: &[f32]) -> Result<Vec<SpeechSegment>>;

    /// Terminate the segment still in flight, if any.
    fn finish(&mut self) -> Result<Vec<SpeechSegment>>;
}

/// Push `samples_16k` through `sink` one detector window at a time.
///
/// The slicing is unconditional: there is no input size for which handing the
/// detector a bigger bite is safe (see [`VAD_FEED_SAMPLES`]).
fn feed_windows<S: SegmentSink>(sink: &mut S, samples_16k: &[f32]) -> Result<Vec<SpeechSegment>> {
    let mut out = Vec::new();
    for window in samples_16k.chunks(VAD_FEED_SAMPLES) {
        out.extend(sink.accept_window(window)?);
    }
    Ok(out)
}

impl ContinuousVadProcessor {
    /// Create a VAD processor with no specific source tag (defaults to Mic for
    /// backward compatibility with helpers that operate on a single mixed stream).
    pub fn new(input_sample_rate: u32, redemption_time_ms: u32) -> Result<Self> {
        Self::new_with_source(input_sample_rate, redemption_time_ms, DeviceType::Microphone)
    }

    /// Create a VAD processor that tags every emitted segment with `source`.
    /// Used for the dual-VAD pipeline where mic and system streams are
    /// processed independently to preserve source identity.
    pub fn new_with_source(
        input_sample_rate: u32,
        redemption_time_ms: u32,
        source: DeviceType,
    ) -> Result<Self> {
        let model_path = crate::speaker_diarization::model::silero_vad_path()
            .ok_or_else(|| anyhow!("silero-vad model dir not configured"))?;
        if !crate::speaker_diarization::model::model_is_ready(&model_path) {
            return Err(anyhow!(
                "silero-vad model not present at {}; download it on app startup",
                model_path.display()
            ));
        }

        // Map silero-rs's "redemption_time" (how long after losing speech to
        // wait before declaring segment end) to sherpa's `min_silence_duration`.
        let min_silence_duration = (redemption_time_ms as f32) / 1000.0;

        let config = VadModelConfig {
            silero_vad: SileroVadModelConfig {
                model: Some(model_path.to_string_lossy().into_owned()),
                // 0.45 (vs silero default 0.50) makes brief lulls in continuous
                // speech register as silence — needed for meeting audio that
                // has continuous low-level room noise.
                threshold: 0.45,
                min_silence_duration,           // From caller (typically 400ms live, 800ms batch).
                min_speech_duration: 0.25,      // Reject segments shorter than 250ms.
                window_size: VAD_WINDOW_SAMPLES as i32, // 32 ms at 16 kHz, silero-vad's window.
                // Force-cut after 20s. Real meeting utterances rarely exceed
                // this; longer segments hurt diarization (multiple speakers
                // get embedded as one) and Whisper accuracy.
                max_speech_duration: 20.0,
            },
            ten_vad: Default::default(),
            sample_rate: VAD_SAMPLE_RATE,
            num_threads: 1,
            provider: Some("cpu".to_string()),
            debug: false,
        };

        // 30-second internal buffer — must be >= max_speech_duration so the
        // VAD has room to look back when force-cutting.
        let detector = VoiceActivityDetector::create(&config, 30.0)
            .ok_or_else(|| anyhow!("Failed to create sherpa VoiceActivityDetector"))?;

        info!(
            "VAD processor created (sherpa-onnx silero): input={}Hz, vad=16000Hz, \
             min_silence={}ms, source={:?}",
            input_sample_rate, redemption_time_ms, source
        );

        Ok(Self {
            detector,
            sample_rate: input_sample_rate,
            processed_samples_16k: 0,
            source,
        })
    }

    /// Process incoming audio samples and return any complete speech segments.
    /// Handles resampling from input sample rate to 16 kHz.
    ///
    /// The caller may pass any amount of audio — a 600 ms live window or a
    /// whole imported file. Splitting it into detector windows happens here, so
    /// that no caller can accidentally blind the detector by handing it too
    /// much at once (see the `VAD_FEED_SAMPLES` note in this module).
    pub fn process_audio(&mut self, samples: &[f32]) -> Result<Vec<SpeechSegment>> {
        let resampled: std::borrow::Cow<[f32]> = if self.sample_rate == 16_000 {
            samples.into()
        } else {
            self.resample_to_16k(samples)?.into()
        };

        feed_windows(self, resampled.as_ref())
    }

    /// Flush any remaining buffered audio and return final speech segments.
    pub fn flush(&mut self) -> Result<Vec<SpeechSegment>> {
        debug!(
            "VAD flush: processed {} samples ({}s), draining trailing segments",
            self.processed_samples_16k,
            self.processed_samples_16k as f64 / 16_000.0
        );
        self.detector.flush();
        Ok(self.drain_segments())
    }

    /// Pop every queued segment from sherpa's detector, converting each to
    /// our `SpeechSegment` shape (with timestamps and source tag).
    fn drain_segments(&mut self) -> Vec<SpeechSegment> {
        let mut out = Vec::new();
        while !self.detector.is_empty() {
            let Some(seg) = self.detector.front() else { break };
            let start_sample = seg.start();
            let samples_slice = seg.samples();
            let n_samples = samples_slice.len();
            let samples = samples_slice.to_vec();

            let start_ms = (start_sample as f64 / 16_000.0) * 1000.0;
            let end_ms = ((start_sample as i64 + n_samples as i64) as f64 / 16_000.0) * 1000.0;

            info!(
                "VAD: speech segment {:.0}ms-{:.0}ms ({} samples, source={:?})",
                start_ms, end_ms, n_samples, self.source
            );

            out.push(SpeechSegment {
                samples,
                start_timestamp_ms: start_ms,
                end_timestamp_ms: end_ms,
                confidence: 0.9,
                source: self.source,
            });

            // `front()` borrows the segment; drop before pop to release the
            // sherpa-side buffer.
            drop(seg);
            self.detector.pop();
        }
        out
    }

    /// Resample `samples` from `self.sample_rate` to 16 kHz with a basic
    /// low-pass + linear interpolation. Adequate for VAD input quality.
    fn resample_to_16k(&self, samples: &[f32]) -> Result<Vec<f32>> {
        if self.sample_rate == 16_000 {
            return Ok(samples.to_vec());
        }

        let ratio = self.sample_rate as f64 / 16_000.0;
        let output_len = (samples.len() as f64 / ratio) as usize;
        let mut resampled = Vec::with_capacity(output_len);

        // Simple moving-average low-pass before downsampling to reduce aliasing.
        let filter_size = std::cmp::max(
            1,
            std::cmp::min(
                (self.sample_rate as f64 / (0.4 * self.sample_rate as f64)) as usize,
                5,
            ),
        );
        let mut filtered = Vec::with_capacity(samples.len());
        for i in 0..samples.len() {
            let start = if i >= filter_size { i - filter_size } else { 0 };
            let end = std::cmp::min(i + filter_size + 1, samples.len());
            let sum: f32 = samples[start..end].iter().sum();
            filtered.push(sum / (end - start) as f32);
        }

        // Linear-interpolation downsampling.
        for i in 0..output_len {
            let source_pos = i as f64 * ratio;
            let source_index = source_pos as usize;
            let fraction = source_pos - source_index as f64;
            if source_index + 1 < filtered.len() {
                let s1 = filtered[source_index];
                let s2 = filtered[source_index + 1];
                resampled.push(s1 + (s2 - s1) * fraction as f32);
            } else if source_index < filtered.len() {
                resampled.push(filtered[source_index]);
            }
        }

        debug!(
            "Resampled {} → {} samples ({}Hz → 16kHz)",
            samples.len(),
            resampled.len(),
            self.sample_rate
        );
        Ok(resampled)
    }
}

impl SegmentSink for ContinuousVadProcessor {
    fn accept_window(&mut self, window_16k: &[f32]) -> Result<Vec<SpeechSegment>> {
        self.detector.accept_waveform(window_16k);
        self.processed_samples_16k += window_16k.len() as u64;
        Ok(self.drain_segments())
    }

    fn finish(&mut self) -> Result<Vec<SpeechSegment>> {
        self.flush()
    }
}

/// Legacy helper: extract concatenated speech samples from a 16 kHz mono buffer.
/// Used by older code paths that want a single contiguous "speech-only" array.
pub fn extract_speech_16k(samples_mono_16k: &[f32]) -> Result<Vec<f32>> {
    let mut processor = ContinuousVadProcessor::new(16_000, 400)?;

    let mut all_segments = processor.process_audio(samples_mono_16k)?;
    let final_segments = processor.flush()?;
    all_segments.extend(final_segments);

    let mut result = Vec::new();
    let num_segments = all_segments.len();
    for segment in &all_segments {
        result.extend_from_slice(&segment.samples);
    }

    // Energy-based fallback for very short outputs (avoids Whisper hallucinating
    // on near-silent input that VAD over-aggressively trimmed).
    if result.len() < 1600 {
        let input_energy: f32 =
            samples_mono_16k.iter().map(|&x| x * x).sum::<f32>() / samples_mono_16k.len() as f32;
        let rms = input_energy.sqrt();
        let peak = samples_mono_16k
            .iter()
            .map(|&x| x.abs())
            .fold(0.0f32, f32::max);

        if rms < 0.2 || peak < 0.20 {
            info!(
                "VAD detected silence/noise (RMS: {:.6}, Peak: {:.6}); skipping",
                rms, peak
            );
            return Ok(Vec::new());
        } else {
            info!(
                "VAD energy-fallback: passing through full buffer (RMS: {:.6}, Peak: {:.6})",
                rms, peak
            );
            return Ok(samples_mono_16k.to_vec());
        }
    }

    debug!(
        "VAD: processed {} samples → {} speech samples from {} segments",
        samples_mono_16k.len(),
        result.len(),
        num_segments
    );
    Ok(result)
}

/// Convenience: get all speech chunks from a 16 kHz mono buffer.
pub fn get_speech_chunks(
    samples_mono_16k: &[f32],
    redemption_time_ms: u32,
) -> Result<Vec<SpeechSegment>> {
    get_speech_chunks_with_progress(samples_mono_16k, redemption_time_ms, |_, _| true)
}

/// Get speech chunks with a progress callback and cancellation support.
/// The callback receives `(progress_percent, segments_found_so_far)` and
/// returning `false` cancels processing.
pub fn get_speech_chunks_with_progress<F>(
    samples_mono_16k: &[f32],
    redemption_time_ms: u32,
    progress_callback: F,
) -> Result<Vec<SpeechSegment>>
where
    F: FnMut(u32, usize) -> bool,
{
    let mut processor = ContinuousVadProcessor::new(16_000, redemption_time_ms)?;

    info!(
        "VAD: processing {} samples ({:.1}s)",
        samples_mono_16k.len(),
        samples_mono_16k.len() as f64 / 16_000.0
    );

    let segments = collect_speech(&mut processor, samples_mono_16k, progress_callback)?;

    info!("VAD complete: {} speech segments", segments.len());
    Ok(segments)
}

/// Drive `sink` over a whole buffer, reporting progress and honouring
/// cancellation.
///
/// The audio is walked in `PROGRESS_CHUNK`-sized slices purely so progress can
/// be reported and cancellation noticed; each slice is then fed to the detector
/// one window at a time by [`feed_windows`].
///
/// This used to apply the slicing only to inputs above a 60-second threshold,
/// and to hand anything shorter to the detector in a single call. That was the
/// bug: below the threshold there was one call, one verdict, and therefore at
/// most one 314 ms segment for the entire file. There is no safe input size, so
/// there is no threshold any more.
fn collect_speech<S, F>(
    sink: &mut S,
    samples_16k: &[f32],
    mut progress_callback: F,
) -> Result<Vec<SpeechSegment>>
where
    S: SegmentSink,
    F: FnMut(u32, usize) -> bool,
{
    /// 10 s at 16 kHz — reporting granularity only, never a detector input size.
    const PROGRESS_CHUNK: usize = 160_000;

    let total_samples = samples_16k.len();
    let mut all_segments = Vec::new();
    if total_samples == 0 {
        return Ok(all_segments);
    }

    let total_chunks = (total_samples + PROGRESS_CHUNK - 1) / PROGRESS_CHUNK;
    let mut processed = 0usize;
    let mut last_progress = 0u32;

    for (index, chunk) in samples_16k.chunks(PROGRESS_CHUNK).enumerate() {
        let start_time = std::time::Instant::now();
        all_segments.extend(feed_windows(sink, chunk)?);
        let elapsed = start_time.elapsed();

        debug!(
            "VAD chunk {}/{} processed in {:?}, {} segments so far",
            index + 1,
            total_chunks,
            elapsed,
            all_segments.len()
        );
        if elapsed.as_secs() > 10 {
            warn!(
                "VAD chunk {} took {:?} — possible performance issue",
                index + 1,
                elapsed
            );
        }

        processed += chunk.len();
        let progress = ((processed * 100) / total_samples) as u32;

        // Report on every 5% step, and always once at the end — a file short
        // enough to fit in a single chunk must still tell the caller it is done.
        if progress >= last_progress + 5 || processed == total_samples {
            debug!(
                "VAD progress {}% ({} segments so far)",
                progress,
                all_segments.len()
            );
            if !progress_callback(progress, all_segments.len()) {
                info!("VAD cancelled by callback at {}%", progress);
                return Err(anyhow!("VAD processing cancelled"));
            }
            last_progress = progress;
        }
    }

    all_segments.extend(sink.finish()?);
    Ok(all_segments)
}

/// Pure tests for the feeding policy — the part of this module that decides how
/// much audio the detector sees per call.
///
/// These need no ONNX runtime, no model file and no audio on disk. In place of
/// the real detector they drive [`SherpaVadModel`], a line-by-line
/// transcription of sherpa-onnx's own `VoiceActivityDetectorImpl`, so a test
/// failure here means the *policy* is wrong, not that a model was missing.
#[cfg(test)]
mod feeding_policy_tests {
    use super::*;
    use std::collections::VecDeque;

    /// A model of sherpa-onnx's `VoiceActivityDetectorImpl` as configured by
    /// this module, transcribed from `sherpa-onnx/csrc/voice-activity-detector.cc`
    /// and `circular-buffer.cc` (v1.13.0).
    ///
    /// Everything that decides *where segment boundaries land* is reproduced
    /// faithfully: the `last_` re-buffering, the `k`-window loop, the OR-fold of
    /// per-window verdicts into one per-call verdict, the tail-anchored
    /// `start_`, the pops, and `Flush()`.
    ///
    /// The single substitution is the ONNX call. `model_->IsSpeech(...)` becomes
    /// a deterministic oracle — "this window is speech if any sample exceeds
    /// 0.1" — because the question under test is how much audio reaches the
    /// model per verdict, not how the model votes.
    ///
    /// Deliberate divergences, both in directions that cannot mask the bug:
    /// - `min_speech_duration` hysteresis inside silero is not modelled; the
    ///   oracle answers each window independently.
    /// - `Tail() - MinSilenceDurationSamples()` is saturated at zero instead of
    ///   going negative as the C++ `int32_t` would.
    struct SherpaVadModel {
        window_size: usize,
        window_shift: usize,
        min_speech_samples: usize,
        min_silence_samples: usize,
        /// `last_` — samples accepted but not yet covering a full window.
        last: Vec<f32>,
        /// `buffer_` contents, holding absolute indices `[head, tail)`.
        buffer: Vec<f32>,
        head: usize,
        tail: usize,
        /// `start_` (`-1` in the C++).
        start: Option<usize>,
        segments: VecDeque<(usize, Vec<f32>)>,
        /// Length of every `accept_window` call, for the invariant test.
        call_lengths: Vec<usize>,
    }

    impl SherpaVadModel {
        fn new(redemption_time_ms: u32) -> Self {
            Self {
                // silero v4: WindowSize() == window_size + window_overlap_(0).
                window_size: VAD_WINDOW_SAMPLES,
                window_shift: VAD_WINDOW_SAMPLES,
                min_speech_samples: 4_000, // 0.25 s * 16 kHz, per `new_with_source`
                min_silence_samples: (redemption_time_ms as usize * 16_000) / 1_000,
                last: Vec::new(),
                buffer: Vec::new(),
                head: 0,
                tail: 0,
                start: None,
                segments: VecDeque::new(),
                call_lengths: Vec::new(),
            }
        }

        /// The oracle standing in for `model_->IsSpeech`.
        fn window_is_speech(window: &[f32]) -> bool {
            window.iter().any(|s| s.abs() > 0.1)
        }

        /// `VoiceActivityDetectorImpl::AcceptWaveform`.
        fn accept_waveform(&mut self, samples: &[f32]) {
            let wsize = self.window_size;
            let shift = self.window_shift;

            self.last.extend_from_slice(samples);
            if self.last.len() < wsize {
                return;
            }

            let k = (self.last.len() - wsize) / shift + 1;
            let mut is_speech = false;
            let mut consumed = 0usize;

            for i in 0..k {
                let p = i * shift;
                let window = self.last[p..p + wsize].to_vec();
                // buffer_.Push(p, window_shift)
                self.buffer.extend_from_slice(&window[..shift]);
                self.tail += shift;
                // is_speech = is_speech || model_->IsSpeech(p, window_size)
                is_speech = is_speech || Self::window_is_speech(&window);
                consumed = p + shift;
            }
            self.last = self.last[consumed..].to_vec();

            if is_speech {
                if self.start.is_none() {
                    let anchor = self.tail as i64
                        - 2 * wsize as i64
                        - self.min_speech_samples as i64;
                    self.start = Some(anchor.max(self.head as i64) as usize);
                }
                return;
            }

            // Silence: close the segment in flight, if there is one.
            if let Some(s) = self.start {
                if self.tail > self.head {
                    let end = self.tail.saturating_sub(self.min_silence_samples);
                    if end > s {
                        let from = s - self.head;
                        let n = end - s;
                        let taken = self.buffer[from..from + n].to_vec();
                        self.segments.push_back((s, taken));
                        let pop = end - self.head;
                        self.buffer.drain(..pop);
                        self.head = end;
                    }
                }
            }

            // No segment in flight: drop everything but the lookback tail.
            if self.start.is_none() {
                let end = self.tail as i64 - 2 * wsize as i64 - self.min_speech_samples as i64;
                let n = (end - self.head as i64).max(0) as usize;
                if n > 0 {
                    self.buffer.drain(..n);
                    self.head += n;
                }
            }

            self.start = None;
        }

        /// `VoiceActivityDetectorImpl::Flush`.
        fn flush_detector(&mut self) {
            let Some(s) = self.start else { return };
            if self.tail == self.head {
                return;
            }
            let end = self.tail;
            if end <= s {
                return;
            }
            let from = s - self.head;
            let n = end - s;
            let taken = self.buffer[from..from + n].to_vec();
            self.segments.push_back((s, taken));
            let pop = end - self.head;
            self.buffer.drain(..pop);
            self.head = end;
            self.start = None;
        }

        /// The same conversion `ContinuousVadProcessor::drain_segments` performs.
        fn drain(&mut self) -> Vec<SpeechSegment> {
            let mut out = Vec::new();
            while let Some((start_sample, samples)) = self.segments.pop_front() {
                let start_ms = (start_sample as f64 / 16_000.0) * 1000.0;
                let end_ms = ((start_sample + samples.len()) as f64 / 16_000.0) * 1000.0;
                out.push(SpeechSegment {
                    samples,
                    start_timestamp_ms: start_ms,
                    end_timestamp_ms: end_ms,
                    confidence: 0.9,
                    source: DeviceType::Microphone,
                });
            }
            out
        }
    }

    impl SegmentSink for SherpaVadModel {
        fn accept_window(&mut self, window_16k: &[f32]) -> Result<Vec<SpeechSegment>> {
            self.call_lengths.push(window_16k.len());
            self.accept_waveform(window_16k);
            Ok(self.drain())
        }

        fn finish(&mut self) -> Result<Vec<SpeechSegment>> {
            self.flush_detector();
            Ok(self.drain())
        }
    }

    /// The failing import: 673_023 samples = 42.06 s at 16 kHz.
    const FORTY_TWO_SECONDS: usize = 673_023;

    /// Audio that is speech from the first sample to the last.
    fn speech_throughout(len: usize) -> Vec<f32> {
        vec![0.5f32; len]
    }

    /// Silence until `onset`, speech from there to the end.
    fn speech_from(onset: usize, len: usize) -> Vec<f32> {
        let mut samples = vec![0.0f32; len];
        for s in samples[onset..].iter_mut() {
            *s = 0.5;
        }
        samples
    }

    fn speech_ms(segments: &[SpeechSegment]) -> f64 {
        segments
            .iter()
            .map(|s| s.end_timestamp_ms - s.start_timestamp_ms)
            .sum()
    }

    /// Characterises the defect, and pins the arithmetic that explains it.
    ///
    /// This is what `get_speech_chunks_with_progress` used to do to any file
    /// under 60 seconds: one `accept_waveform` call carrying everything. The
    /// numbers below are not invented — they are the ones a real 42-second
    /// import produced (one segment, 41734 ms–42048 ms, 314 ms long) and they
    /// fall straight out of sherpa's `start_` anchor:
    ///
    ///   pushed = floor((673023 - 512) / 512 + 1) * 512 = 672768 = Tail
    ///   start_ = Tail - 2*512 - 4000                   = 667744 → 41734 ms
    ///   end    = Tail                                  = 672768 → 42048 ms
    ///
    /// The production code must never feed the detector this way again; the
    /// test below (`speech_across_a_whole_file_is_reported_across_it`) is the
    /// guard.
    #[test]
    fn one_giant_call_reports_only_the_last_314ms_of_the_file() {
        let audio = speech_throughout(FORTY_TWO_SECONDS);
        let mut detector = SherpaVadModel::new(800);

        detector.accept_waveform(&audio);
        detector.flush_detector();
        let segments = detector.drain();

        assert_eq!(segments.len(), 1, "expected the single tail sliver");
        assert!(
            (segments[0].start_timestamp_ms - 41_734.0).abs() < 1.0,
            "start was {:.0}ms, expected 41734ms",
            segments[0].start_timestamp_ms
        );
        assert!(
            (segments[0].end_timestamp_ms - 42_048.0).abs() < 1.0,
            "end was {:.0}ms, expected 42048ms",
            segments[0].end_timestamp_ms
        );
        assert!(
            (speech_ms(&segments) - 314.0).abs() < 2.0,
            "expected the 314ms sliver, got {:.0}ms",
            speech_ms(&segments)
        );
    }

    /// A 42-second file that is speech throughout must come back as speech
    /// throughout — not as a sliver at the tail.
    ///
    /// Fails on the old code: 42 s is below the 960_000-sample threshold, so the
    /// whole file went to the detector in one call and only 314 ms came back.
    #[test]
    fn speech_across_a_whole_file_is_reported_across_it() {
        let audio = speech_throughout(FORTY_TWO_SECONDS);
        let mut detector = SherpaVadModel::new(800);

        let segments = collect_speech(&mut detector, &audio, |_, _| true).expect("VAD failed");

        assert!(!segments.is_empty(), "no speech found in a file that is all speech");
        assert!(
            segments[0].start_timestamp_ms < 1_000.0,
            "speech starts at 0 but the first segment starts at {:.0}ms",
            segments[0].start_timestamp_ms
        );
        assert!(
            speech_ms(&segments) > 40_000.0,
            "recovered only {:.0}ms of speech from a 42s file that is speech end to end",
            speech_ms(&segments)
        );
    }

    /// Speech that starts partway in is timed to where it actually starts.
    ///
    /// Sherpa deliberately anchors a segment 2*512 + 4000 = 5024 samples (314 ms)
    /// *before* the window that triggered it, so a little pre-roll is expected
    /// and welcome — it is what stops words being clipped. What is not
    /// acceptable is being late, or being 20 seconds early.
    #[test]
    fn a_late_speech_onset_is_timed_to_the_speech_not_to_the_file_end() {
        let onset = 20 * 16_000; // 20 s in
        let audio = speech_from(onset, FORTY_TWO_SECONDS);
        let mut detector = SherpaVadModel::new(800);

        let segments = collect_speech(&mut detector, &audio, |_, _| true).expect("VAD failed");

        assert!(!segments.is_empty(), "no speech found");
        let start = segments[0].start_timestamp_ms;
        assert!(
            start <= 20_000.0,
            "segment starts at {:.0}ms, after the speech did (20000ms) — words would be clipped",
            start
        );
        assert!(
            start > 19_000.0,
            "segment starts at {:.0}ms, far too early for speech at 20000ms",
            start
        );
    }

    /// A silent file must stay silent. Guards the fix against the opposite
    /// failure — reporting speech everywhere to make the assertions above pass.
    #[test]
    fn a_silent_file_yields_no_speech() {
        let audio = vec![0.0f32; FORTY_TWO_SECONDS];
        let mut detector = SherpaVadModel::new(800);

        let segments = collect_speech(&mut detector, &audio, |_, _| true).expect("VAD failed");

        assert!(
            segments.is_empty(),
            "found {} segments in pure silence",
            segments.len()
        );
    }

    /// The invariant that makes the whole thing work: sherpa gives one verdict
    /// per call, so a call must never carry more than one window.
    #[test]
    fn no_call_hands_the_detector_more_than_one_window() {
        let audio = speech_throughout(FORTY_TWO_SECONDS);
        let mut detector = SherpaVadModel::new(800);

        collect_speech(&mut detector, &audio, |_, _| true).expect("VAD failed");

        assert!(
            detector.call_lengths.iter().all(|&n| n <= VAD_WINDOW_SAMPLES),
            "largest call carried {} samples, more than one {}-sample window",
            detector.call_lengths.iter().copied().max().unwrap_or(0),
            VAD_WINDOW_SAMPLES
        );
        assert_eq!(
            detector.call_lengths.iter().sum::<usize>(),
            FORTY_TWO_SECONDS,
            "some audio never reached the detector"
        );
        assert!(
            detector.call_lengths.len() > 1_300,
            "42s should take ~1300 window calls, took {}",
            detector.call_lengths.len()
        );
    }

    /// Progress must be reported for short files too.
    ///
    /// Fails on the old code: below the 60-second threshold the callback was
    /// never invoked at all, so an import of a short file showed a frozen
    /// progress bar and could not be cancelled during VAD.
    #[test]
    fn a_file_below_the_old_threshold_still_reports_progress() {
        let audio = speech_throughout(FORTY_TWO_SECONDS);
        let mut detector = SherpaVadModel::new(800);
        let mut reported = Vec::new();

        collect_speech(&mut detector, &audio, |percent, _| {
            reported.push(percent);
            true
        })
        .expect("VAD failed");

        assert!(!reported.is_empty(), "no progress was reported at all");
        assert_eq!(
            reported.last().copied(),
            Some(100),
            "progress never reached 100%: {:?}",
            reported
        );
    }

    /// Even a file small enough to fit in one progress chunk reports completion.
    #[test]
    fn a_one_second_file_reports_completion() {
        let audio = speech_throughout(16_000);
        let mut detector = SherpaVadModel::new(800);
        let mut reported = Vec::new();

        collect_speech(&mut detector, &audio, |percent, _| {
            reported.push(percent);
            true
        })
        .expect("VAD failed");

        assert_eq!(reported, vec![100]);
    }

    /// Returning `false` from the callback aborts the run.
    #[test]
    fn refusing_progress_cancels_the_run() {
        let audio = speech_throughout(FORTY_TWO_SECONDS);
        let mut detector = SherpaVadModel::new(800);

        let err = collect_speech(&mut detector, &audio, |_, _| false)
            .expect_err("expected cancellation");

        assert!(
            err.to_string().contains("cancelled"),
            "unexpected error: {}",
            err
        );
    }

    /// An empty buffer is not an error and does not invoke the callback.
    #[test]
    fn an_empty_buffer_yields_nothing() {
        let mut detector = SherpaVadModel::new(800);
        let mut called = false;

        let segments = collect_speech(&mut detector, &[], |_, _| {
            called = true;
            true
        })
        .expect("VAD failed");

        assert!(segments.is_empty());
        assert!(!called, "progress reported for an empty buffer");
    }

    /// Splitting the same audio across more calls must not change what comes
    /// out — the detector's state has to carry across `process_audio`
    /// boundaries, which is what lets the live pipeline hand it 600 ms at a
    /// time without losing utterances that span two windows.
    #[test]
    fn the_result_does_not_depend_on_how_the_caller_slices_the_input() {
        let audio = speech_from(20 * 16_000, FORTY_TWO_SECONDS);

        let mut one_pass = SherpaVadModel::new(800);
        let whole = collect_speech(&mut one_pass, &audio, |_, _| true).expect("VAD failed");

        let mut piecemeal = SherpaVadModel::new(800);
        let mut split = Vec::new();
        for slice in audio.chunks(9_600) {
            // 600 ms, the live pipeline's window
            split.extend(feed_windows(&mut piecemeal, slice).expect("VAD failed"));
        }
        split.extend(piecemeal.finish().expect("VAD failed"));

        assert_eq!(whole.len(), split.len(), "segment count changed with slicing");
        for (a, b) in whole.iter().zip(split.iter()) {
            assert!(
                (a.start_timestamp_ms - b.start_timestamp_ms).abs() < 1.0
                    && (a.end_timestamp_ms - b.end_timestamp_ms).abs() < 1.0,
                "segment moved: {:.0}-{:.0}ms vs {:.0}-{:.0}ms",
                a.start_timestamp_ms,
                a.end_timestamp_ms,
                b.start_timestamp_ms,
                b.end_timestamp_ms
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn silero_vad_available() -> bool {
        crate::speaker_diarization::model::silero_vad_path()
            .map(|p| crate::speaker_diarization::model::model_is_ready(&p))
            .unwrap_or(false)
    }

    /// Generate synthetic speech-like audio with alternating speech/silence.
    fn generate_test_audio_with_speech(duration_seconds: f32, sample_rate: u32) -> Vec<f32> {
        let total_samples = (duration_seconds * sample_rate as f32) as usize;
        let mut samples = vec![0.0f32; total_samples];

        let speech_interval = 10.0;
        let speech_duration = 5.0;

        for i in 0..total_samples {
            let time = i as f32 / sample_rate as f32;
            let cycle_time = time % speech_interval;
            if cycle_time < speech_duration {
                let freq1 = 200.0 + (time * 50.0).sin() * 100.0;
                let freq2 = freq1 * 2.0;
                let freq3 = freq1 * 3.0;
                let amplitude = 0.3 + 0.1 * (time * 5.0).sin();
                samples[i] = amplitude
                    * (0.5 * (2.0 * std::f32::consts::PI * freq1 * time).sin()
                        + 0.3 * (2.0 * std::f32::consts::PI * freq2 * time).sin()
                        + 0.2 * (2.0 * std::f32::consts::PI * freq3 * time).sin());
            }
        }
        samples
    }

    /// End-to-end check against the real detector on real speech.
    ///
    /// This is the test that would have caught the 42-second import failure
    /// with no reasoning required — jfk.wav is ~11 s of continuous speech, and
    /// under the old code it fell below the 60 s threshold and came back as a
    /// single ~314 ms sliver at the tail.
    ///
    /// Skips unless both the silero model and the sample are on disk.
    #[test]
    fn short_real_speech_is_not_reduced_to_a_tail_sliver() {
        if !silero_vad_available() {
            eprintln!("skipping: silero_vad.onnx not present");
            return;
        }
        let sample = std::path::Path::new("../../backend/whisper.cpp/samples/jfk.wav");
        if !sample.exists() {
            eprintln!("skipping: {} not present", sample.display());
            return;
        }

        let decoded = crate::audio::decoder::decode_audio_file(sample).expect("decode failed");
        let duration_ms = decoded.duration_seconds * 1000.0;
        let audio = decoded.to_whisper_format();

        let segments = get_speech_chunks(&audio, 800).expect("VAD failed");
        let speech_ms: f64 = segments
            .iter()
            .map(|s| s.end_timestamp_ms - s.start_timestamp_ms)
            .sum();

        assert!(!segments.is_empty(), "no speech detected in jfk.wav");
        assert!(
            speech_ms > duration_ms * 0.5,
            "only {:.0}ms of speech in a {:.0}ms clip of continuous speech ({} segments)",
            speech_ms,
            duration_ms,
            segments.len()
        );
        assert!(
            segments[0].start_timestamp_ms < duration_ms * 0.5,
            "first segment starts at {:.0}ms, more than halfway into a {:.0}ms clip",
            segments[0].start_timestamp_ms,
            duration_ms
        );
    }

    #[test]
    fn test_vad_large_file_progress() {
        if !silero_vad_available() {
            eprintln!("skipping: silero_vad.onnx not present");
            return;
        }
        let audio = generate_test_audio_with_speech(120.0, 16_000);
        let mut progress_updates = Vec::new();
        let segments = get_speech_chunks_with_progress(&audio, 2000, |progress, segments| {
            progress_updates.push((progress, segments));
            true
        })
        .expect("processing failed");
        assert!(!progress_updates.is_empty());
        // Synthetic audio doesn't always trigger silero, so don't assert
        // segment count — just confirm we made it through without panicking.
        let _ = segments;
    }

    #[test]
    fn test_vad_cancellation() {
        if !silero_vad_available() {
            eprintln!("skipping: silero_vad.onnx not present");
            return;
        }
        let audio = generate_test_audio_with_speech(120.0, 16_000);
        let result = get_speech_chunks_with_progress(&audio, 2000, |progress, _| progress < 50);
        assert!(result.is_err(), "expected cancellation error");
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("cancelled"));
    }

    #[test]
    fn test_vad_continuous_processor_state_across_chunks() {
        if !silero_vad_available() {
            eprintln!("skipping: silero_vad.onnx not present");
            return;
        }
        let mut processor =
            ContinuousVadProcessor::new(16_000, 2000).expect("Failed to create processor");
        let audio = generate_test_audio_with_speech(30.0, 16_000);

        let mut all_segments = Vec::new();
        for chunk in audio.chunks(160_000) {
            let segments = processor.process_audio(chunk).expect("process failed");
            all_segments.extend(segments);
        }
        all_segments.extend(processor.flush().expect("flush failed"));
        // Synthetic harmonic stack isn't always speech-like enough to trigger
        // silero VAD; just confirm the processor doesn't panic across chunks.
        let _ = all_segments;
    }
}

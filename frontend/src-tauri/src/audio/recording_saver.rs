use anyhow::Result;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::mpsc;
use tokio::sync::Mutex as AsyncMutex;

use super::audio_processing::create_meeting_folder;
use super::incremental_saver::IncrementalAudioSaver;
use super::recording_state::AudioChunk;

/// Append-only log of transcript lines, kept in the meeting folder *while* the
/// recording runs.
///
/// Why it exists: every accepted line has to survive a crash immediately, and
/// the way that used to be achieved was to re-serialise and re-write the whole
/// of `transcripts.json` after each one. That makes the cost of a line grow with
/// the length of the meeting. Measured on the 2026-07-30 recording: 1392 lines
/// ending at a 442 kB file, so the last line cost a 442 kB write and the meeting
/// cost about 300 MB of writes in 1392 rename operations — the fatigue climbing
/// steadily while the user is still talking.
///
/// One appended line costs the same whether it is the first or the thousandth,
/// so durability stops paying for length. `transcripts.json` is then written
/// once, at the end.
///
/// Two properties worth knowing when reading one of these files by hand:
///
/// - It is one JSON object per line, not a JSON document. Parse it a line at a
///   time.
/// - A line may appear more than once for the same `sequence_id`, because
///   `add_transcript_segment` also updates existing segments and an append-only
///   log records the update rather than replacing the original. **The last entry
///   for a `sequence_id` is the current one.**
///
/// It is deleted once `transcripts.json` has been written and verified, so
/// **finding one of these next to a finished meeting means that meeting did not
/// stop cleanly**, and the log is the transcript.
const TRANSCRIPT_LOG_FILENAME: &str = "transcripts.jsonl";

/// Structured transcript segment for JSON export
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub id: String,
    pub text: String,
    pub audio_start_time: f64, // Seconds from recording start
    pub audio_end_time: f64,   // Seconds from recording start
    pub duration: f64,         // Segment duration in seconds
    pub display_time: String,  // Formatted time for display like "[02:15]"
    pub confidence: f32,
    pub sequence_id: u64,
    /// Speaker label assigned at transcription time ("Me", "Speaker N", or a
    /// stored profile name). None when source identity wasn't determined.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    /// Foreign key to a stored voice profile when matched, else None.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice_profile_id: Option<String>,
}

/// Meeting metadata structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingMetadata {
    pub version: String,
    pub meeting_id: Option<String>,
    pub meeting_name: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub duration_seconds: Option<f64>,
    pub devices: DeviceInfo,
    pub audio_file: String,
    pub transcript_file: String,
    pub sample_rate: u32,
    pub status: String, // "recording", "completed", "error"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub microphone: Option<String>,
    pub system_audio: Option<String>,
}

/// New recording saver using incremental saving strategy
pub struct RecordingSaver {
    incremental_saver: Option<Arc<AsyncMutex<IncrementalAudioSaver>>>,
    meeting_folder: Option<PathBuf>,
    meeting_name: Option<String>,
    metadata: Option<MeetingMetadata>,
    transcript_segments: Arc<Mutex<Vec<TranscriptSegment>>>,
    chunk_receiver: Option<mpsc::UnboundedReceiver<AudioChunk>>,
    is_saving: Arc<Mutex<bool>>,
}

impl RecordingSaver {
    pub fn new() -> Self {
        Self {
            incremental_saver: None,
            meeting_folder: None,
            meeting_name: None,
            metadata: None,
            transcript_segments: Arc::new(Mutex::new(Vec::new())),
            chunk_receiver: None,
            is_saving: Arc::new(Mutex::new(false)),
        }
    }

    /// Set the meeting name for this recording session
    pub fn set_meeting_name(&mut self, name: Option<String>) {
        self.meeting_name = name;
    }

    /// Set device information in metadata
    pub fn set_device_info(&mut self, mic_name: Option<String>, sys_name: Option<String>) {
        if let Some(ref mut metadata) = self.metadata {
            metadata.devices.microphone = mic_name;
            metadata.devices.system_audio = sys_name;

            // Write updated metadata to disk if folder exists
            if let Some(folder) = &self.meeting_folder {
                let metadata_clone = metadata.clone();
                if let Err(e) = self.write_metadata(folder, &metadata_clone) {
                    warn!("Failed to update metadata with device info: {}", e);
                }
            }
        }
    }

    /// Add or update a structured transcript segment (upserts based on sequence_id)
    ///
    /// The line is also made durable immediately, by appending it to
    /// [`TRANSCRIPT_LOG_FILENAME`]. It is deliberately *not* written into
    /// `transcripts.json` here: that file is produced once, at
    /// `stop_and_save`, because writing all of it per line made each line cost
    /// more than the last.
    pub fn add_transcript_segment(&self, segment: TranscriptSegment) {
        if let Ok(mut segments) = self.transcript_segments.lock() {
            // Check if segment with same sequence_id exists (update it)
            if let Some(existing) = segments
                .iter_mut()
                .find(|s| s.sequence_id == segment.sequence_id)
            {
                *existing = segment.clone();
                info!(
                    "Updated transcript segment {} (seq: {}) - total segments: {}",
                    segment.id,
                    segment.sequence_id,
                    segments.len()
                );
            } else {
                // New segment, add it
                segments.push(segment.clone());
                info!(
                    "Added new transcript segment {} (seq: {}) - total segments: {}",
                    segment.id,
                    segment.sequence_id,
                    segments.len()
                );
            }
        } else {
            error!(
                "Failed to lock transcript segments for adding segment {}",
                segment.id
            );
        }

        // Make the line durable now: one appended record, same cost whether it
        // is the first line of the meeting or the thousandth.
        if let Some(folder) = &self.meeting_folder {
            if let Err(e) = self.append_to_transcript_log(folder, &segment) {
                warn!("Failed to append to the transcript log: {}", e);
            }
        }
    }

    /// Legacy method for backward compatibility - converts text to basic segment
    pub fn add_transcript_chunk(&self, text: String) {
        let segment = TranscriptSegment {
            id: format!("seg_{}", chrono::Utc::now().timestamp_millis()),
            text,
            audio_start_time: 0.0,
            audio_end_time: 0.0,
            duration: 0.0,
            display_time: "[00:00]".to_string(),
            confidence: 1.0,
            sequence_id: 0,
            speaker: None,
            voice_profile_id: None,
        };
        self.add_transcript_segment(segment);
    }

    /// Start accumulation with optional incremental saving
    ///
    /// # Arguments
    /// * `auto_save` - If true, creates checkpoints and enables saving. If false, audio chunks are discarded.
    pub fn start_accumulation(&mut self, auto_save: bool) -> mpsc::UnboundedSender<AudioChunk> {
        if auto_save {
            info!("Initializing incremental audio saver for recording (auto-save ENABLED)");
        } else {
            info!(
                "Starting recording without audio saving (auto-save DISABLED - transcripts only)"
            );
        }

        // Create channel for receiving audio chunks
        let (sender, receiver) = mpsc::unbounded_channel::<AudioChunk>();
        self.chunk_receiver = Some(receiver);

        // Initialize meeting folder and incremental saver ONLY if auto_save is enabled
        if auto_save {
            if let Some(name) = self.meeting_name.clone() {
                match self.initialize_meeting_folder(&name, true) {
                    Ok(()) => info!("Successfully initialized meeting folder with checkpoints"),
                    Err(e) => {
                        error!("Failed to initialize meeting folder: {}", e);
                        // Continue anyway - will use fallback flat structure
                    }
                }
            }
        } else {
            // When auto_save is false, still create meeting folder for transcripts/metadata
            // but skip .checkpoints directory
            if let Some(name) = self.meeting_name.clone() {
                match self.initialize_meeting_folder(&name, false) {
                    Ok(()) => info!("Successfully initialized meeting folder (transcripts only)"),
                    Err(e) => {
                        error!("Failed to initialize meeting folder: {}", e);
                    }
                }
            }
        }

        // Start accumulation task
        let is_saving_clone = self.is_saving.clone();
        let incremental_saver_arc = self.incremental_saver.clone();
        let save_audio = auto_save;

        if let Some(mut receiver) = self.chunk_receiver.take() {
            tokio::spawn(async move {
                info!(
                    "Recording saver accumulation task started (save_audio: {})",
                    save_audio
                );

                while let Some(chunk) = receiver.recv().await {
                    // Check if we should continue
                    let should_continue = if let Ok(is_saving) = is_saving_clone.lock() {
                        *is_saving
                    } else {
                        false
                    };

                    if !should_continue {
                        break;
                    }

                    // Only process audio chunks if auto_save is enabled
                    if save_audio {
                        // Add chunk to incremental saver
                        if let Some(saver_arc) = &incremental_saver_arc {
                            let mut saver_guard = saver_arc.lock().await;
                            if let Err(e) = saver_guard.add_chunk(chunk) {
                                error!("Failed to add chunk to incremental saver: {}", e);
                            }
                        } else {
                            error!("Incremental saver not available while accumulating");
                        }
                    } else {
                        // auto_save is false: discard audio chunk (no-op)
                        // Transcription already happened in the pipeline before this point
                    }
                }

                info!("Recording saver accumulation task ended");
            });
        }

        // Set saving flag
        if let Ok(mut is_saving) = self.is_saving.lock() {
            *is_saving = true;
        }

        sender
    }

    /// Initialize meeting folder structure and metadata
    ///
    /// # Arguments
    /// * `meeting_name` - Name of the meeting
    /// * `create_checkpoints` - Whether to create .checkpoints/ directory and IncrementalAudioSaver
    fn initialize_meeting_folder(
        &mut self,
        meeting_name: &str,
        create_checkpoints: bool,
    ) -> Result<()> {
        // Load preferences to get base recordings folder
        let base_folder = super::recording_preferences::get_default_recordings_folder();

        // Create meeting folder structure (with or without .checkpoints/ subdirectory)
        let meeting_folder = create_meeting_folder(&base_folder, meeting_name, create_checkpoints)?;

        // Only initialize incremental saver if checkpoints are needed (auto_save is true)
        if create_checkpoints {
            let incremental_saver = IncrementalAudioSaver::new(meeting_folder.clone(), 48000)?;
            self.incremental_saver = Some(Arc::new(AsyncMutex::new(incremental_saver)));
            info!(
                "✅ Incremental audio saver initialized for meeting: {}",
                meeting_name
            );
        } else {
            info!("⚠️  Skipped incremental audio saver (auto-save disabled)");
        }

        // Create initial metadata
        let metadata = MeetingMetadata {
            version: "1.0".to_string(),
            meeting_id: None, // Will be set by backend
            meeting_name: Some(meeting_name.to_string()),
            created_at: chrono::Utc::now().to_rfc3339(),
            completed_at: None,
            duration_seconds: None,
            devices: DeviceInfo {
                microphone: None, // Could be enhanced to store actual device names
                system_audio: None,
            },
            audio_file: if create_checkpoints {
                "audio.mp4".to_string()
            } else {
                "".to_string()
            },
            transcript_file: "transcripts.json".to_string(),
            sample_rate: 48000,
            status: "recording".to_string(),
        };

        // Write initial metadata.json
        self.write_metadata(&meeting_folder, &metadata)?;

        self.meeting_folder = Some(meeting_folder);
        self.metadata = Some(metadata);

        Ok(())
    }

    /// Write metadata.json to disk (atomic write with temp file)
    fn write_metadata(&self, folder: &PathBuf, metadata: &MeetingMetadata) -> Result<()> {
        let metadata_path = folder.join("metadata.json");
        let temp_path = folder.join(".metadata.json.tmp");

        let json_string = serde_json::to_string_pretty(metadata)?;
        std::fs::write(&temp_path, json_string)?;
        std::fs::rename(&temp_path, &metadata_path)?; // Atomic

        Ok(())
    }

    /// Append one transcript line to [`TRANSCRIPT_LOG_FILENAME`].
    ///
    /// Compact JSON, not pretty: this is a record to be replayed, not read for
    /// pleasure, and pretty-printing would multiply the bytes written for no
    /// gain.
    ///
    /// The file is opened and closed per line rather than kept open in the
    /// struct. At roughly one line every few seconds the open costs nothing
    /// measurable, and not holding a handle keeps this method usable from
    /// `&self` and leaves nothing half-written if the process dies between
    /// lines.
    fn append_to_transcript_log(
        &self,
        folder: &PathBuf,
        segment: &TranscriptSegment,
    ) -> Result<()> {
        use std::io::Write;

        let log_path = folder.join(TRANSCRIPT_LOG_FILENAME);

        // Build the whole line before opening the file, so a serialisation
        // failure cannot leave a partial record behind.
        let mut line = serde_json::to_string(segment)?;
        line.push('\n');

        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)?;
        file.write_all(line.as_bytes())?;

        Ok(())
    }

    /// Remove the append-only log, once `transcripts.json` holds everything it
    /// held.
    ///
    /// Not an error if it was never created — a meeting with no transcript lines
    /// has no log. Failing to remove it is only a warning: a stale log is
    /// confusing, but it is not lost data.
    fn discard_transcript_log(&self, folder: &PathBuf) {
        let log_path = folder.join(TRANSCRIPT_LOG_FILENAME);
        match std::fs::remove_file(&log_path) {
            Ok(()) => info!(
                "Discarded {} — transcripts.json now holds the transcript",
                TRANSCRIPT_LOG_FILENAME
            ),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => warn!(
                "Could not remove the transcript log {}: {}",
                log_path.display(),
                e
            ),
        }
    }

    /// Write transcripts.json to disk (atomic write with temp file and validation)
    fn write_transcripts_json(&self, folder: &PathBuf) -> Result<()> {
        // Clone segments to avoid holding lock during I/O
        let segments_clone = if let Ok(segments) = self.transcript_segments.lock() {
            segments.clone()
        } else {
            error!("Failed to lock transcript segments for writing");
            return Err(anyhow::anyhow!("Failed to lock transcript segments"));
        };

        info!(
            "Writing {} transcript segments to JSON",
            segments_clone.len()
        );

        let transcript_path = folder.join("transcripts.json");
        let temp_path = folder.join(".transcripts.json.tmp");

        // Create JSON structure
        let json = serde_json::json!({
            "version": "1.0",
            "segments": segments_clone,
            "last_updated": chrono::Utc::now().to_rfc3339(),
            "total_segments": segments_clone.len()
        });

        // Serialize to pretty JSON string
        let json_string = serde_json::to_string_pretty(&json).map_err(|e| {
            error!("Failed to serialize transcripts to JSON: {}", e);
            anyhow::anyhow!("JSON serialization failed: {}", e)
        })?;

        // Write to temp file with error handling
        std::fs::write(&temp_path, &json_string).map_err(|e| {
            error!(
                "Failed to write transcript temp file to {}: {}",
                temp_path.display(),
                e
            );
            anyhow::anyhow!("Failed to write temp file: {}", e)
        })?;

        // Verify temp file was written correctly
        if !temp_path.exists() {
            error!(
                "Temp transcript file does not exist after write: {}",
                temp_path.display()
            );
            return Err(anyhow::anyhow!("Temp file verification failed"));
        }

        // Atomic rename
        std::fs::rename(&temp_path, &transcript_path).map_err(|e| {
            error!(
                "Failed to rename transcript file from {} to {}: {}",
                temp_path.display(),
                transcript_path.display(),
                e
            );
            anyhow::anyhow!("Failed to rename transcript file: {}", e)
        })?;

        info!(
            "✅ Successfully wrote transcripts.json with {} segments",
            segments_clone.len()
        );
        Ok(())
    }

    // in frontend/src-tauri/src/audio/recording_saver.rs
    pub fn get_stats(&self) -> (usize, u32) {
        if let Some(ref saver) = self.incremental_saver {
            if let Ok(guard) = saver.try_lock() {
                (guard.get_checkpoint_count() as usize, 48000)
            } else {
                (0, 48000)
            }
        } else {
            (0, 48000)
        }
    }

    /// Stop and save using incremental saving approach
    ///
    /// # Arguments
    /// * `app` - Tauri app handle for emitting events
    /// * `recording_duration` - Actual recording duration in seconds (from RecordingState)
    pub async fn stop_and_save<R: Runtime>(
        &mut self,
        app: &AppHandle<R>,
        recording_duration: Option<f64>,
    ) -> Result<Option<String>, String> {
        info!("Stopping recording saver");

        // Stop accumulation
        if let Ok(mut is_saving) = self.is_saving.lock() {
            *is_saving = false;
        }

        // Give time for final chunks
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        // Check if incremental saver exists (indicates auto_save was enabled)
        let should_save_audio = self.incremental_saver.is_some();

        if !should_save_audio {
            info!("⚠️  No audio saver initialized (auto-save was disabled) - skipping audio finalization");

            // The transcript still has to be turned into transcripts.json here.
            // This branch used to be able to just return, because
            // `add_transcript_segment` had rewritten the whole file after every
            // line; now that the per-line write is an appended log, this is the
            // only place on this path that produces the file at all.
            if let Some(folder) = &self.meeting_folder {
                if let Err(e) = self.write_transcripts_json(folder) {
                    error!("❌ Failed to write final transcripts: {}", e);
                    return Err(format!("Failed to save transcripts: {}", e));
                }
                self.discard_transcript_log(folder);
                info!("✅ Transcripts saved (audio auto-save was disabled)");
            }

            return Ok(None);
        }

        // Finalize incremental saver (merge checkpoints into final audio.mp4)
        let final_audio_path = if let Some(saver_arc) = &self.incremental_saver {
            let mut saver = saver_arc.lock().await;
            match saver.finalize().await {
                Ok(path) => {
                    info!("✅ Successfully finalized audio: {}", path.display());
                    path
                }
                Err(e) => {
                    error!("❌ Failed to finalize incremental saver: {}", e);
                    return Err(format!("Failed to finalize audio: {}", e));
                }
            }
        } else {
            error!("No incremental saver initialized - cannot save recording");
            return Err("No incremental saver initialized".to_string());
        };

        // Save final transcripts.json with validation
        if let Some(folder) = &self.meeting_folder {
            if let Err(e) = self.write_transcripts_json(folder) {
                error!("❌ Failed to write final transcripts: {}", e);
                return Err(format!("Failed to save transcripts: {}", e));
            }

            // Verify transcripts were written correctly
            let transcript_path = folder.join("transcripts.json");
            if !transcript_path.exists() {
                error!(
                    "❌ Transcript file was not created at: {}",
                    transcript_path.display()
                );
                return Err("Transcript file verification failed".to_string());
            }
            info!(
                "✅ Transcripts saved and verified at: {}",
                transcript_path.display()
            );

            // Only now, with the file on disk and checked, is the append-only
            // log redundant.
            self.discard_transcript_log(folder);
        }

        // Update metadata to completed status with actual recording duration
        if let (Some(folder), Some(mut metadata)) = (&self.meeting_folder, self.metadata.clone()) {
            metadata.status = "completed".to_string();
            metadata.completed_at = Some(chrono::Utc::now().to_rfc3339());

            // Use actual recording duration from RecordingState (more accurate than transcript segments)
            // Falls back to last transcript segment if duration not provided
            metadata.duration_seconds = recording_duration.or_else(|| {
                if let Ok(segments) = self.transcript_segments.lock() {
                    segments.last().map(|seg| seg.audio_end_time)
                } else {
                    None
                }
            });

            if let Err(e) = self.write_metadata(folder, &metadata) {
                error!("❌ Failed to update metadata to completed: {}", e);
                return Err(format!("Failed to update metadata: {}", e));
            }

            info!(
                "✅ Metadata updated with duration: {:?}s",
                metadata.duration_seconds
            );
        }

        // Emit save event with audio and transcript paths
        let save_event = serde_json::json!({
            "audio_file": final_audio_path.to_string_lossy(),
            "transcript_file": self.meeting_folder.as_ref()
                .map(|f| f.join("transcripts.json").to_string_lossy().to_string()),
            "meeting_name": self.meeting_name,
            "meeting_folder": self.meeting_folder.as_ref()
                .map(|f| f.to_string_lossy().to_string())
        });

        if let Err(e) = app.emit("recording-saved", &save_event) {
            warn!("Failed to emit recording-saved event: {}", e);
        }

        // Clean up transcript segments
        if let Ok(mut segments) = self.transcript_segments.lock() {
            segments.clear();
        }

        Ok(Some(final_audio_path.to_string_lossy().to_string()))
    }

    /// Get the meeting folder path (for passing to backend)
    pub fn get_meeting_folder(&self) -> Option<&PathBuf> {
        self.meeting_folder.as_ref()
    }

    /// Get accumulated transcript segments (for reload sync)
    pub fn get_transcript_segments(&self) -> Vec<TranscriptSegment> {
        if let Ok(segments) = self.transcript_segments.lock() {
            segments.clone()
        } else {
            Vec::new()
        }
    }

    /// Get meeting name (for reload sync)
    pub fn get_meeting_name(&self) -> Option<String> {
        self.meeting_name.clone()
    }
}

impl Default for RecordingSaver {
    fn default() -> Self {
        Self::new()
    }
}

/// What a transcript line costs while the recording is still running.
///
/// The defect these guard against: `add_transcript_segment` used to re-serialise
/// and re-write the whole of `transcripts.json` on every line, so the thousandth
/// line of a meeting cost a thousand lines' worth of writing. The fix is that a
/// line now costs one appended record, and `transcripts.json` is built once at
/// the end.
#[cfg(test)]
mod transcript_durability_tests {
    use super::*;

    fn saver_in(folder: &std::path::Path) -> RecordingSaver {
        let mut saver = RecordingSaver::new();
        saver.meeting_folder = Some(folder.to_path_buf());
        saver
    }

    fn segment(sequence_id: u64, text: &str) -> TranscriptSegment {
        TranscriptSegment {
            id: format!("seg_{}", sequence_id),
            text: text.to_string(),
            audio_start_time: sequence_id as f64,
            audio_end_time: sequence_id as f64 + 1.0,
            duration: 1.0,
            display_time: "00:00:00".to_string(),
            confidence: 0.9,
            sequence_id,
            speaker: None,
            voice_profile_id: None,
        }
    }

    /// Read the log back the way a recovery would: one JSON object per line.
    fn log_lines(folder: &std::path::Path) -> Vec<TranscriptSegment> {
        let raw = std::fs::read_to_string(folder.join(TRANSCRIPT_LOG_FILENAME))
            .expect("transcript log missing");
        raw.lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| serde_json::from_str(l).expect("a log line did not parse"))
            .collect()
    }

    /// Every accepted line lands on disk immediately, in order.
    #[test]
    fn each_line_is_appended_to_the_log_in_order() {
        let dir = tempfile::tempdir().unwrap();
        let saver = saver_in(dir.path());

        saver.add_transcript_segment(segment(0, "prima riga"));
        saver.add_transcript_segment(segment(1, "seconda riga"));
        saver.add_transcript_segment(segment(2, "terza riga"));

        let logged = log_lines(dir.path());
        let texts: Vec<&str> = logged.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(texts, vec!["prima riga", "seconda riga", "terza riga"]);
    }

    /// The regression guard: adding lines must NOT produce `transcripts.json`.
    ///
    /// If this fails, the whole-file write has crept back into the per-line
    /// path and the cost of a line is proportional to the meeting again.
    #[test]
    fn adding_lines_does_not_write_the_whole_transcript_file() {
        let dir = tempfile::tempdir().unwrap();
        let saver = saver_in(dir.path());

        for i in 0..20 {
            saver.add_transcript_segment(segment(i, "una riga qualunque"));
        }

        assert!(
            !dir.path().join("transcripts.json").exists(),
            "transcripts.json was written during recording; the per-line cost \
             is proportional to the meeting again"
        );
        assert_eq!(log_lines(dir.path()).len(), 20);
    }

    /// An update to an already-recorded line appends rather than rewriting, so
    /// the log holds both and the *last* one is current. Pins the rule anyone
    /// reading a leftover log has to apply.
    #[test]
    fn updating_a_line_appends_a_second_record_and_the_last_one_wins() {
        let dir = tempfile::tempdir().unwrap();
        let saver = saver_in(dir.path());

        saver.add_transcript_segment(segment(7, "prima versione"));
        saver.add_transcript_segment(segment(7, "versione corretta"));

        let logged = log_lines(dir.path());
        assert_eq!(logged.len(), 2, "the update should have been appended");
        assert_eq!(logged.last().unwrap().text, "versione corretta");

        // In memory there is still only one segment: the log is append-only,
        // the transcript itself is not.
        let segments = saver.get_transcript_segments();
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].text, "versione corretta");
    }

    /// The log is removed once the real file exists, so a leftover log is a
    /// meaningful signal rather than routine debris.
    #[test]
    fn the_log_is_discarded_once_the_transcript_file_is_written() {
        let dir = tempfile::tempdir().unwrap();
        let saver = saver_in(dir.path());

        saver.add_transcript_segment(segment(0, "una riga"));
        assert!(dir.path().join(TRANSCRIPT_LOG_FILENAME).exists());

        saver
            .write_transcripts_json(&dir.path().to_path_buf())
            .expect("writing transcripts.json failed");
        saver.discard_transcript_log(&dir.path().to_path_buf());

        assert!(dir.path().join("transcripts.json").exists());
        assert!(
            !dir.path().join(TRANSCRIPT_LOG_FILENAME).exists(),
            "the log outlived the file that replaced it"
        );
    }

    /// Discarding a log that was never created is normal, not a failure: a
    /// meeting where nobody spoke has no log.
    #[test]
    fn discarding_an_absent_log_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let saver = saver_in(dir.path());

        saver.discard_transcript_log(&dir.path().to_path_buf());
    }

    /// A transcript that has never had a folder assigned must not panic — the
    /// lines are still held in memory.
    #[test]
    fn a_saver_with_no_folder_keeps_lines_in_memory_without_writing() {
        let saver = RecordingSaver::new();

        saver.add_transcript_segment(segment(0, "nessuna cartella"));

        assert_eq!(saver.get_transcript_segments().len(), 1);
    }
}

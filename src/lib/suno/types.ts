/**
 * Normalised types for the Suno music-generation output.
 *
 * These types are shared by:
 *   - The Zod validation schemas  (schema.ts)
 *   - The local storage module    (storage.ts)
 *   - The Suno adapter            (worker/adapters/suno.ts)
 *   - The workflow engine         (suno_generate stage)
 *   - The dashboard UI            (run detail views)
 */

// ─── Generation input ─────────────────────────────────────────────────────────

/**
 * All context passed to the Suno adapter from the workflow engine.
 * Derived from ChatGPT lyrics-correction output + Project fields.
 */
export interface SunoGenerationInput {
  /** Corrected lyrics ready for Suno — section-tagged, no pronunciation annotations */
  suno_ready_lyrics: string;
  /** Suno style descriptor — genre, instruments, BPM, vocal style */
  suno_style_prompt: string;
  /** Song title used in the Suno UI */
  song_title: string;
  /**
   * When true, the adapter will skip waiting for audio downloads and return
   * whatever candidates are visible. Used when automation partially fails
   * (e.g. download buttons are not found) to preserve other outputs.
   */
  fallback_mode?: boolean;
}

// ─── Request payload ──────────────────────────────────────────────────────────

/** Exact values submitted to Suno — persisted for traceability. */
export interface SunoRequestPayload {
  lyrics: string;
  style_prompt: string;
  title: string;
  submitted_at: number;
}

// ─── Candidate ────────────────────────────────────────────────────────────────

export type CandidateLabel = 'A' | 'B';

export interface SunoCandidate {
  /** 'A' or 'B' — position in the results grid */
  label: CandidateLabel;
  /** Title as shown in the Suno UI */
  song_title: string;
  /** Raw duration string from the UI — e.g. "3:42". Null if not visible. */
  duration_raw: string | null;
  /** Parsed duration in seconds. Null if not visible or parseable. */
  duration_seconds: number | null;
  /** The style prompt that was used for generation */
  style_prompt: string;
  /** Suno internal song ID — extracted from the card URL/data attribute if available */
  song_id: string | null;
  /** Absolute path to the downloaded audio file on disk. Null if download failed. */
  audio_path: string | null;
  /** Absolute path to a cropped thumbnail screenshot of this candidate card */
  thumbnail_path: string | null;
  /** Whether the audio was successfully downloaded */
  downloaded: boolean;
}

// ─── Generation result ────────────────────────────────────────────────────────

export interface SunoGenerationResult {
  candidate_a: SunoCandidate;
  candidate_b: SunoCandidate;
  /** The payload that was submitted to Suno */
  request_payload: SunoRequestPayload;
  /** Unix ms timestamp when generation completed */
  generated_at: number;
  /** Final page URL (may contain the song IDs) */
  page_url: string;
  /** Non-critical issues encountered during generation */
  warnings: string[];
}

// ─── Stored run ───────────────────────────────────────────────────────────────

/**
 * Paths to all artifacts saved for a Suno run.
 * Written alongside `suno_metadata.json` in the run directory.
 */
export interface SunoStoredRun {
  /** Directory where all artifacts are written */
  run_dir: string;
  /** Path to the full metadata JSON file */
  metadata_path: string;
  /** Path to the request payload JSON file */
  request_payload_path: string;
  /** Path to candidate A audio file (null if not downloaded) */
  candidate_a_audio: string | null;
  /** Path to candidate B audio file (null if not downloaded) */
  candidate_b_audio: string | null;
  /** Path to candidate A card thumbnail */
  candidate_a_thumbnail: string | null;
  /** Path to candidate B card thumbnail */
  candidate_b_thumbnail: string | null;
  /** Full-page screenshot showing both candidates */
  candidates_screenshot: string | null;
}

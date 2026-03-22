/**
 * Types for the Grok video generation module.
 *
 * Shared by:
 *   - Zod schemas              (schema.ts)
 *   - Per-scene storage        (storage.ts)
 *   - The Grok adapter         (worker/adapters/grok.ts)
 *   - The workflow engine      (grok_generate_scenes stage)
 */

// ─── Settings ─────────────────────────────────────────────────────────────────

/** Grok-supported clip durations (seconds). Nearest value is chosen at runtime. */
export type GrokDuration = 5 | 10 | 15 | 20;

/** Video aspect ratios supported by Grok. */
export type GrokAspectRatio = '9:16' | '16:9' | '1:1';

/** Grok video resolution options. */
export type GrokResolution = '480p' | '720p' | '1080p';

/**
 * The exact parameters submitted to Grok for one scene clip.
 * Persisted to `request_settings.json` for traceability.
 */
export interface GrokRequestSettings {
  /** Duration in seconds — snapped to nearest GrokDuration */
  duration_seconds: GrokDuration;
  aspect_ratio: GrokAspectRatio;
  /** Number of variations requested (1–4) */
  variations: number;
  resolution: GrokResolution;
}

// ─── Generation lifecycle ─────────────────────────────────────────────────────

export type GrokGenerationStatus =
  | 'pending'     // not yet submitted
  | 'queued'      // submitted, waiting in Grok queue
  | 'generating'  // actively being processed
  | 'complete'    // finished and downloaded
  | 'failed';     // error during submission or download

// ─── Per-scene input ──────────────────────────────────────────────────────────

/**
 * Minimal per-scene input read from the prompt refinement manifest.
 */
export interface GrokSceneRequest {
  scene_number: number;
  grok_prompt: string;
  duration_target: number;           // Raw target — snapped to GrokDuration
  aspect_ratio: GrokAspectRatio;
  section: string;                   // For logging / manifest only
}

// ─── Per-scene result ─────────────────────────────────────────────────────────

export interface GrokSceneResult {
  scene_number: number;
  status: GrokGenerationStatus;
  grok_prompt: string;
  settings: GrokRequestSettings;
  /** Absolute path to the downloaded .mp4 file; null if download failed. */
  video_path: string | null;
  /** Direct video URL captured from the page (fallback when download failed). */
  video_url: string | null;
  /** Grok internal generation ID extracted from the page, if available. */
  generation_id: string | null;
  /** Unix-ms when the generation was submitted. */
  submitted_at: number;
  /** Unix-ms when the clip was confirmed complete and downloaded. */
  completed_at: number | null;
  /** Wall-clock generation duration in ms. */
  duration_ms: number | null;
  /** Error message if status is 'failed'. */
  error: string | null;
  /** Path to a screenshot taken after this scene (success or failure). */
  screenshot_path: string | null;
  /** Path to an HTML dump taken on failure. */
  failure_html_path: string | null;
}

// ─── Run manifest ─────────────────────────────────────────────────────────────

/**
 * Written to `generation_manifest.json` in the video output directory.
 */
export interface GrokGenerationRun {
  total_scenes: number;
  successful_scenes: number;
  failed_scenes: number;
  scenes: GrokSceneResult[];
  created_at: string;
  run_dir: string;
}

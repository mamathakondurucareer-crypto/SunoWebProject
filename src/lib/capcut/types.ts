/**
 * Types for the CapCut handoff packaging module.
 *
 * This module produces a local folder of assets + documents that a human
 * editor (or future automation) can import directly into CapCut Desktop.
 *
 * Outputs produced per run:
 *   clips_manifest.json    — ordered clip list with timing + editorial notes
 *   timeline.json          — multi-track timeline (video / audio / subtitles)
 *   subtitles.srt          — SRT subtitle file derived from lyrics + scene timing
 *   edit_manifest.md       — full human-readable editorial guide
 *   capcut_package_manifest.json  — top-level run summary
 *
 * Shared by:
 *   - builder.ts            (package generator)
 *   - schema.ts             (Zod schemas + validation rules)
 *   - storage.ts            (artifact write/read)
 *   - worker/adapters/capcut.ts  (stage adapter)
 */

import type { MusicalSection, EnergyLevel } from '@/lib/scene-plan/types';
import type { GrokSceneResult } from '@/lib/grok/types';
import type { SceneSegment, SceneManifest } from '@/lib/scene-plan/types';

// Re-export for consumers who only import from capcut
export type { MusicalSection, EnergyLevel, SceneSegment, SceneManifest, GrokSceneResult };

// ─── Request ──────────────────────────────────────────────────────────────────

/**
 * All project-level inputs needed to build a CapCut handoff package.
 * Assembled by the stage adapter from prior stage outputs.
 */
export interface CapCutPackageRequest {
  song_title: string;
  devotional_theme: string;
  /** Absolute path to the winning audio file; null if unavailable. */
  winner_audio_path: string | null;
  audio_duration_seconds: number;
  /** Raw lyrics string with [Section] markers, e.g. "[Verse 1]\nline...\n[Chorus]\n..." */
  lyrics: string;
  /** Timed scene segments from the scene planning stage. */
  scenes: SceneSegment[];
  /** Grok generation results, one per scene (may be partial if some failed). */
  grok_results: GrokSceneResult[];
  /**
   * Significant moments where extra emphasis, cut, or overlay is warranted.
   * If empty, the builder auto-detects from energy + section labels.
   */
  hook_moments: HookMoment[];
  /**
   * Explicit windows to extract for Shorts / Reels.
   * If empty, the builder auto-selects the best 45-second chorus window.
   */
  shorts_windows: ShortsExtractionWindow[];
  /** Primary edit aspect ratio — 16:9 for YouTube, 9:16 for Shorts-first. */
  target_aspect_ratio: '16:9' | '9:16';
  fps: 24 | 25 | 30;
  resolution: { width: number; height: number };
}

// ─── Hook Moments ─────────────────────────────────────────────────────────────

export type HookEmphasisType =
  | 'beat_drop'
  | 'chorus_entry'
  | 'lyric_punch'
  | 'visual_climax'
  | 'outro_fade';

/**
 * A specific timestamp with high emotional or rhythmic impact.
 * Used to place beat-matched cuts, zooms, or lyric overlays.
 */
export interface HookMoment {
  /** Seconds from start of audio */
  timestamp_sec: number;
  description: string;
  /** Optional lyric line at this moment */
  lyric_line?: string;
  emphasis_type: HookEmphasisType;
}

// ─── Shorts / Reels Extraction ────────────────────────────────────────────────

export type ShortsPlatform = 'YouTube Shorts' | 'Instagram Reels' | 'TikTok';

/**
 * A contiguous time window (≤ 60 s) suitable for a vertical short-form cut.
 * The editor reframes to 9:16 within this window.
 */
export interface ShortsExtractionWindow {
  start_sec: number;
  end_sec: number;
  /** Human-readable rationale, e.g. "chorus hook + visual climax" */
  rationale: string;
  platform: ShortsPlatform;
  /**
   * Crop / reframe guidance for the vertical format.
   * e.g. "Keep subject centered; crop left/right edges evenly"
   */
  reframe_note: string;
}

// ─── Clip Manifest ────────────────────────────────────────────────────────────

/**
 * One entry in the ordered clip manifest.
 * Corresponds 1-to-1 with a SceneSegment plus enriched editorial data.
 */
export interface CapCutClipEntry {
  scene_number: number;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  section: MusicalSection;
  lyric_excerpt: string;
  energy: EnergyLevel;

  /** Absolute path to the Grok-generated video clip; null if generation failed. */
  clip_path: string | null;
  clip_available: boolean;

  /** The Grok prompt used to generate this clip. */
  grok_prompt: string;

  /**
   * CapCut motion instruction for this clip, e.g. "slow push-in, 0.5× speed ramp".
   * Sourced from scene_plan.capcut_motion.
   */
  motion_note: string;

  /**
   * Recommended transition *entering* this clip from the previous one.
   * e.g. "dissolve 0.5s", "hard cut", "wipe-right 0.3s"
   */
  transition_in: string;

  /**
   * Recommended transition *exiting* this clip to the next one.
   * Same vocabulary as transition_in.
   */
  transition_out: string;

  /** True if this scene overlaps with a HookMoment. */
  is_hook_moment: boolean;
  hook_note?: string;

  /**
   * Optional lyric overlay to burn onto this clip.
   * Only populated when the lyric_excerpt is short enough to display.
   */
  lyric_overlay?: {
    text: string;
    position: 'top' | 'center' | 'bottom';
    /** Visual style hint for the designer. */
    style: 'title' | 'subtitle' | 'caption';
  };
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

export interface VideoTrackEntry {
  /** e.g. "v001" */
  clip_id: string;
  scene_number: number;
  /** In-point within the source clip (seconds, usually 0). */
  in_point: number;
  /** Out-point within the source clip (seconds, = clip duration). */
  out_point: number;
  /** Position on the master timeline (seconds). */
  timeline_start: number;
  timeline_end: number;
  clip_path: string | null;
}

export interface AudioTrackEntry {
  clip_id: string;
  audio_path: string | null;
  in_point: number;
  out_point: number;
  timeline_start: number;
  timeline_end: number;
  /** 0–100; default 100 */
  volume: number;
}

export interface SubtitleTrackEntry {
  /** 1-based index for SRT compatibility */
  index: number;
  start_sec: number;
  end_sec: number;
  text: string;
  position: 'top' | 'center' | 'bottom';
}

/**
 * Multi-track CapCut timeline descriptor.
 * Written to `timeline.json`; intended as a human-readable guide and
 * a starting point for future CapCut API / draft automation.
 */
export interface CapCutTimeline {
  project_name: string;
  fps: number;
  resolution: { width: number; height: number };
  duration_sec: number;
  video_track: VideoTrackEntry[];
  audio_track: AudioTrackEntry[];
  subtitle_track: SubtitleTrackEntry[];
}

// ─── SRT ──────────────────────────────────────────────────────────────────────

/** A single SRT subtitle entry (before rendering to text). */
export interface SrtEntry {
  index: number;
  start_sec: number;
  end_sec: number;
  text: string;
}

// ─── Package Run ─────────────────────────────────────────────────────────────

/**
 * Written to `capcut_package_manifest.json`.
 * Top-level summary of the completed handoff package.
 */
export interface CapCutPackageRun {
  run_dir: string;
  /** Absolute path to the `capcut_package/` directory. */
  package_dir: string;
  manifest_path: string;
  clips_manifest_path: string;
  timeline_path: string;
  subtitles_path: string;
  edit_manifest_path: string;
  total_scenes: number;
  clips_available: number;
  clips_missing: number;
  has_audio: boolean;
  shorts_windows: ShortsExtractionWindow[];
  created_at: string;
}

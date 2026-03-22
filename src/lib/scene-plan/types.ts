/**
 * Types for the dynamic scene planning module.
 *
 * Scene counts are derived from actual audio duration (~10s per scene)
 * and musical section boundaries — never hardcoded.
 */

export type MusicalSection =
  | 'intro'
  | 'verse'
  | 'pre_chorus'
  | 'chorus'
  | 'bridge'
  | 'final_chorus'
  | 'outro'
  | 'unknown';

export type EnergyLevel = 'low' | 'medium' | 'high';

/** One scene segment in the timed manifest */
export interface SceneSegment {
  scene_number: number;
  start_sec: number;
  end_sec: number;
  section: MusicalSection;
  lyric_excerpt: string;
  energy: EnergyLevel;
  visual_goal: string;
  grok_text_to_video_prompt_seed: string;
  capcut_motion: string;
  crop_notes: string;
  negative_prompt: string;
}

/** A parsed lyric section (before timing is assigned) */
export interface LyricSection {
  section: MusicalSection;
  raw_label: string;     // original text inside brackets, e.g. "Verse 1"
  lines: string[];       // non-empty lyric lines (no bracketed headers)
}

/** All inputs required to build a scene plan */
export interface ScenePlanInput {
  audio_duration_seconds: number;
  song_title: string;
  lyrics: string;            // raw lyrics with [Section] markers
  style_prompt: string;
  devotional_theme: string;
  winner_label: 'A' | 'B';
  winner_audio_path: string | null;
  /** Optional per-dimension scores from ChatGPT evaluation (used for energy hints) */
  winner_analysis?: {
    hook_strength_score: number;
    chorus_impact_score: number;
    viral_proxy_score: number;
  };
}

/** Full output artifact written to timed_scene_manifest.json */
export interface SceneManifest {
  song_title: string;
  winner_label: 'A' | 'B';
  winner_audio_path: string | null;
  audio_duration_seconds: number;
  total_scenes: number;
  created_at: string;
  scenes: SceneSegment[];
}

/**
 * Types for the ChatGPT prompt refinement module.
 *
 * Transforms raw grok_text_to_video_prompt_seed fields from the timed scene manifest into
 * fully-specified, cinematic, public-safe Grok generation prompts — one per scene.
 */

import type { MusicalSection } from '@/lib/scene-plan/types';

// ─── Visual Style Guide ───────────────────────────────────────────────────────

/**
 * Project-level visual style guide applied to every scene.
 * Provides ChatGPT with consistent aesthetic constraints across the full video.
 */
export interface VisualStyleGuide {
  /** Imagery that is always safe/encouraged, e.g. "temple pillars", "oil lamps" */
  safe_motifs: string[];
  /** Imagery to exclude from every scene, e.g. "violence", "commercial logos" */
  forbidden_imagery: string[];
  /** Color palette description, e.g. "warm saffron, gold, deep red, off-white" */
  color_palette: string;
  /** Lighting style, e.g. "soft natural light, golden hour, candlelight" */
  lighting_style: string;
  /** Target aspect ratio for all clips */
  aspect_ratio: '9:16' | '16:9' | '1:1';
  /**
   * Safe zone for text/caption overlays.
   * e.g. "center 80%; avoid top/bottom 10% for mobile caption bars"
   */
  crop_safe_zone: string;
}

// ─── Continuity Notes ─────────────────────────────────────────────────────────

/**
 * Rules that govern how one scene connects to the next.
 * Passed to ChatGPT so it can author a coherent multi-scene narrative.
 */
export interface ContinuityNotes {
  /** e.g. "warm sepia-tinted with golden highlights throughout" */
  color_grading: string;
  /** e.g. "dissolve or cross-fade; avoid hard cuts in the chorus" */
  transition_style: string;
  /** e.g. "push-in for emotional intensity, pull-out for resolution" */
  camera_movement_grammar: string;
  /** e.g. "match musical phrase boundaries, ~8–12 seconds per scene" */
  pacing: string;
  /** How the video opens (anchors the first scene) */
  opening_anchor: string;
  /** How the video closes (anchors the last scene) */
  closing_anchor: string;
}

// ─── Per-Scene Input ──────────────────────────────────────────────────────────

/** Compact scene descriptor passed to the prompt builder */
export interface SceneInputRow {
  scene_number: number;
  start_sec: number;
  end_sec: number;
  section: MusicalSection;
  lyric_excerpt: string;
  energy: 'low' | 'medium' | 'high';
  grok_text_to_video_prompt_seed: string;
  capcut_motion: string;
  crop_notes: string;
  negative_prompt: string;
}

// ─── Refinement Input ─────────────────────────────────────────────────────────

/** All inputs needed to build the ChatGPT refinement prompt */
export interface PromptRefinementInput {
  song_title: string;
  devotional_theme: string;
  /** e.g. "devotional, warm, uplifting; Bhairavi raag, 80 BPM" */
  audio_mood: string;
  scenes: SceneInputRow[];
  visual_bible: VisualStyleGuide;
  continuity_notes: ContinuityNotes;
}

// ─── Refined Per-Scene Prompt ─────────────────────────────────────────────────

/** One fully-specified, Grok-ready prompt for a single scene */
export interface RefinedScenePrompt {
  scene_number: number;
  section: MusicalSection;
  start_sec: number;
  end_sec: number;
  /** Clip duration in seconds (may be rounded for Grok generation) */
  duration_target: number;
  /** Aspect ratio for this clip */
  aspect_ratio: '9:16' | '16:9' | '1:1';
  /** Final Grok-ready cinematic prompt (2–4 sentences) */
  grok_prompt: string;
  /** How this scene visually connects to the scene before/after */
  continuity_note: string;
  /** The single most important visual element to foreground */
  visual_emphasis: string;
  /** Explicit "do not include" constraints for Grok */
  negative_constraints: string[];
  /**
   * Brief note confirming the prompt uses public-safe wording
   * (no violence, no CSAM, no restricted characters, no copyrighted marks).
   */
  public_safe_wording: string;
}



// ─── Run Manifest ─────────────────────────────────────────────────────────────

/** Stored artifact manifest for a completed refinement run */
export interface PromptRefinementRun {
  run_dir: string;
  /** Absolute path to prompt_refinement_manifest.json */
  manifest_path: string;
  /** Absolute paths to grok_prompts/scene_NNN.json, in scene order */
  scene_prompt_paths: string[];
  total_scenes: number;
  chatgpt_screenshot: string | null;
}

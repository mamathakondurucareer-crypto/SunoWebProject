/**
 * Zod schemas and validation rule sets for the CapCut handoff module.
 *
 * CRITICAL_CAPCUT_RULES  → failure stops the workflow; error is set
 * WARN_CAPCUT_RULES      → non-fatal; warnings surface in output
 */

import { z } from 'zod';
import type { CapCutPackageRun } from './types';

// ─── Leaf schemas ─────────────────────────────────────────────────────────────

export const MusicalSectionSchema = z.enum([
  'intro', 'verse', 'pre_chorus', 'chorus',
  'bridge', 'final_chorus', 'outro', 'unknown',
]);

export const EnergyLevelSchema = z.enum(['low', 'medium', 'high']);

export const HookEmphasisTypeSchema = z.enum([
  'beat_drop', 'chorus_entry', 'lyric_punch', 'visual_climax', 'outro_fade',
]);

export const ShortsPlatformSchema = z.enum([
  'YouTube Shorts', 'Instagram Reels', 'TikTok',
]);

// ─── Hook / Shorts schemas ────────────────────────────────────────────────────

export const HookMomentSchema = z.object({
  timestamp_sec:  z.number().min(0),
  description:    z.string().min(1),
  lyric_line:     z.string().optional(),
  emphasis_type:  HookEmphasisTypeSchema,
});

export const ShortsExtractionWindowSchema = z.object({
  start_sec:    z.number().min(0),
  end_sec:      z.number().min(0),
  rationale:    z.string().min(1),
  platform:     ShortsPlatformSchema,
  reframe_note: z.string(),
});

// ─── Clip entry schema ────────────────────────────────────────────────────────

const LyricOverlaySchema = z.object({
  text:     z.string(),
  position: z.enum(['top', 'center', 'bottom']),
  style:    z.enum(['title', 'subtitle', 'caption']),
});

export const CapCutClipEntrySchema = z.object({
  scene_number:    z.number().int().min(1),
  start_sec:       z.number().min(0),
  end_sec:         z.number().min(0),
  duration_sec:    z.number().positive(),
  section:         MusicalSectionSchema,
  lyric_excerpt:   z.string(),
  energy:          EnergyLevelSchema,
  clip_path:       z.string().nullable(),
  clip_available:  z.boolean(),
  grok_prompt:     z.string(),
  motion_note:     z.string(),
  transition_in:   z.string(),
  transition_out:  z.string(),
  is_hook_moment:  z.boolean(),
  hook_note:       z.string().optional(),
  lyric_overlay:   LyricOverlaySchema.optional(),
});

// ─── Timeline schemas ─────────────────────────────────────────────────────────

export const VideoTrackEntrySchema = z.object({
  clip_id:        z.string(),
  scene_number:   z.number().int().min(1),
  in_point:       z.number().min(0),
  out_point:      z.number().min(0),
  timeline_start: z.number().min(0),
  timeline_end:   z.number().min(0),
  clip_path:      z.string().nullable(),
});

export const AudioTrackEntrySchema = z.object({
  clip_id:        z.string(),
  audio_path:     z.string().nullable(),
  in_point:       z.number().min(0),
  out_point:      z.number().min(0),
  timeline_start: z.number().min(0),
  timeline_end:   z.number().min(0),
  volume:         z.number().min(0).max(100),
});

export const SubtitleTrackEntrySchema = z.object({
  index:      z.number().int().min(1),
  start_sec:  z.number().min(0),
  end_sec:    z.number().min(0),
  text:       z.string(),
  position:   z.enum(['top', 'center', 'bottom']),
});

export const CapCutTimelineSchema = z.object({
  project_name:   z.string(),
  fps:            z.union([z.literal(24), z.literal(25), z.literal(30)]),
  resolution:     z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  duration_sec:   z.number().positive(),
  video_track:    z.array(VideoTrackEntrySchema),
  audio_track:    z.array(AudioTrackEntrySchema),
  subtitle_track: z.array(SubtitleTrackEntrySchema),
});

// ─── Package request schema ───────────────────────────────────────────────────

export const CapCutPackageRequestSchema = z.object({
  song_title:            z.string().min(1),
  devotional_theme:      z.string().min(1),
  winner_audio_path:     z.string().nullable(),
  audio_duration_seconds: z.number().positive(),
  lyrics:                z.string(),
  scenes:                z.array(z.object({
    scene_number:     z.number().int().min(1),
    start_sec:        z.number().min(0),
    end_sec:          z.number().min(0),
    section:          MusicalSectionSchema,
    lyric_excerpt:    z.string(),
    energy:           EnergyLevelSchema,
    visual_goal:      z.string(),
    grok_text_to_video_prompt_seed: z.string(),
    capcut_motion:    z.string(),
    crop_notes:       z.string(),
    negative_prompt:  z.string(),
  })).min(1),
  grok_results:          z.array(z.unknown()),
  hook_moments:          z.array(HookMomentSchema),
  shorts_windows:        z.array(ShortsExtractionWindowSchema),
  target_aspect_ratio:   z.enum(['16:9', '9:16']),
  fps:                   z.union([z.literal(24), z.literal(25), z.literal(30)]),
  resolution:            z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
});

// ─── Run manifest schema ──────────────────────────────────────────────────────

export const CapCutPackageRunSchema = z.object({
  run_dir:              z.string(),
  package_dir:          z.string(),
  manifest_path:        z.string(),
  clips_manifest_path:  z.string(),
  timeline_path:        z.string(),
  subtitles_path:       z.string(),
  edit_manifest_path:   z.string(),
  total_scenes:         z.number().int().min(0),
  clips_available:      z.number().int().min(0),
  clips_missing:        z.number().int().min(0),
  has_audio:            z.boolean(),
  shorts_windows:       z.array(ShortsExtractionWindowSchema),
  created_at:           z.string(),
});

// ─── Validation rule types ────────────────────────────────────────────────────

export interface CriticalCapCutRule {
  field: string;
  check: (run: CapCutPackageRun) => boolean;
  message: (run: CapCutPackageRun) => string;
}

export interface WarnCapCutRule {
  field: string;
  check: (run: CapCutPackageRun) => boolean;
  message: (run: CapCutPackageRun) => string;
}

// ─── Critical rules ───────────────────────────────────────────────────────────

export const CRITICAL_CAPCUT_RULES: CriticalCapCutRule[] = [
  {
    field: 'has_clips_manifest',
    check: (r) => r.clips_manifest_path.length > 0,
    message: () => 'clips_manifest.json path is empty — package write failed',
  },
  {
    field: 'has_timeline',
    check: (r) => r.timeline_path.length > 0,
    message: () => 'timeline.json path is empty — timeline build failed',
  },
  {
    field: 'has_edit_manifest',
    check: (r) => r.edit_manifest_path.length > 0,
    message: () => 'edit_manifest.md path is empty — editorial guide write failed',
  },
];

// ─── Warn rules ───────────────────────────────────────────────────────────────

export const WARN_CAPCUT_RULES: WarnCapCutRule[] = [
  {
    field: 'has_audio',
    check: (r) => r.has_audio,
    message: () => 'No audio file found in package — editor will need to source audio manually',
  },
  {
    field: 'clips_coverage',
    check: (r) => r.total_scenes > 0 && r.clips_available / r.total_scenes >= 0.5,
    message: (r) =>
      `Only ${r.clips_available}/${r.total_scenes} scene clips available — more than half are missing`,
  },
  {
    field: 'has_shorts_window',
    check: (r) => r.shorts_windows.length > 0,
    message: () => 'No Shorts/Reels extraction windows defined — shorts cut will need to be identified manually',
  },
  {
    field: 'has_subtitles',
    check: (r) => r.subtitles_path.length > 0,
    message: () => 'subtitles.srt path is empty — subtitle file was not generated',
  },
];

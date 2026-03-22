import { z } from 'zod';

const MusicalSectionSchema = z.enum([
  'intro', 'verse', 'pre_chorus', 'chorus',
  'bridge', 'final_chorus', 'outro', 'unknown',
]);

const EnergyLevelSchema = z.enum(['low', 'medium', 'high']);

export const SceneSegmentSchema = z.object({
  scene_number:     z.number().int().min(1),
  start_sec:        z.number().min(0),
  end_sec:          z.number().min(0),
  section:          MusicalSectionSchema,
  lyric_excerpt:    z.string(),
  energy:           EnergyLevelSchema,
  visual_goal:      z.string().min(1),
  grok_text_to_video_prompt_seed: z.string().min(1),
  capcut_motion:    z.string().min(1),
  crop_notes:       z.string(),
  negative_prompt:  z.string(),
});

export const SceneManifestSchema = z.object({
  song_title:              z.string(),
  winner_label:            z.enum(['A', 'B']),
  winner_audio_path:       z.string().nullable(),
  audio_duration_seconds:  z.number().positive(),
  total_scenes:            z.number().int().min(1),
  created_at:              z.string(),
  scenes:                  z.array(SceneSegmentSchema).min(1),
});

export const ScenePlanInputSchema = z.object({
  audio_duration_seconds: z.number().positive(),
  song_title:             z.string(),
  lyrics:                 z.string(),
  style_prompt:           z.string(),
  devotional_theme:       z.string(),
  winner_label:           z.enum(['A', 'B']),
  winner_audio_path:      z.string().nullable(),
  winner_analysis: z.object({
    hook_strength_score:  z.number().min(1).max(10),
    chorus_impact_score:  z.number().min(1).max(10),
    viral_proxy_score:    z.number().min(1).max(10),
  }).optional(),
});

/** Validation rules applied after building a manifest */
export const CRITICAL_MANIFEST_RULES = {
  has_scenes:         (m: z.infer<typeof SceneManifestSchema>) => m.scenes.length > 0,
  total_matches_count:(m: z.infer<typeof SceneManifestSchema>) => m.total_scenes === m.scenes.length,
  no_time_gaps:       (m: z.infer<typeof SceneManifestSchema>) => {
    for (let i = 1; i < m.scenes.length; i++) {
      const gap = m.scenes[i]!.start_sec - m.scenes[i - 1]!.end_sec;
      if (Math.abs(gap) > 0.01) return false;
    }
    return true;
  },
  last_scene_ends_at_duration: (m: z.infer<typeof SceneManifestSchema>) => {
    const last = m.scenes[m.scenes.length - 1];
    return last !== undefined && Math.abs(last.end_sec - m.audio_duration_seconds) < 0.01;
  },
};

import { z } from 'zod';

const AspectRatioSchema = z.enum(['9:16', '16:9', '1:1']);

const MusicalSectionSchema = z.enum([
  'intro', 'verse', 'pre_chorus', 'chorus',
  'bridge', 'final_chorus', 'outro', 'unknown',
]);

export const VisualStyleGuideSchema = z.object({
  safe_motifs:       z.array(z.string()).min(1),
  forbidden_imagery: z.array(z.string()),
  color_palette:     z.string().min(1),
  lighting_style:    z.string().min(1),
  aspect_ratio:      AspectRatioSchema,
  crop_safe_zone:    z.string(),
});

export const ContinuityNotesSchema = z.object({
  color_grading:            z.string().min(1),
  transition_style:         z.string().min(1),
  camera_movement_grammar:  z.string().min(1),
  pacing:                   z.string().min(1),
  opening_anchor:           z.string().min(1),
  closing_anchor:           z.string().min(1),
});

export const RefinedScenePromptSchema = z.object({
  scene_number:        z.number().int().min(1),
  section:             MusicalSectionSchema,
  start_sec:           z.number().min(0),
  end_sec:             z.number().min(0),
  duration_target:     z.number().positive(),
  aspect_ratio:        AspectRatioSchema,
  grok_prompt:         z.string().min(20),
  continuity_note:     z.string().min(5),
  visual_emphasis:     z.string().min(5),
  negative_constraints: z.array(z.string()),
  public_safe_wording: z.string().min(5),
});

export const PromptRefinementRunSchema = z.object({
  run_dir:            z.string(),
  manifest_path:      z.string(),
  scene_prompt_paths: z.array(z.string()).min(1),
  total_scenes:       z.number().int().min(1),
  chatgpt_screenshot: z.string().nullable(),
});

/** Rules that must pass for a refinement run to be considered valid */
export const CRITICAL_REFINEMENT_RULES = {
  all_scenes_present: (scenes: { scene_number: number }[], expectedCount: number) =>
    scenes.length === expectedCount,

  no_empty_grok_prompts: (scenes: { grok_prompt: string }[]) =>
    scenes.every(s => s.grok_prompt.trim().length >= 20),

  sequential_scene_numbers: (scenes: { scene_number: number }[]) =>
    scenes.every((s, i) => s.scene_number === i + 1),
};

export const WARN_REFINEMENT_RULES = {
  no_virality_claim: (scenes: { grok_prompt: string }[]) =>
    scenes.every(s => !/will go viral|guaranteed viral/i.test(s.grok_prompt)),

  public_safe_confirmed: (scenes: { public_safe_wording: string }[]) =>
    scenes.every(s => s.public_safe_wording.trim().length > 0),
};

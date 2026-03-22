/**
 * Zod schemas and validation rule sets for the Grok video generation module.
 *
 * CRITICAL_GROK_RULES  → failure stops the workflow; errors[] is populated
 * WARN_GROK_RULES      → non-fatal; warnings[] is populated but result succeeds
 */

import { z } from 'zod';
import type { GrokGenerationRun, GrokSceneResult } from './types';

// ─── Leaf schemas ─────────────────────────────────────────────────────────────

export const GrokDurationSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(15),
  z.literal(20),
]);

export const GrokAspectRatioSchema = z.enum(['9:16', '16:9', '1:1']);

export const GrokResolutionSchema = z.enum(['480p', '720p', '1080p']);

export const GrokGenerationStatusSchema = z.enum([
  'pending',
  'queued',
  'generating',
  'complete',
  'failed',
]);

export const GrokRequestSettingsSchema = z.object({
  duration_seconds: GrokDurationSchema,
  aspect_ratio: GrokAspectRatioSchema,
  variations: z.number().int().min(1).max(4),
  resolution: GrokResolutionSchema,
});

export const GrokSceneResultSchema = z.object({
  scene_number: z.number().int().positive(),
  status: GrokGenerationStatusSchema,
  grok_prompt: z.string(),
  settings: GrokRequestSettingsSchema,
  video_path: z.string().nullable(),
  video_url: z.string().nullable(),
  generation_id: z.string().nullable(),
  submitted_at: z.number().int().positive(),
  completed_at: z.number().int().positive().nullable(),
  duration_ms: z.number().nullable(),
  error: z.string().nullable(),
  screenshot_path: z.string().nullable(),
  failure_html_path: z.string().nullable(),
});

export const GrokGenerationRunSchema = z.object({
  total_scenes: z.number().int().nonnegative(),
  successful_scenes: z.number().int().nonnegative(),
  failed_scenes: z.number().int().nonnegative(),
  scenes: z.array(GrokSceneResultSchema),
  created_at: z.string(),
  run_dir: z.string(),
});

// ─── Validation rule types ────────────────────────────────────────────────────

export interface CriticalGrokRule {
  field: string;
  check: (data: GrokGenerationRun) => boolean;
  message: (data: GrokGenerationRun) => string;
}

export interface WarnGrokRule {
  field: string;
  check: (data: GrokGenerationRun) => boolean;
  message: (data: GrokGenerationRun) => string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function completeWithVideo(scene: GrokSceneResult): boolean {
  return scene.status === 'complete' && scene.video_path !== null;
}

// ─── Critical rules (result fails) ───────────────────────────────────────────

export const CRITICAL_GROK_RULES: CriticalGrokRule[] = [
  {
    field: 'has_scenes',
    check: (d) => d.scenes.length > 0,
    message: () => 'No scene results recorded — Grok generation produced no output',
  },
  {
    field: 'successful_count_positive',
    check: (d) => d.successful_scenes > 0,
    message: (d) =>
      `All ${d.total_scenes} scene(s) failed — no usable video clips were generated`,
  },
];

// ─── Warn rules (non-fatal) ───────────────────────────────────────────────────

export const WARN_GROK_RULES: WarnGrokRule[] = [
  {
    field: 'no_failed_scenes',
    check: (d) => d.failed_scenes === 0,
    message: (d) =>
      `${d.failed_scenes}/${d.total_scenes} scene(s) failed — manual re-run may be needed`,
  },
  {
    field: 'all_complete_have_video',
    check: (d) => d.scenes.filter((s) => s.status === 'complete').every(completeWithVideo),
    message: (d) => {
      const noVideo = d.scenes.filter(
        (s) => s.status === 'complete' && s.video_path === null
      ).length;
      return `${noVideo} complete scene(s) are missing a downloaded video file`;
    },
  },
  {
    field: 'all_have_generation_id',
    check: (d) => d.scenes.every((s) => s.generation_id !== null),
    message: (d) => {
      const missing = d.scenes.filter((s) => s.generation_id === null).length;
      return `${missing} scene(s) have no generation ID — traceability may be limited`;
    },
  },
];

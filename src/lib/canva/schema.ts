/**
 * Zod schemas and validation rule sets for the Canva thumbnail brief module.
 *
 * CRITICAL_CANVA_RULES  → failure stops the workflow; errors[] is populated
 * WARN_CANVA_RULES      → non-fatal; warnings[] is populated but result succeeds
 */

import { z } from 'zod';
import type { ThumbnailBriefRun, ThumbnailBrief } from './types';

// ─── Leaf schemas ─────────────────────────────────────────────────────────────

export const ThumbnailFormatSchema = z.enum([
  'desktop',
  'mobile',
  'multi_social',
  'canva_guide',
]);

export const TextWeightSchema = z.enum([
  'thin', 'regular', 'medium', 'semibold', 'bold', 'extrabold',
]);

export const TextAlignmentSchema = z.enum(['left', 'center', 'right']);

export const PositionAnchorSchema = z.enum([
  'top-left', 'top-center', 'top-right',
  'center-left', 'center', 'center-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]);

export const ExportFormatSchema = z.enum(['PNG', 'JPG', 'PDF']);

export const SocialPlatformSchema = z.enum([
  'YouTube',
  'YouTube Shorts',
  'Instagram',
  'Instagram Reels',
  'Facebook',
  'Twitter/X',
]);

// ─── Component schemas ────────────────────────────────────────────────────────

export const TextOverlaySchema = z.object({
  layer_name: z.string(),
  text: z.string(),
  font_hint: z.string(),
  weight: TextWeightSchema,
  size_hint: z.string(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a CSS hex color'),
  opacity: z.number().min(0).max(100),
  position: PositionAnchorSchema,
  alignment: TextAlignmentSchema,
  safe_zone_offset: z.object({
    top: z.number().optional(),
    bottom: z.number().optional(),
    left: z.number().optional(),
    right: z.number().optional(),
  }),
  shadow: z.string().optional(),
  stroke: z.string().optional(),
});

export const BackgroundLayerSchema = z.object({
  type: z.enum(['ai_image', 'solid_color', 'gradient', 'video_frame']),
  value: z.string(),
  opacity: z.number().min(0).max(100),
});

export const SubjectLayerSchema = z.object({
  layer_name: z.string(),
  description: z.string(),
  blend_mode: z.string(),
  opacity: z.number().min(0).max(100),
  placement_hint: z.string(),
});

export const ColorOverlaySchema = z.object({
  value: z.string(),
  opacity: z.number().min(0).max(100),
  type: z.enum(['solid', 'gradient', 'vignette']),
});

export const LayerPlanSchema = z.object({
  background: BackgroundLayerSchema,
  subject: SubjectLayerSchema.nullable(),
  color_overlay: ColorOverlaySchema.nullable(),
  text_layers: z.array(TextOverlaySchema),
  effects: z.array(z.string()),
  stacking_order: z.array(z.string()),
});

export const ThumbnailDimensionsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  label: z.string(),
});

export const ExportTargetSchema = z.object({
  filename: z.string(),
  format: ExportFormatSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  platform: SocialPlatformSchema,
  dpi: z.number().int().positive(),
});

export const ThumbnailFormatSpecSchema = z.object({
  format: ThumbnailFormatSchema,
  primary_dimensions: ThumbnailDimensionsSchema,
  aspect_ratio: z.string(),
  safe_zone_guide: z.string(),
  platforms: z.array(SocialPlatformSchema),
  export_targets: z.array(ExportTargetSchema),
});

// ─── Root brief schema ────────────────────────────────────────────────────────

export const ThumbnailBriefSchema = z.object({
  format: ThumbnailFormatSchema,
  spec: ThumbnailFormatSpecSchema,
  text_overlays: z.array(TextOverlaySchema),
  layer_plan: LayerPlanSchema,
  ai_image_prompt: z.string(),
  canva_guide_steps: z.array(z.string()),
  export_targets: z.array(ExportTargetSchema),
  created_at: z.string(),
});

// ─── Run manifest schema ──────────────────────────────────────────────────────

const NullableStringByFormatSchema = z.object({
  desktop: z.string().nullable(),
  mobile: z.string().nullable(),
  multi_social: z.string().nullable(),
  canva_guide: z.string().nullable(),
});

export const ThumbnailBriefRunSchema = z.object({
  run_dir: z.string(),
  manifest_path: z.string(),
  brief_paths: NullableStringByFormatSchema,
  guide_paths: NullableStringByFormatSchema,
  formats_generated: z.array(ThumbnailFormatSchema),
  created_at: z.string(),
});

// ─── Request schema (for runtime validation of stage input) ───────────────────

export const ThumbnailBriefRequestSchema = z.object({
  song_title: z.string().min(1),
  devotional_theme: z.string().min(1),
  audio_mood: z.string(),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  neutral_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  font_stack: z.tuple([z.string(), z.string(), z.string()]),
  background_image_hint: z.string(),
  headline_override: z.string().optional(),
  subtitle_text: z.string().optional(),
  cta_text: z.string().optional(),
  formats: z.array(ThumbnailFormatSchema).optional(),
});

// ─── Validation rule types ────────────────────────────────────────────────────

export interface CriticalCanvaRule {
  field: string;
  check: (data: ThumbnailBriefRun) => boolean;
  message: (data: ThumbnailBriefRun) => string;
}

export interface WarnCanvaRule {
  field: string;
  check: (data: ThumbnailBriefRun) => boolean;
  message: (data: ThumbnailBriefRun) => string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countGenerated(run: ThumbnailBriefRun): number {
  return run.formats_generated.length;
}

function hasGuideForAllFormats(run: ThumbnailBriefRun): boolean {
  return run.formats_generated.every(
    (f) => run.guide_paths[f] !== null
  );
}

function briefTextOverlaysNonEmpty(brief: ThumbnailBrief): boolean {
  return brief.text_overlays.length > 0 && brief.text_overlays.every((t) => t.text.trim().length > 0);
}

// ─── Critical rules (result fails) ───────────────────────────────────────────

export const CRITICAL_CANVA_RULES: CriticalCanvaRule[] = [
  {
    field: 'has_formats',
    check: (d) => countGenerated(d) > 0,
    message: () => 'No thumbnail formats were generated — brief build produced no output',
  },
  {
    field: 'manifest_exists',
    check: (d) => d.manifest_path.length > 0,
    message: () => 'Thumbnail brief manifest path is empty — storage write may have failed',
  },
];

// ─── Warn rules (non-fatal) ───────────────────────────────────────────────────

export const WARN_CANVA_RULES: WarnCanvaRule[] = [
  {
    field: 'all_formats_have_guides',
    check: (d) => hasGuideForAllFormats(d),
    message: (d) => {
      const missing = d.formats_generated.filter((f) => d.guide_paths[f] === null);
      return `Canva guide missing for format(s): ${missing.join(', ')}`;
    },
  },
  {
    field: 'desktop_generated',
    check: (d) => d.formats_generated.includes('desktop'),
    message: () => 'Desktop (1280×720) format was not generated — YouTube thumbnail will be missing',
  },
  {
    field: 'mobile_generated',
    check: (d) => d.formats_generated.includes('mobile'),
    message: () => 'Mobile (1080×1920) format was not generated — Shorts/Reels thumbnail will be missing',
  },
];

// ─── Per-brief validation helpers ─────────────────────────────────────────────

/**
 * Validate a single ThumbnailBrief, returning any warnings.
 * Used by the brief builder after construction.
 */
export function validateBrief(brief: ThumbnailBrief): string[] {
  const warns: string[] = [];
  if (!briefTextOverlaysNonEmpty(brief)) {
    warns.push(`Brief "${brief.format}": one or more text overlays have empty text`);
  }
  if (brief.ai_image_prompt.trim().length < 20) {
    warns.push(`Brief "${brief.format}": ai_image_prompt is very short — consider adding more detail`);
  }
  if (brief.canva_guide_steps.length < 3) {
    warns.push(`Brief "${brief.format}": canva_guide_steps has fewer than 3 steps`);
  }
  return warns;
}

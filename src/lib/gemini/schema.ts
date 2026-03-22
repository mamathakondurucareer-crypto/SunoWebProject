/**
 * Zod validation schemas for the Gemini devotional-package output.
 *
 * These are intentionally permissive on string lengths so that partial or
 * abbreviated AI responses don't fail Zod — critical count checks live in
 * the parser layer, not here.  Zod is used for structural guarantees only.
 */

import { z } from 'zod';

// ─── Primitives ───────────────────────────────────────────────────────────────

const nonEmptyString = z.string().min(1);

// ─── Lyrics ───────────────────────────────────────────────────────────────────

export const LyricSectionTypeSchema = z.enum([
  'verse',
  'chorus',
  'bridge',
  'pre-chorus',
  'outro',
  'intro',
  'hook',
  'unknown',
]);

export const LyricSectionSchema = z.object({
  label: z.string(),
  type: LyricSectionTypeSchema,
  lines: z.array(z.string()).min(1),
});

// ─── Crop notes ───────────────────────────────────────────────────────────────

export const CropNotesSchema = z.object({
  '16:9': z.string().nullable(),
  '9:16': z.string().nullable(),
  '1:1':  z.string().nullable(),
});

// ─── Scene plan ───────────────────────────────────────────────────────────────

export const ScenePlanSchema = z.object({
  scene_number: z.number().int().positive(),
  start_seconds: z.number().nullable(),
  end_seconds: z.number().nullable(),
  description: nonEmptyString,
  visual_notes: z.string().nullable(),
  grok_text_to_video_prompt_seed: z.string().nullable(),
  capcut_motion: z.string().nullable(),
  crop_notes: CropNotesSchema.nullable(),
  negative_prompts: z.array(z.string()).nullable(),
});

// ─── Thumbnails ───────────────────────────────────────────────────────────────

export const ThumbnailConceptSchema = z.object({
  concept_number: z.number().int().positive(),
  type: z.string().nullable(),
  description: nonEmptyString,
});

// ─── Shorts & Reels ───────────────────────────────────────────────────────────

export const ShortContentSchema = z.object({
  short_number: z.number().int().positive(),
  hook: z.string(),
  visual_plan: z.string(),
  caption: z.string(),
  cta: z.string(),
});

export const ReelContentSchema = z.object({
  reel_number: z.number().int().positive(),
  hook: z.string(),
  visual_plan: z.string(),
  caption: z.string(),
  cta: z.string(),
});

// ─── SEO ─────────────────────────────────────────────────────────────────────

export const SeoMetadataSchema = z.object({
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  hashtags: z.array(z.string()),
  main_titles: z.array(z.string()),
  shorts_titles: z.array(z.string()),
  reels_hooks: z.array(z.string()),
  shorts_description_template: z.string(),
  reels_description_template: z.string(),
  keyword_clusters: z.array(z.array(z.string())),
  tags_secondary: z.array(z.string()),
  link_template_placeholders: z.array(z.string()),
  seo_rationale: z.string(),
});

// ─── Compliance ───────────────────────────────────────────────────────────────

export const ComplianceGateSchema = z.object({
  gate: z.string(),
  name: z.string(),
  passed: z.boolean(),
  notes: z.string().nullable(),
});

export const CompliancePlanSchema = z.object({
  gates: z.array(ComplianceGateSchema),
  all_passed: z.boolean(),
  summary: z.string().nullable(),
});

// ─── Strict risk gate ─────────────────────────────────────────────────────────

export const StrictRiskGateResultSchema = z.object({
  all_low: z.boolean(),
  approved: z.boolean(),
  gate_results: z.record(z.boolean()),
});

// ─── Risk review ─────────────────────────────────────────────────────────────

export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'unknown']);

export const RiskReviewSchema = z.object({
  doctrinal_accuracy: z.string(),
  copyright_notes: z.string().nullable(),
  language_sensitivity: z.string().nullable(),
  overall_risk: RiskLevelSchema,
  manual_review_notes: z.string().nullable(),
  strict_risk_gate: StrictRiskGateResultSchema.nullable(),
});

// ─── Completeness audit ───────────────────────────────────────────────────────

export const CompletenessAuditSchema = z.object({
  has_lyrics: z.boolean(),
  has_style: z.boolean(),
  has_vocal_guidance: z.boolean(),
  has_suno_prompt: z.boolean(),
  has_scene_plan: z.boolean(),
  has_thumbnails: z.boolean(),
  has_seo: z.boolean(),
  has_cta: z.boolean(),
  has_risk_review: z.boolean(),
  has_dual_lyrics: z.boolean(),
  has_english_suno_prompt: z.boolean(),
  has_shorts: z.boolean(),
  has_reels: z.boolean(),
  has_compliance_plan: z.boolean(),
  scene_concept_count: z.number().int().min(0),
  shorts_count: z.number().int().min(0),
  reels_count: z.number().int().min(0),
  titles_main_count: z.number().int().min(0),
  titles_shorts_count: z.number().int().min(0),
  titles_reels_count: z.number().int().min(0),
  ctas_count: z.number().int().min(0),
  missing: z.array(z.string()),
  score: z.number().min(0).max(100),
});

// ─── Full output ──────────────────────────────────────────────────────────────

export const ParseSourceSchema = z.enum(['prose', 'json', 'mixed']);

export const GeminiParsedOutputSchema = z.object({
  song_title: z.string(),
  lyrics_raw: z.string(),
  lyric_sections: z.array(LyricSectionSchema),
  lyrics_hindi_devanagari: z.string(),
  lyrics_english: z.string(),
  style_notes: z.string(),
  vocal_guidance: z.string(),
  suno_style_prompt: z.string(),
  suno_prompt_english: z.string(),
  background: z.string(),

  scene_plan: z.array(ScenePlanSchema),
  capcut_plan: z.string(),

  shorts: z.array(ShortContentSchema),
  reels: z.array(ReelContentSchema),

  thumbnail_concepts: z.array(ThumbnailConceptSchema),
  shorts_reels_cta: z.array(z.string()),
  opening_10_seconds_plan: z.string(),

  seo: SeoMetadataSchema,

  risk_review: RiskReviewSchema,
  compliance_plan: CompliancePlanSchema.nullable(),
  completeness: CompletenessAuditSchema,

  parse_warnings: z.array(z.string()),
  parsed_at: z.number(),
  source: ParseSourceSchema,
});

// ─── Parse result ─────────────────────────────────────────────────────────────

export const GeminiParseResultSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    data: GeminiParsedOutputSchema,
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
  z.object({
    success: z.literal(false),
    data: GeminiParsedOutputSchema.optional(),
    errors: z.array(z.string()).min(1),
    warnings: z.array(z.string()),
  }),
]);

// ─── Inferred types (source-of-truth aliases) ─────────────────────────────────

export type LyricSectionTypeSchemaType  = z.infer<typeof LyricSectionTypeSchema>;
export type LyricSectionSchemaType      = z.infer<typeof LyricSectionSchema>;
export type CropNotesSchemaType         = z.infer<typeof CropNotesSchema>;
export type ScenePlanSchemaType         = z.infer<typeof ScenePlanSchema>;
export type ThumbnailConceptSchemaType  = z.infer<typeof ThumbnailConceptSchema>;
export type ShortContentSchemaType      = z.infer<typeof ShortContentSchema>;
export type ReelContentSchemaType       = z.infer<typeof ReelContentSchema>;
export type SeoMetadataSchemaType       = z.infer<typeof SeoMetadataSchema>;
export type CompliancePlanSchemaType    = z.infer<typeof CompliancePlanSchema>;
export type RiskReviewSchemaType        = z.infer<typeof RiskReviewSchema>;
export type GeminiParsedOutputType      = z.infer<typeof GeminiParsedOutputSchema>;
export type GeminiParseResultType       = z.infer<typeof GeminiParseResultSchema>;

// ─── Critical-count rules ─────────────────────────────────────────────────────

/**
 * Rules evaluated after parsing.  A failed rule adds to `errors` and flips
 * `success` to false.  All rules are checked so the caller gets a full error
 * list, not just the first failure.
 */
export interface CriticalRule {
  field: string;
  message: (data: GeminiParsedOutputType) => string;
  check: (data: GeminiParsedOutputType) => boolean;
}

export const CRITICAL_RULES: CriticalRule[] = [
  {
    field: 'song_title',
    check: d => d.song_title.trim().length > 0,
    message: () => 'Song title is missing — cannot proceed without a title',
  },
  {
    field: 'suno_style_prompt',
    check: d => d.suno_style_prompt.trim().length > 0,
    message: () => 'Suno style prompt is missing — required for audio generation',
  },
  {
    field: 'lyrics_raw',
    check: d => d.lyrics_raw.trim().length > 20,
    message: () => 'Lyrics content is absent or too short',
  },
  {
    field: 'lyric_sections',
    check: d => d.lyric_sections.length >= 2,
    message: d =>
      `Lyrics must have at least 2 labelled sections (verse + chorus); got ${d.lyric_sections.length}`,
  },
  {
    field: 'scene_plan',
    check: d => d.scene_plan.length >= 4,
    message: d =>
      `Scene plan must contain at least 4 scenes for meaningful video production; got ${d.scene_plan.length}`,
  },
  {
    field: 'seo.title',
    check: d => d.seo.title.trim().length > 0,
    message: () => 'SEO title is missing — required for platform publishing',
  },
];

/**
 * Rules that produce warnings but do not fail the parse.
 */
export interface WarnRule {
  field: string;
  message: (data: GeminiParsedOutputType) => string;
  check: (data: GeminiParsedOutputType) => boolean;
}

export const WARN_RULES: WarnRule[] = [
  {
    field: 'thumbnail_concepts',
    check: d => d.thumbnail_concepts.length >= 1,
    message: () => 'No thumbnail concepts found — Canva stage will lack design direction',
  },
  {
    field: 'shorts_reels_cta',
    check: d => d.shorts_reels_cta.length >= 1,
    message: () => 'No Shorts/Reels CTAs found — short-form content will need manual CTAs',
  },
  {
    field: 'risk_review.overall_risk',
    check: d => d.risk_review.overall_risk !== 'unknown',
    message: () => 'Risk level could not be determined — recommend manual review',
  },
  {
    field: 'seo.tags',
    check: d => d.seo.tags.length >= 3,
    message: d => `Only ${d.seo.tags.length} SEO tag(s) extracted — aim for at least 3`,
  },
  {
    field: 'seo.hashtags',
    check: d => d.seo.hashtags.length >= 3,
    message: d => `Only ${d.seo.hashtags.length} hashtag(s) extracted — aim for at least 3`,
  },
  {
    field: 'background',
    check: d => d.background.trim().length > 0,
    message: () => 'Background / spiritual context section is empty',
  },
  {
    field: 'lyrics_hindi_devanagari',
    check: d => d.lyrics_hindi_devanagari.trim().length > 0,
    message: () => 'Hindi Devanagari lyrics missing — dual-language package incomplete',
  },
  {
    field: 'lyrics_english',
    check: d => d.lyrics_english.trim().length > 0,
    message: () => 'English lyrics missing — dual-language package incomplete',
  },
  {
    field: 'shorts',
    check: d => d.shorts.length >= 3,
    message: d => `Only ${d.shorts.length} Shorts item(s) — aim for 5`,
  },
  {
    field: 'reels',
    check: d => d.reels.length >= 3,
    message: d => `Only ${d.reels.length} Reels item(s) — aim for 5`,
  },
  {
    field: 'seo.main_titles',
    check: d => d.seo.main_titles.length >= 5,
    message: d => `Only ${d.seo.main_titles.length} main SEO title(s) — aim for 10`,
  },
  {
    field: 'compliance_plan',
    check: d => d.compliance_plan !== null,
    message: () => 'Compliance plan missing — Gates A–J review not completed',
  },
];

/**
 * Normalised types for the Gemini devotional-package output.
 *
 * These types are shared by:
 *   - The Zod validation schemas  (schema.ts)
 *   - The prose / JSON parser     (parser.ts)
 *   - The workflow engine          (gemini_capture_parse stage)
 *   - The dashboard UI             (run detail views)
 */

// ─── Lyrics ───────────────────────────────────────────────────────────────────

export type LyricSectionType =
  | 'verse'
  | 'chorus'
  | 'bridge'
  | 'pre-chorus'
  | 'outro'
  | 'intro'
  | 'hook'
  | 'unknown';

export interface LyricSection {
  /** Human-readable label extracted from the source text, e.g. "Verse 1" */
  label: string;
  type: LyricSectionType;
  /** Individual non-empty lyric lines, in source order */
  lines: string[];
}

// ─── Crop notes (per aspect ratio) ───────────────────────────────────────────

/** Per-aspect-ratio crop/framing guidance for a scene */
export interface CropNotes {
  '16:9': string | null;
  '9:16': string | null;
  '1:1':  string | null;
}

// ─── Pre-audio scene concept ──────────────────────────────────────────────────

export interface ScenePlan {
  scene_number: number;
  /** Hint from Gemini — null when no timing was provided */
  start_seconds: number | null;
  end_seconds: number | null;
  /** Full visual description of the scene / section label */
  description: string;
  /** Optional extra visual direction (parentheticals, sub-lines) */
  visual_notes: string | null;
  /** Grok text-to-video seed prompt */
  grok_text_to_video_prompt_seed: string | null;
  /** CapCut recommended motion / transition for this scene */
  capcut_motion: string | null;
  /** Framing guidance per aspect ratio */
  crop_notes: CropNotes | null;
  /** Explicit exclusion list for Grok generation */
  negative_prompts: string[] | null;
}

// ─── Thumbnails ───────────────────────────────────────────────────────────────

export interface ThumbnailConcept {
  concept_number: number;
  /** Format category: DESKTOP | MOBILE | MULTI-SOCIAL | CANVA GUIDE */
  type: string | null;
  description: string;
}

// ─── Shorts & Reels ───────────────────────────────────────────────────────────

export interface ShortContent {
  short_number: number;
  /** Hook text shown in first 3 seconds */
  hook: string;
  /** Visual plan for the short */
  visual_plan: string;
  /** Caption text for the short */
  caption: string;
  /** CTA for the short */
  cta: string;
}

export interface ReelContent {
  reel_number: number;
  /** Opening hook for the reel */
  hook: string;
  /** Visual plan for the reel */
  visual_plan: string;
  /** Caption text for the reel */
  caption: string;
  /** CTA for the reel */
  cta: string;
}

// ─── SEO / platform metadata ─────────────────────────────────────────────────

export interface SeoMetadata {
  /** Primary YouTube / Instagram title — target ≤ 70 chars */
  title: string;
  /** 2–3 sentence main platform description */
  description: string;
  /** Plain keyword tags (no # prefix) */
  tags: string[];
  /** Hashtag strings including # prefix */
  hashtags: string[];

  // ── Extended fields from new prompt format ──────────────────────────────
  /** 10 main titles (YouTube / Instagram) */
  main_titles: string[];
  /** 10 Shorts-optimised titles */
  shorts_titles: string[];
  /** 10 Reels hook strings */
  reels_hooks: string[];
  /** Description template for Shorts */
  shorts_description_template: string;
  /** Description template for Reels */
  reels_description_template: string;
  /** Nested keyword clusters (each cluster is an array of related terms) */
  keyword_clusters: string[][];
  /** Secondary/long-tail tags */
  tags_secondary: string[];
  /** Link template placeholders (e.g. {SPOTIFY_LINK}) */
  link_template_placeholders: string[];
  /** Rationale for the chosen SEO strategy */
  seo_rationale: string;
}

// ─── Shorts / Reels CTAs ─────────────────────────────────────────────────────

/** Each element is one CTA phrase ready for on-screen text or caption */
export type CtaList = string[];

// ─── Compliance ───────────────────────────────────────────────────────────────

/** Status of a single compliance gate (A–J) */
export interface ComplianceGate {
  /** Gate letter: A–J */
  gate: string;
  /** Human-readable gate name, e.g. "Risk Level Gate" */
  name: string;
  /** Whether the gate passed */
  passed: boolean;
  /** Notes from Gemini on why it passed or how it was applied */
  notes: string | null;
}

/** Full compliance plan covering all gates A–J */
export interface CompliancePlan {
  gates: ComplianceGate[];
  /** true iff all gates passed */
  all_passed: boolean;
  /** Overall compliance notes */
  summary: string | null;
}

// ─── Strict risk gate ─────────────────────────────────────────────────────────

export interface StrictRiskGateResult {
  /** All individual gate checks returned low risk */
  all_low: boolean;
  /** Package approved for release */
  approved: boolean;
  /** Per-gate pass/fail map, key = gate letter */
  gate_results: Record<string, boolean>;
}

// ─── Risk review ─────────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'unknown';

export interface RiskReview {
  doctrinal_accuracy: string;
  copyright_notes: string | null;
  language_sensitivity: string | null;
  overall_risk: RiskLevel;
  /** Populated from commercial_risk_review_manual_notes in new format */
  manual_review_notes: string | null;
  strict_risk_gate: StrictRiskGateResult | null;
}

// ─── Completeness audit ───────────────────────────────────────────────────────

export interface CompletenessAudit {
  has_lyrics: boolean;
  has_style: boolean;
  has_vocal_guidance: boolean;
  has_suno_prompt: boolean;
  has_scene_plan: boolean;
  has_thumbnails: boolean;
  has_seo: boolean;
  has_cta: boolean;
  has_risk_review: boolean;
  /** New-format checks */
  has_dual_lyrics: boolean;
  has_english_suno_prompt: boolean;
  has_shorts: boolean;
  has_reels: boolean;
  has_compliance_plan: boolean;
  /** Counts from extended fields */
  scene_concept_count: number;
  shorts_count: number;
  reels_count: number;
  titles_main_count: number;
  titles_shorts_count: number;
  titles_reels_count: number;
  ctas_count: number;
  /** Names of sections that were absent or empty */
  missing: string[];
  /** 0–100 completeness score */
  score: number;
}

// ─── Full parsed output ───────────────────────────────────────────────────────

export type ParseSource = 'prose' | 'json' | 'mixed';

export interface GeminiParsedOutput {
  // ── Core song content ──────────────────────────────────────────────────────
  song_title: string;
  /** Raw lyrics text block exactly as returned */
  lyrics_raw: string;
  lyric_sections: LyricSection[];

  // ── Dual-language lyrics (new format) ─────────────────────────────────────
  /** Hindi + Sanskrit lyrics in Devanagari script (primary) */
  lyrics_hindi_devanagari: string;
  /** English edition lyrics (not a literal translation) */
  lyrics_english: string;

  style_notes: string;
  vocal_guidance: string;
  /** Ready-to-paste Suno style descriptor — Hindi edition */
  suno_style_prompt: string;
  /** Suno style descriptor — English edition */
  suno_prompt_english: string;
  background: string;

  // ── Pre-audio visual plan ──────────────────────────────────────────────────
  scene_plan: ScenePlan[];
  /** Overall CapCut editing plan / notes */
  capcut_plan: string;

  // ── Short-form content ─────────────────────────────────────────────────────
  /** 5 YouTube Shorts items */
  shorts: ShortContent[];
  /** 5 Instagram Reels items */
  reels: ReelContent[];

  // ── Distribution content ───────────────────────────────────────────────────
  thumbnail_concepts: ThumbnailConcept[];
  /** Legacy flat CTA list (redirect CTAs from new format, or prose CTAs) */
  shorts_reels_cta: CtaList;
  /** Opening 10-second visual/audio plan */
  opening_10_seconds_plan: string;

  // ── Platform metadata ──────────────────────────────────────────────────────
  seo: SeoMetadata;

  // ── Quality gates ──────────────────────────────────────────────────────────
  risk_review: RiskReview;
  /** Full compliance plan (Gates A–J) from new format */
  compliance_plan: CompliancePlan | null;
  completeness: CompletenessAudit;

  // ── Parser metadata ────────────────────────────────────────────────────────
  /** Non-fatal issues detected during parsing */
  parse_warnings: string[];
  parsed_at: number;
  /** How the data was sourced */
  source: ParseSource;
}

// ─── Parser result ────────────────────────────────────────────────────────────

export interface GeminiParseResult {
  success: boolean;
  data?: GeminiParsedOutput;
  /** Critical failures that made a complete parse impossible */
  errors: string[];
  /** Non-critical issues — parse succeeded but data may be incomplete */
  warnings: string[];
}

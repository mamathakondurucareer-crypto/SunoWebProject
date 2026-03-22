/**
 * Types for the Canva thumbnail brief and export preparation module.
 *
 * Shared by:
 *   - brief.ts              (brief generator)
 *   - schema.ts             (Zod schemas + validation rules)
 *   - storage.ts            (per-brief artifact storage)
 *   - worker/adapters/canva.ts  (Canva browser handoff adapter)
 */

// ─── Format identifiers ───────────────────────────────────────────────────────

/**
 * The four brief types this module produces.
 *
 *   desktop      — 1280×720 YouTube standard thumbnail
 *   mobile       — 1080×1920 YouTube Shorts / Instagram Reels
 *   multi_social — Multi-format export set (YouTube + Instagram square + story)
 *   canva_guide  — Step-by-step Canva editor guide (markdown + brief JSON)
 */
export type ThumbnailFormat = 'desktop' | 'mobile' | 'multi_social' | 'canva_guide';

// ─── Dimensions ───────────────────────────────────────────────────────────────

export interface ThumbnailDimensions {
  width: number;
  height: number;
  /** Human-readable label, e.g. "1280 × 720 (16:9)" */
  label: string;
}

// ─── Text overlays ────────────────────────────────────────────────────────────

export type TextWeight = 'thin' | 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold';
export type TextAlignment = 'left' | 'center' | 'right';
export type PositionAnchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

/**
 * A single text element to be placed on the thumbnail canvas.
 */
export interface TextOverlay {
  /** Canva layer name for this element */
  layer_name: string;
  /** The actual text content */
  text: string;
  /** Font family hint, e.g. "Playfair Display", "Cinzel", "Noto Sans Devanagari" */
  font_hint: string;
  weight: TextWeight;
  /**
   * Relative size hint, e.g. "72pt", "10% of canvas height".
   * Exact sizing is up to the designer; this is a guide.
   */
  size_hint: string;
  /** CSS hex color, e.g. "#FFD700" */
  color: string;
  /** 0–100 opacity */
  opacity: number;
  /** Anchor point on the canvas */
  position: PositionAnchor;
  alignment: TextAlignment;
  /**
   * Inset from the anchor edge in % of canvas dimension.
   * e.g. { top: 5, left: 8 } means 5% from top, 8% from left.
   */
  safe_zone_offset: { top?: number; bottom?: number; left?: number; right?: number };
  /** Optional drop shadow spec */
  shadow?: string;
  /** Optional text stroke spec, e.g. "2px #000000" */
  stroke?: string;
}

// ─── Layer plan ───────────────────────────────────────────────────────────────

export interface BackgroundLayer {
  /** "ai_image" | "solid_color" | "gradient" | "video_frame" */
  type: 'ai_image' | 'solid_color' | 'gradient' | 'video_frame';
  /** AI generation prompt or color value */
  value: string;
  /** 0–100 */
  opacity: number;
}

export interface SubjectLayer {
  layer_name: string;
  /**
   * Description of the subject asset — can be AI-generated or a video frame export.
   * e.g. "Center-cropped still from Scene 01 temple exterior"
   */
  description: string;
  /** Blend mode hint, e.g. "normal", "multiply", "screen" */
  blend_mode: string;
  /** 0–100 */
  opacity: number;
  /** Placement guidance in % of canvas, e.g. "centered, 60% width" */
  placement_hint: string;
}

export interface ColorOverlay {
  /** CSS color or gradient */
  value: string;
  /** 0–100 */
  opacity: number;
  /** "solid" | "gradient" | "vignette" */
  type: 'solid' | 'gradient' | 'vignette';
}

export interface LayerPlan {
  background: BackgroundLayer;
  subject: SubjectLayer | null;
  color_overlay: ColorOverlay | null;
  text_layers: TextOverlay[];
  /** e.g. ["Drop shadow on title", "Inner glow on subtitle"] */
  effects: string[];
  /**
   * Ordered list of layer names from bottom to top.
   * Used as a Canva layer panel reference.
   */
  stacking_order: string[];
}

// ─── Export targets ───────────────────────────────────────────────────────────

export type ExportFormat = 'PNG' | 'JPG' | 'PDF';
export type SocialPlatform =
  | 'YouTube'
  | 'YouTube Shorts'
  | 'Instagram'
  | 'Instagram Reels'
  | 'Facebook'
  | 'Twitter/X';

export interface ExportTarget {
  /** Output filename, e.g. "thumbnail_desktop_youtube.png" */
  filename: string;
  format: ExportFormat;
  width: number;
  height: number;
  platform: SocialPlatform;
  /** DPI — defaults to 72 for web */
  dpi: number;
}

// ─── Format spec ──────────────────────────────────────────────────────────────

/**
 * Static specification for a thumbnail format.
 * Used by the brief builder to fill in format-level fields.
 */
export interface ThumbnailFormatSpec {
  format: ThumbnailFormat;
  primary_dimensions: ThumbnailDimensions;
  aspect_ratio: string;
  /**
   * Guidance on the safe zone — the region guaranteed to be visible
   * after platform cropping.
   * e.g. "Keep all text within center 90% × 80% of the frame"
   */
  safe_zone_guide: string;
  platforms: SocialPlatform[];
  export_targets: ExportTarget[];
}

// ─── Brief input ──────────────────────────────────────────────────────────────

/**
 * All project-level inputs needed to generate a set of thumbnail briefs.
 */
export interface ThumbnailBriefRequest {
  song_title: string;
  devotional_theme: string;
  /** e.g. "warm, uplifting, Bhairavi raag, 80 BPM" */
  audio_mood: string;
  /** Primary brand/palette color, CSS hex */
  primary_color: string;
  /** Accent color, CSS hex */
  accent_color: string;
  /** Background/neutral tone, CSS hex */
  neutral_color: string;
  /**
   * Font stack in order of preference.
   * Index 0 = primary title font, index 1 = subtitle, index 2 = body/caption.
   */
  font_stack: [string, string, string];
  /**
   * Description of the winning scene or video frame to use as background imagery.
   * Can be a file path or a free-text description for AI image generation.
   */
  background_image_hint: string;
  /** Optional custom text to show on the thumbnail (overrides song_title) */
  headline_override?: string;
  /** Optional subtitle line */
  subtitle_text?: string;
  /** Optional call-to-action text */
  cta_text?: string;
  /**
   * Which formats to generate. Defaults to all four if omitted.
   */
  formats?: ThumbnailFormat[];
}

// ─── Per-format brief ─────────────────────────────────────────────────────────

/**
 * A fully-specified brief for one thumbnail format variant.
 * Consumed directly by a designer in Canva (or by the browser automation adapter).
 */
export interface ThumbnailBrief {
  format: ThumbnailFormat;
  spec: ThumbnailFormatSpec;
  text_overlays: TextOverlay[];
  layer_plan: LayerPlan;
  /**
   * Prompt for an AI image generator (DALL·E, Midjourney, Ideogram) to produce
   * the background asset if no video frame is available.
   */
  ai_image_prompt: string;
  /**
   * Step-by-step Canva editor instructions. Always populated;
   * for the canva_guide format this is the primary deliverable.
   */
  canva_guide_steps: string[];
  export_targets: ExportTarget[];
  created_at: string;
}

// ─── Run manifest ─────────────────────────────────────────────────────────────

/**
 * Written to `thumbnail_brief_manifest.json` in the run's thumbnails directory.
 */
export interface ThumbnailBriefRun {
  run_dir: string;
  /** Absolute path to thumbnail_brief_manifest.json */
  manifest_path: string;
  /** Absolute paths to per-format brief JSONs */
  brief_paths: Record<ThumbnailFormat, string | null>;
  /** Absolute paths to per-format canva_guide markdowns */
  guide_paths: Record<ThumbnailFormat, string | null>;
  formats_generated: ThumbnailFormat[];
  created_at: string;
}

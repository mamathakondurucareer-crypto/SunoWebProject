/**
 * Thumbnail brief generator for the Canva module.
 *
 * Deterministically builds fully-specified ThumbnailBrief objects from project
 * data — no LLM round-trip required.  The output drives both the local storage
 * artifacts (JSON + markdown guides) and the optional Canva browser handoff.
 */

import type {
  ThumbnailFormat,
  ThumbnailBriefRequest,
  ThumbnailBrief,
  ThumbnailFormatSpec,
  TextOverlay,
  LayerPlan,
  BackgroundLayer,
  SubjectLayer,
  ColorOverlay,
  ExportTarget,
} from './types';

// ─── Static format specifications ─────────────────────────────────────────────

export const FORMAT_SPECS: Record<ThumbnailFormat, ThumbnailFormatSpec> = {
  desktop: {
    format: 'desktop',
    primary_dimensions: { width: 1280, height: 720, label: '1280 × 720 (16:9)' },
    aspect_ratio: '16:9',
    safe_zone_guide:
      'Keep all text within the center 90% (width) × 85% (height). ' +
      'Avoid the top 8% (YouTube progress bar overlap) and left edge 5% (channel branding).',
    platforms: ['YouTube'],
    export_targets: [
      {
        filename: 'thumbnail_desktop_youtube.png',
        format: 'PNG',
        width: 1280,
        height: 720,
        platform: 'YouTube',
        dpi: 72,
      },
    ],
  },

  mobile: {
    format: 'mobile',
    primary_dimensions: { width: 1080, height: 1920, label: '1080 × 1920 (9:16)' },
    aspect_ratio: '9:16',
    safe_zone_guide:
      'Keep all text within the center 85% (width) × 75% (height). ' +
      'Reserve top 12% for status bar and bottom 20% for platform UI chrome.',
    platforms: ['YouTube Shorts', 'Instagram Reels'],
    export_targets: [
      {
        filename: 'thumbnail_mobile_shorts.png',
        format: 'PNG',
        width: 1080,
        height: 1920,
        platform: 'YouTube Shorts',
        dpi: 72,
      },
      {
        filename: 'thumbnail_mobile_reels.png',
        format: 'PNG',
        width: 1080,
        height: 1920,
        platform: 'Instagram Reels',
        dpi: 72,
      },
    ],
  },

  multi_social: {
    format: 'multi_social',
    primary_dimensions: { width: 1280, height: 720, label: '1280 × 720 (primary 16:9)' },
    aspect_ratio: '16:9 primary; 1:1 and 9:16 variants',
    safe_zone_guide:
      'Design to the 1:1 safe zone (center 720×720 of the 1280×720 canvas) so the design works across all crops.',
    platforms: ['YouTube', 'Instagram', 'Instagram Reels', 'Facebook', 'Twitter/X'],
    export_targets: [
      {
        filename: 'thumbnail_multi_youtube.png',
        format: 'PNG',
        width: 1280,
        height: 720,
        platform: 'YouTube',
        dpi: 72,
      },
      {
        filename: 'thumbnail_multi_instagram_square.png',
        format: 'PNG',
        width: 1080,
        height: 1080,
        platform: 'Instagram',
        dpi: 72,
      },
      {
        filename: 'thumbnail_multi_instagram_story.png',
        format: 'PNG',
        width: 1080,
        height: 1920,
        platform: 'Instagram Reels',
        dpi: 72,
      },
      {
        filename: 'thumbnail_multi_facebook.png',
        format: 'PNG',
        width: 1200,
        height: 630,
        platform: 'Facebook',
        dpi: 72,
      },
      {
        filename: 'thumbnail_multi_twitter.png',
        format: 'PNG',
        width: 1600,
        height: 900,
        platform: 'Twitter/X',
        dpi: 72,
      },
    ],
  },

  canva_guide: {
    format: 'canva_guide',
    primary_dimensions: { width: 1280, height: 720, label: '1280 × 720 (16:9 guide base)' },
    aspect_ratio: '16:9',
    safe_zone_guide:
      'This format is a step-by-step guide. Follow the desktop safe zone rules as the base. ' +
      'Each step specifies where to place elements and which Canva tools to use.',
    platforms: ['YouTube'],
    export_targets: [
      {
        filename: 'thumbnail_canva_guide_export.png',
        format: 'PNG',
        width: 1280,
        height: 720,
        platform: 'YouTube',
        dpi: 72,
      },
    ],
  },
};

/** All formats in generation order */
export const ALL_FORMATS: ThumbnailFormat[] = ['desktop', 'mobile', 'multi_social', 'canva_guide'];

// ─── Text overlay builders ─────────────────────────────────────────────────────

function buildTitleOverlay(req: ThumbnailBriefRequest): TextOverlay {
  const headline = req.headline_override ?? req.song_title;
  return {
    layer_name: 'title_text',
    text: headline,
    font_hint: req.font_stack[0],
    weight: 'bold',
    size_hint: '72pt (desktop) / 96pt (mobile)',
    color: req.primary_color,
    opacity: 100,
    position: 'bottom-left',
    alignment: 'left',
    safe_zone_offset: { bottom: 18, left: 8 },
    shadow: '4px 4px 12px rgba(0,0,0,0.8)',
    stroke: `2px ${req.neutral_color}`,
  };
}

function buildSubtitleOverlay(req: ThumbnailBriefRequest): TextOverlay {
  const subtitle = req.subtitle_text ?? req.devotional_theme;
  return {
    layer_name: 'subtitle_text',
    text: subtitle,
    font_hint: req.font_stack[1],
    weight: 'medium',
    size_hint: '36pt (desktop) / 48pt (mobile)',
    color: req.accent_color,
    opacity: 92,
    position: 'bottom-left',
    alignment: 'left',
    safe_zone_offset: { bottom: 10, left: 8 },
    shadow: '2px 2px 8px rgba(0,0,0,0.6)',
  };
}

function buildCtaOverlay(req: ThumbnailBriefRequest): TextOverlay | null {
  if (!req.cta_text) return null;
  return {
    layer_name: 'cta_text',
    text: req.cta_text,
    font_hint: req.font_stack[2],
    weight: 'semibold',
    size_hint: '24pt',
    color: req.neutral_color,
    opacity: 90,
    position: 'top-right',
    alignment: 'right',
    safe_zone_offset: { top: 6, right: 6 },
    shadow: '1px 1px 4px rgba(0,0,0,0.5)',
  };
}

function buildMoodLabel(req: ThumbnailBriefRequest): TextOverlay {
  return {
    layer_name: 'mood_label',
    text: req.audio_mood.split(',')[0].trim(),
    font_hint: req.font_stack[2],
    weight: 'thin',
    size_hint: '18pt',
    color: req.neutral_color,
    opacity: 70,
    position: 'top-left',
    alignment: 'left',
    safe_zone_offset: { top: 6, left: 8 },
  };
}

// ─── Layer plan builder ────────────────────────────────────────────────────────

function buildLayerPlan(req: ThumbnailBriefRequest, textOverlays: TextOverlay[]): LayerPlan {
  const background: BackgroundLayer = {
    type: req.background_image_hint.startsWith('/') ? 'video_frame' : 'ai_image',
    value: req.background_image_hint,
    opacity: 100,
  };

  const subject: SubjectLayer = {
    layer_name: 'subject_overlay',
    description: `Devotional scene centered on the canvas — derived from: ${req.background_image_hint}`,
    blend_mode: 'normal',
    opacity: 95,
    placement_hint: 'Centered; scale to fill canvas; use Canva "Crop" to reframe if needed',
  };

  const colorOverlay: ColorOverlay = {
    value: `linear-gradient(to top, ${req.neutral_color}CC 0%, transparent 50%)`,
    opacity: 70,
    type: 'gradient',
  };

  const effects = [
    'Drop shadow on title_text layer: offset 4px, blur 12px, color #000000 at 80% opacity',
    'Vignette on background layer: 60% strength, 20% feather radius',
    'Optional: subtle warm color filter on background (hue +10°, saturation +15%)',
  ];

  const stackingOrder = [
    'background',
    'subject_overlay',
    'color_gradient_overlay',
    ...textOverlays.map((t) => t.layer_name),
  ];

  return {
    background,
    subject,
    color_overlay: colorOverlay,
    text_layers: textOverlays,
    effects,
    stacking_order: stackingOrder,
  };
}

// ─── AI image prompt builder ───────────────────────────────────────────────────

function buildAiImagePrompt(req: ThumbnailBriefRequest, format: ThumbnailFormat): string {
  const aspectMap: Record<ThumbnailFormat, string> = {
    desktop: '16:9 wide landscape',
    mobile: '9:16 vertical portrait',
    multi_social: '1:1 square-safe (16:9 canvas)',
    canva_guide: '16:9 wide landscape',
  };
  const aspect = aspectMap[format];
  return (
    `Cinematic devotional thumbnail, ${aspect}. ` +
    `${req.background_image_hint}. ` +
    `Color palette: primary ${req.primary_color}, accent ${req.accent_color}, warm saffron-gold tones. ` +
    `Mood: ${req.audio_mood}. Theme: ${req.devotional_theme}. ` +
    `Soft natural lighting, golden hour atmosphere. ` +
    `High resolution, photorealistic, no text, no watermarks, no logos.`
  );
}

// ─── Canva guide step builders ─────────────────────────────────────────────────

function buildCanvaGuideSteps(
  req: ThumbnailBriefRequest,
  format: ThumbnailFormat,
  textOverlays: TextOverlay[],
  layerPlan: LayerPlan,
  spec: ThumbnailFormatSpec
): string[] {
  const { width, height } = spec.primary_dimensions;
  const steps: string[] = [
    `Step 1 — Create a new Canva design at ${width} × ${height} px (Custom size). ` +
      `Name it "${req.song_title} — ${format}".`,

    `Step 2 — Background layer: Upload or generate the background image using the prompt below. ` +
      `Place it as the lowest layer. ` +
      `${layerPlan.background.type === 'ai_image' ? 'Use Canva AI Image Generator or upload an externally generated image.' : 'Export a still frame from the winning scene video and upload it.'}`,

    `Step 3 — Add subject overlay: ${layerPlan.subject?.description ?? 'Place your main subject image centered on the canvas.'}. ` +
      `Set blend mode to "${layerPlan.subject?.blend_mode ?? 'normal'}", opacity ${layerPlan.subject?.opacity ?? 95}%.`,

    `Step 4 — Add color gradient overlay: In Canva, use "Elements → Gradient" or add a rectangle element. ` +
      `Set gradient: ${layerPlan.color_overlay?.value ?? 'dark-to-transparent, bottom-to-top'}. ` +
      `Set opacity to ${layerPlan.color_overlay?.opacity ?? 70}%.`,

    ...textOverlays.map((t, i) =>
      `Step ${5 + i} — Text layer "${t.layer_name}": ` +
      `Click "Text" → "Add a text box". ` +
      `Type: "${t.text}". ` +
      `Font: ${t.font_hint}, weight ${t.weight}, size hint ${t.size_hint}. ` +
      `Color: ${t.color}, opacity ${t.opacity}%. ` +
      `Position: ${t.position}, alignment ${t.alignment}. ` +
      `Offset from edge: ${JSON.stringify(t.safe_zone_offset)}. ` +
      (t.shadow ? `Add drop shadow: ${t.shadow}. ` : '') +
      (t.stroke ? `Add text stroke: ${t.stroke}.` : '')
    ),

    `Step ${5 + textOverlays.length} — Apply effects: ${layerPlan.effects.join(' | ')}`,

    `Step ${6 + textOverlays.length} — Safe zone check: ${spec.safe_zone_guide}. ` +
      `Use Canva's ruler guides or "Show guides" to verify no key elements are in the unsafe area.`,

    `Step ${7 + textOverlays.length} — Export: ` +
      spec.export_targets
        .map(
          (t: ExportTarget) =>
            `Download → ${t.format} → Custom size ${t.width}×${t.height} → save as "${t.filename}"`
        )
        .join('; then ') +
      '.',
  ];

  return steps;
}

// ─── Per-format brief builders ─────────────────────────────────────────────────

function buildBrief(req: ThumbnailBriefRequest, format: ThumbnailFormat): ThumbnailBrief {
  const spec = FORMAT_SPECS[format];
  const now = new Date().toISOString();

  const baseOverlays: TextOverlay[] = [
    buildTitleOverlay(req),
    buildSubtitleOverlay(req),
    buildMoodLabel(req),
  ];
  const ctaOverlay = buildCtaOverlay(req);
  if (ctaOverlay) baseOverlays.push(ctaOverlay);

  const layerPlan = buildLayerPlan(req, baseOverlays);
  const aiImagePrompt = buildAiImagePrompt(req, format);
  const guideSteps = buildCanvaGuideSteps(req, format, baseOverlays, layerPlan, spec);

  return {
    format,
    spec,
    text_overlays: baseOverlays,
    layer_plan: layerPlan,
    ai_image_prompt: aiImagePrompt,
    canva_guide_steps: guideSteps,
    export_targets: spec.export_targets,
    created_at: now,
  };
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Build ThumbnailBrief objects for every requested format.
 *
 * @param req - All project-level inputs
 * @returns   Map of format → ThumbnailBrief (only for requested formats)
 */
export function buildThumbnailBriefs(
  req: ThumbnailBriefRequest
): Map<ThumbnailFormat, ThumbnailBrief> {
  const formats = req.formats ?? ALL_FORMATS;
  const result = new Map<ThumbnailFormat, ThumbnailBrief>();

  for (const format of formats) {
    result.set(format, buildBrief(req, format));
  }

  return result;
}

/**
 * Build a single brief for the given format.
 * Useful when only one format needs regenerating.
 */
export function buildThumbnailBrief(
  req: ThumbnailBriefRequest,
  format: ThumbnailFormat
): ThumbnailBrief {
  return buildBrief(req, format);
}

/**
 * Render a brief's canva_guide_steps as a markdown document.
 */
export function renderCanvaGuideMarkdown(brief: ThumbnailBrief, req: ThumbnailBriefRequest): string {
  const { width, height } = brief.spec.primary_dimensions;
  const lines: string[] = [
    `# Canva Thumbnail Guide — ${req.song_title}`,
    ``,
    `**Format:** ${brief.format} (${width} × ${height})`,
    `**Theme:** ${req.devotional_theme}`,
    `**Mood:** ${req.audio_mood}`,
    `**Generated:** ${brief.created_at}`,
    ``,
    `---`,
    ``,
    `## Color Palette`,
    ``,
    `| Role | Color |`,
    `|------|-------|`,
    `| Primary (title) | \`${req.primary_color}\` |`,
    `| Accent (subtitle) | \`${req.accent_color}\` |`,
    `| Neutral (light text / overlay) | \`${req.neutral_color}\` |`,
    ``,
    `## Font Stack`,
    ``,
    `1. **Title:** ${req.font_stack[0]}`,
    `2. **Subtitle:** ${req.font_stack[1]}`,
    `3. **Caption / CTA:** ${req.font_stack[2]}`,
    ``,
    `---`,
    ``,
    `## AI Image Prompt`,
    ``,
    `> ${brief.ai_image_prompt}`,
    ``,
    `---`,
    ``,
    `## Safe Zone`,
    ``,
    `${brief.spec.safe_zone_guide}`,
    ``,
    `---`,
    ``,
    `## Layer Plan`,
    ``,
    `**Stacking order (bottom → top):**`,
    ``,
    ...brief.layer_plan.stacking_order.map((name, i) => `${i + 1}. ${name}`),
    ``,
    `---`,
    ``,
    `## Step-by-Step Canva Instructions`,
    ``,
    ...brief.canva_guide_steps.map((step) => `- ${step}`),
    ``,
    `---`,
    ``,
    `## Export Targets`,
    ``,
    `| Filename | Format | Size | Platform |`,
    `|----------|--------|------|----------|`,
    ...brief.export_targets.map(
      (t: ExportTarget) =>
        `| \`${t.filename}\` | ${t.format} | ${t.width}×${t.height} | ${t.platform} |`
    ),
    ``,
  ];

  return lines.join('\n');
}

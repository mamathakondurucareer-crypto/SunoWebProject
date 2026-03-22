/**
 * Gemini devotional-package parser.
 *
 * Two-mode parsing strategy:
 *   1. Prose — extract data from `=== SECTION NAME ===` delimited blocks.
 *   2. JSON  — if the response contains a <<<JSON_START>>> / <<<JSON_END>>> block
 *              (or legacy ```json ... ```), its fields take precedence; any missing
 *              fields are filled from prose.
 *
 * Returns a {@link GeminiParseResult} with `success: false` when any
 * {@link CRITICAL_RULES} are violated, even if partial data was extracted.
 */

import type {
  GeminiParsedOutput,
  GeminiParseResult,
  LyricSection,
  LyricSectionType,
  ScenePlan,
  ThumbnailConcept,
  ShortContent,
  ReelContent,
  SeoMetadata,
  RiskReview,
  RiskLevel,
  CompletenessAudit,
  ParseSource,
} from './types';
import { GeminiParsedOutputSchema, CRITICAL_RULES, WARN_RULES } from './schema';

// ─── Section extraction ───────────────────────────────────────────────────────

/**
 * Split `=== SECTION NAME ===` delimited text into a normalised map.
 * Keys are UPPER-CASE with spaces preserved, e.g. "SCENE PLAN".
 */
function extractSections(raw: string): Map<string, string> {
  const result = new Map<string, string>();
  const parts = raw.split(/^(===\s*[^=\n]+?\s*===)\s*$/m);
  for (let i = 1; i < parts.length - 1; i += 2) {
    const headerMatch = parts[i].match(/===\s*(.+?)\s*===/);
    if (!headerMatch) continue;
    const key     = headerMatch[1].trim().toUpperCase();
    const content = (parts[i + 1] ?? '').trim();
    result.set(key, content);
  }
  return result;
}

/** Return the value from the section map using a set of candidate key names. */
function getSection(map: Map<string, string>, ...candidates: string[]): string {
  for (const key of candidates) {
    const val = map.get(key.toUpperCase());
    if (val !== undefined) return val;
  }
  return '';
}

// ─── JSON block extraction ────────────────────────────────────────────────────

/**
 * Find and parse the JSON block from the response.
 * Tries <<<JSON_START>>> / <<<JSON_END>>> delimiters first (new format),
 * then falls back to ```json ... ``` code blocks (legacy format).
 * Returns null if none found or JSON is malformed.
 */
function extractJsonBlock(text: string): Record<string, unknown> | null {
  // Primary: <<<JSON_START>>> / <<<JSON_END>>> delimiters (new format)
  const newMatch = text.match(/<<<JSON_START>>>\s*([\s\S]*?)\s*<<<JSON_END>>>/);
  if (newMatch) {
    try { return JSON.parse(newMatch[1].trim()) as Record<string, unknown>; } catch { /* fall through */ }
  }
  // Fallback: ```json ... ``` code blocks (legacy format)
  const codeMatches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (codeMatches.length === 0) return null;
  try {
    return JSON.parse(codeMatches[codeMatches.length - 1][1].trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Lyric section parsing ────────────────────────────────────────────────────

const SECTION_LABEL_PATTERNS: Array<[RegExp, LyricSectionType]> = [
  [/^pre.?chorus/i, 'pre-chorus'],
  [/^chorus/i,      'chorus'],
  [/^verse/i,       'verse'],
  [/^bridge/i,      'bridge'],
  [/^outro/i,       'outro'],
  [/^intro/i,       'intro'],
  [/^hook/i,        'hook'],
];

function classifyLabel(label: string): LyricSectionType {
  for (const [pattern, type] of SECTION_LABEL_PATTERNS) {
    if (pattern.test(label)) return type;
  }
  return 'unknown';
}

/**
 * Parse a lyric text block into labelled sections.
 *
 * Recognises labels in these forms:
 *   [Verse 1]   Verse 1:   CHORUS   (Chorus)
 */
function parseLyricSections(text: string): LyricSection[] {
  const sections: LyricSection[] = [];
  const lines = text.split('\n');

  let current: LyricSection | null = null;

  const headerRe =
    /^\s*[\[(]?\s*((?:pre.?chorus|chorus|verse|bridge|outro|intro|hook)(?:\s+\d+)?)\s*[)\]:]?\s*$/i;

  for (const line of lines) {
    const trimmed = line.trim();
    const headerMatch = trimmed.match(headerRe);

    if (headerMatch) {
      if (current && current.lines.length > 0) sections.push(current);
      const label = headerMatch[1].trim();
      current = { label, type: classifyLabel(label), lines: [] };
    } else if (trimmed) {
      if (!current) {
        current = { label: 'Opening', type: 'unknown', lines: [] };
      }
      current.lines.push(trimmed);
    }
  }

  if (current && current.lines.length > 0) sections.push(current);
  return sections;
}

// ─── Scene plan parsing ───────────────────────────────────────────────────────

/** Null-filled defaults for new ScenePlan fields (used in prose parsing) */
const SCENE_DEFAULTS = {
  capcut_motion: null,
  crop_notes: null,
  negative_prompts: null,
} as const;

/**
 * Parse scene descriptions from text.
 *
 * Accepts the two-line SCENE CONCEPT format:
 *   SCENE CONCEPT N (Xs-Ys): [visual description]
 *   SCENE CONCEPT N — GROK TEXT TO VIDEO PROMPT SEED: [seed prompt]
 *
 * Also accepts legacy formats:
 *   Scene 1 (0-10s): description
 *   1. description
 *   - description
 */
function parseScenePlan(text: string): ScenePlan[] {
  const scenes: ScenePlan[] = [];
  const lines = text.split('\n').filter(l => l.trim());

  const sceneConceptRe = /^SCENE\s+CONCEPT\s+(\d+)\s*(?:\((\d+)\s*[-–]\s*(\d+)\s*s?\))?\s*:\s*(.+)/i;
  const grokSeedRe     = /^SCENE\s+CONCEPT\s+(\d+)\s*[-–]\s*GROK\s+TEXT\s+TO\s+VIDEO\s+PROMPT\s+SEED\s*:\s*(.+)/i;
  const sceneRe        = /^(?:Scene\s+)?(\d+)\.?\s*(?:\((\d+)\s*[-–]\s*(\d+)\s*s?\))?\s*:?\s*(.+)/i;
  const bulletRe       = /^[-•*]\s+(.+)/;

  const seedMap = new Map<number, string>();

  for (const line of lines) {
    const trimmed = line.trim();
    const grokMatch = trimmed.match(grokSeedRe);
    if (grokMatch) seedMap.set(parseInt(grokMatch[1]), grokMatch[2].trim());
  }

  let autoNum = 1;

  for (const line of lines) {
    const trimmed = line.trim();

    if (grokSeedRe.test(trimmed)) continue;

    const conceptMatch = trimmed.match(sceneConceptRe);
    if (conceptMatch) {
      const num   = parseInt(conceptMatch[1]);
      const start = conceptMatch[2] != null ? parseInt(conceptMatch[2]) : null;
      const end   = conceptMatch[3] != null ? parseInt(conceptMatch[3]) : null;
      const desc  = conceptMatch[4].trim();
      const notesMatch = desc.match(/^(.*?)\s*\(([^)]{10,})\)\s*$/);
      scenes.push({
        scene_number: num,
        start_seconds: start,
        end_seconds: end,
        description: notesMatch ? notesMatch[1].trim() : desc,
        visual_notes: notesMatch ? notesMatch[2].trim() : null,
        grok_text_to_video_prompt_seed: seedMap.get(num) ?? null,
        ...SCENE_DEFAULTS,
      });
      autoNum = num + 1;
      continue;
    }

    const sceneMatch = trimmed.match(sceneRe);
    if (sceneMatch) {
      const num   = parseInt(sceneMatch[1]);
      const start = sceneMatch[2] != null ? parseInt(sceneMatch[2]) : null;
      const end   = sceneMatch[3] != null ? parseInt(sceneMatch[3]) : null;
      const desc  = sceneMatch[4].trim();
      const notesMatch = desc.match(/^(.*?)\s*\(([^)]{10,})\)\s*$/);
      scenes.push({
        scene_number: num,
        start_seconds: start,
        end_seconds: end,
        description: notesMatch ? notesMatch[1].trim() : desc,
        visual_notes: notesMatch ? notesMatch[2].trim() : null,
        grok_text_to_video_prompt_seed: seedMap.get(num) ?? null,
        ...SCENE_DEFAULTS,
      });
      autoNum = num + 1;
      continue;
    }

    const bulletMatch = trimmed.match(bulletRe);
    if (bulletMatch) {
      scenes.push({
        scene_number: autoNum++,
        start_seconds: null,
        end_seconds: null,
        description: bulletMatch[1].trim(),
        visual_notes: null,
        grok_text_to_video_prompt_seed: null,
        ...SCENE_DEFAULTS,
      });
    }
  }

  return scenes;
}

// ─── Thumbnail parsing ────────────────────────────────────────────────────────

function parseThumbnailConcepts(text: string): ThumbnailConcept[] {
  const concepts: ThumbnailConcept[] = [];
  const lines = text.split('\n').filter(l => l.trim());

  const numberedRe = /^(?:Thumbnail\s+)?(\d+)\.?\s*:?\s*(.+)/i;
  const bulletRe   = /^[-•*]\s+(.+)/;
  let autoNum = 1;

  for (const line of lines) {
    const trimmed = line.trim();
    const numMatch = trimmed.match(numberedRe);
    if (numMatch) {
      concepts.push({ concept_number: parseInt(numMatch[1]), type: null, description: numMatch[2].trim() });
      autoNum = parseInt(numMatch[1]) + 1;
      continue;
    }
    const bulletMatch = trimmed.match(bulletRe);
    if (bulletMatch) {
      concepts.push({ concept_number: autoNum++, type: null, description: bulletMatch[1].trim() });
    }
  }

  if (concepts.length === 0) {
    lines.forEach((line, i) => {
      const desc = line.trim().replace(/^[-•*]\s*/, '');
      if (desc) concepts.push({ concept_number: i + 1, type: null, description: desc });
    });
  }

  return concepts;
}

// ─── SEO metadata parsing ─────────────────────────────────────────────────────

/** Return an empty SeoMetadata with all required fields initialised. */
function emptySeoMetadata(): SeoMetadata {
  return {
    title: '',
    description: '',
    tags: [],
    hashtags: [],
    main_titles: [],
    shorts_titles: [],
    reels_hooks: [],
    shorts_description_template: '',
    reels_description_template: '',
    keyword_clusters: [],
    tags_secondary: [],
    link_template_placeholders: [],
    seo_rationale: '',
  };
}

function parseSeoMetadata(text: string): SeoMetadata {
  const getLine = (key: string): string => {
    const re = new RegExp(`^${key}\\s*:\\s*(.+)`, 'mi');
    return text.match(re)?.[1]?.trim() ?? '';
  };

  const tagsRaw     = getLine('Tags');
  const hashtagsRaw = getLine('Hashtags');

  const tags = tagsRaw
    ? tagsRaw.split(/[,;]\s*/).map(t => t.replace(/^#/, '').trim()).filter(Boolean)
    : [];

  const hashtagsFromLine = hashtagsRaw ? (hashtagsRaw.match(/#\w+/g) ?? []) : [];
  const hashtagsFromTags = tagsRaw     ? (tagsRaw.match(/#\w+/g) ?? [])     : [];
  const hashtags = [...new Set([...hashtagsFromLine, ...hashtagsFromTags])];

  return {
    ...emptySeoMetadata(),
    title: getLine('Title'),
    description: getLine('Description'),
    tags: tags.filter(t => !t.startsWith('#')),
    hashtags,
  };
}

// ─── Risk review parsing ──────────────────────────────────────────────────────

function parseRiskReview(text: string): RiskReview {
  const getLine = (key: string): string | null => {
    const re = new RegExp(`^${key}\\s*:\\s*(.+)`, 'mi');
    return text.match(re)?.[1]?.trim() ?? null;
  };

  const riskRaw = (getLine('Overall Risk') ?? getLine('Overall') ?? '').toLowerCase();
  let overall_risk: RiskLevel = 'unknown';
  if (riskRaw.includes('low'))         overall_risk = 'low';
  else if (riskRaw.includes('high'))   overall_risk = 'high';
  else if (riskRaw.includes('medium')) overall_risk = 'medium';

  return {
    doctrinal_accuracy:   getLine('Doctrinal Accuracy') ?? text.substring(0, 200).trim(),
    copyright_notes:      getLine('Copyright Notes') ?? getLine('Copyright'),
    language_sensitivity: getLine('Language Sensitivity') ?? getLine('Language'),
    overall_risk,
    manual_review_notes:  null,
    strict_risk_gate:     null,
  };
}

// ─── CTA parsing ─────────────────────────────────────────────────────────────

function parseCtas(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.replace(/^[\d]+\.\s*|^[-•*]\s*/, '').trim())
    .filter(Boolean);
}

// ─── Completeness audit ───────────────────────────────────────────────────────

function buildCompletenessAudit(p: GeminiParsedOutput): CompletenessAudit {
  const checks = [
    { key: 'has_lyrics'           as const, name: 'Lyrics',                ok: p.lyrics_raw.trim().length > 0 },
    { key: 'has_style'            as const, name: 'Style Notes',           ok: p.style_notes.trim().length > 0 },
    { key: 'has_vocal_guidance'   as const, name: 'Vocal Guidance',        ok: p.vocal_guidance.trim().length > 0 },
    { key: 'has_suno_prompt'      as const, name: 'Suno Prompt',           ok: p.suno_style_prompt.trim().length > 0 },
    { key: 'has_scene_plan'       as const, name: 'Scene Plan',            ok: p.scene_plan.length > 0 },
    { key: 'has_thumbnails'       as const, name: 'Thumbnails',            ok: p.thumbnail_concepts.length > 0 },
    { key: 'has_seo'              as const, name: 'SEO Metadata',          ok: p.seo.title.length > 0 },
    { key: 'has_cta'              as const, name: 'Shorts/Reels CTA',      ok: p.shorts_reels_cta.length > 0 },
    { key: 'has_risk_review'      as const, name: 'Risk Review',           ok: p.risk_review.overall_risk !== 'unknown' },
    { key: 'has_dual_lyrics'      as const, name: 'Dual-Language Lyrics',  ok: p.lyrics_hindi_devanagari.trim().length > 0 && p.lyrics_english.trim().length > 0 },
    { key: 'has_english_suno_prompt' as const, name: 'English Suno Prompt', ok: p.suno_prompt_english.trim().length > 0 },
    { key: 'has_shorts'           as const, name: 'Shorts Content',        ok: p.shorts.length > 0 },
    { key: 'has_reels'            as const, name: 'Reels Content',         ok: p.reels.length > 0 },
    { key: 'has_compliance_plan'  as const, name: 'Compliance Plan',       ok: p.compliance_plan !== null },
  ];

  const missing = checks.filter(c => !c.ok).map(c => c.name);
  const score   = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);

  return {
    has_lyrics:              checks[0].ok,
    has_style:               checks[1].ok,
    has_vocal_guidance:      checks[2].ok,
    has_suno_prompt:         checks[3].ok,
    has_scene_plan:          checks[4].ok,
    has_thumbnails:          checks[5].ok,
    has_seo:                 checks[6].ok,
    has_cta:                 checks[7].ok,
    has_risk_review:         checks[8].ok,
    has_dual_lyrics:         checks[9].ok,
    has_english_suno_prompt: checks[10].ok,
    has_shorts:              checks[11].ok,
    has_reels:               checks[12].ok,
    has_compliance_plan:     checks[13].ok,
    scene_concept_count:     p.scene_plan.length,
    shorts_count:            p.shorts.length,
    reels_count:             p.reels.length,
    titles_main_count:       p.seo.main_titles.length,
    titles_shorts_count:     p.seo.shorts_titles.length,
    titles_reels_count:      p.seo.reels_hooks.length,
    ctas_count:              p.shorts_reels_cta.length,
    missing,
    score,
  };
}

// ─── JSON overlay ─────────────────────────────────────────────────────────────

/**
 * Map a new-format pre_audio_package.package object onto a GeminiParsedOutput draft.
 * The new JSON structure is the one produced by the full DEVOTIONAL_PROMPT_TEMPLATE.
 */
function applyNewFormatOverlay(
  draft: GeminiParsedOutput,
  pkg: Record<string, unknown>
): { output: GeminiParsedOutput; source: ParseSource } {
  const updated: GeminiParsedOutput = { ...draft };

  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null;

  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];

  // ── song_title ──────────────────────────────────────────────────────────────
  const titleFamily = pkg['title_family'] as Record<string, unknown> | undefined;
  const master = str(titleFamily?.['master']);
  if (master) updated.song_title = master;

  // ── dual lyrics ─────────────────────────────────────────────────────────────
  const lyrics = pkg['lyrics'] as Record<string, unknown> | undefined;
  const hindiLyrics   = str(lyrics?.['hindi_devanagari']) ?? '';
  const englishLyrics = str(lyrics?.['english']) ?? '';
  if (hindiLyrics) {
    updated.lyrics_hindi_devanagari = hindiLyrics;
    updated.lyrics_raw = hindiLyrics;
    updated.lyric_sections = parseLyricSections(hindiLyrics);
  }
  if (englishLyrics) updated.lyrics_english = englishLyrics;

  // ── suno prompts ────────────────────────────────────────────────────────────
  const sunoHindi   = str(pkg['suno_prompt_hindi']);
  const sunoEnglish = str(pkg['suno_prompt_english']);
  if (sunoHindi)   updated.suno_style_prompt  = sunoHindi;
  if (sunoEnglish) updated.suno_prompt_english = sunoEnglish;

  // ── vocal direction ─────────────────────────────────────────────────────────
  const vocalDir = pkg['vocal_direction'] as Record<string, unknown> | undefined;
  if (vocalDir) {
    updated.vocal_guidance = [
      vocalDir['hindi']   ? `Hindi: ${vocalDir['hindi']}`   : '',
      vocalDir['english'] ? `English: ${vocalDir['english']}` : '',
    ].filter(Boolean).join(' | ');
  }

  // ── style notes ─────────────────────────────────────────────────────────────
  const styleParts = [
    str(pkg['instrumentation']),
    str(pkg['genre_match_reason']),
  ].filter(Boolean);
  if (styleParts.length > 0) updated.style_notes = styleParts.join('. ');

  // ── background ──────────────────────────────────────────────────────────────
  const bgParts = [
    str(pkg['scriptural_inspiration_category']),
    str(pkg['story_topic_type']),
    str(pkg['emotional_arc']),
  ].filter(Boolean);
  if (bgParts.length > 0) updated.background = bgParts.join(' | ');

  // ── opening 10s plan ────────────────────────────────────────────────────────
  const opening = str(pkg['opening_10_seconds_plan']);
  if (opening) updated.opening_10_seconds_plan = opening;

  // ── capcut plan ─────────────────────────────────────────────────────────────
  const capcutPlan = str(pkg['capcut_plan']);
  if (capcutPlan) updated.capcut_plan = capcutPlan;

  // ── scene concepts → scene_plan ─────────────────────────────────────────────
  const concepts = pkg['pre_audio_scene_concepts'];
  if (Array.isArray(concepts) && concepts.length > 0) {
    updated.scene_plan = (concepts as Array<Record<string, unknown>>).map(c => {
      // crop_notes sub-object
      const cropRaw = c['crop_notes'] as Record<string, unknown> | undefined;
      const cropNotes = cropRaw
        ? {
            '16:9': str(cropRaw['16:9']) ?? str(cropRaw['landscape']),
            '9:16': str(cropRaw['9:16']) ?? str(cropRaw['portrait']),
            '1:1':  str(cropRaw['1:1'])  ?? str(cropRaw['square']),
          }
        : null;

      // negative_prompts
      const negRaw = c['negative_prompts'];
      const negPrompts: string[] | null = Array.isArray(negRaw)
        ? negRaw.filter((x): x is string => typeof x === 'string')
        : str(negRaw) ? [str(negRaw) as string]
        : null;

      return {
        scene_number:   typeof c['scene_concept_number'] === 'number' ? c['scene_concept_number'] : 0,
        start_seconds:  null,
        end_seconds:    null,
        description:    str(c['section']) ?? str(c['description']) ?? 'scene',
        visual_notes:   str(c['visual_notes']),
        grok_text_to_video_prompt_seed: str(c['grok_text_to_video_prompt_seed']),
        capcut_motion:  str(c['capcut_motion']),
        crop_notes:     cropNotes,
        negative_prompts: negPrompts,
      } satisfies ScenePlan;
    });
  }

  // ── thumbnails ──────────────────────────────────────────────────────────────
  const thumbs = pkg['thumbnails'];
  if (Array.isArray(thumbs) && thumbs.length > 0) {
    updated.thumbnail_concepts = (thumbs as Array<Record<string, unknown>>).map(t => ({
      concept_number: typeof t['thumbnail_number'] === 'number' ? t['thumbnail_number'] : 0,
      type:           str(t['type']),
      description:    str(t['prompt']) ?? str(t['description']) ?? '',
    } satisfies ThumbnailConcept));
  }

  // ── shorts ──────────────────────────────────────────────────────────────────
  const shortsRaw = pkg['shorts'];
  if (Array.isArray(shortsRaw) && shortsRaw.length > 0) {
    updated.shorts = (shortsRaw as Array<Record<string, unknown>>).map((s, i) => ({
      short_number: typeof s['short_number'] === 'number' ? s['short_number'] : i + 1,
      hook:         str(s['hook'])         ?? '',
      visual_plan:  str(s['visual_plan'])  ?? '',
      caption:      str(s['caption'])      ?? '',
      cta:          str(s['cta'])          ?? '',
    } satisfies ShortContent));
  }

  // ── reels ───────────────────────────────────────────────────────────────────
  const reelsRaw = pkg['reels'];
  if (Array.isArray(reelsRaw) && reelsRaw.length > 0) {
    updated.reels = (reelsRaw as Array<Record<string, unknown>>).map((r, i) => ({
      reel_number:  typeof r['reel_number'] === 'number' ? r['reel_number'] : i + 1,
      hook:         str(r['hook'])         ?? '',
      visual_plan:  str(r['visual_plan'])  ?? '',
      caption:      str(r['caption'])      ?? '',
      cta:          str(r['cta'])          ?? '',
    } satisfies ReelContent));
  }

  // ── redirect CTAs ───────────────────────────────────────────────────────────
  const ctas = pkg['redirect_ctas'];
  if (Array.isArray(ctas) && ctas.length > 0) {
    updated.shorts_reels_cta = ctas.filter((c): c is string => typeof c === 'string');
  }

  // ── SEO ──────────────────────────────────────────────────────────────────────
  const seo = pkg['seo'] as Record<string, unknown> | undefined;
  if (seo) {
    const mainTitles   = strArr(seo['main_titles']);
    const shortsTitles = strArr(seo['shorts_titles']);
    const reelsHooks   = strArr(seo['reels_hooks']);

    const title    = mainTitles[0] ?? updated.seo.title;
    const mainDesc = str(seo['main_description']) ?? updated.seo.description;

    // keyword_clusters: array of arrays OR array of comma-joined strings
    const clustersRaw = seo['keyword_clusters'];
    const keywordClusters: string[][] = Array.isArray(clustersRaw)
      ? clustersRaw.map(c =>
          Array.isArray(c) ? c.filter((x): x is string => typeof x === 'string')
          : typeof c === 'string' ? c.split(/[,;]\s*/).map(t => t.trim()).filter(Boolean)
          : []
        )
      : updated.seo.keyword_clusters;

    // flat tags from first cluster
    const tags = keywordClusters.flat();

    // hashtags_limited string
    const hashtagsRaw = str(seo['hashtags_limited']) ?? '';
    const hashtags = hashtagsRaw.match(/#\w+/g) ?? updated.seo.hashtags;

    updated.seo = {
      title,
      description: mainDesc,
      tags,
      hashtags,
      main_titles:                  mainTitles,
      shorts_titles:                shortsTitles,
      reels_hooks:                  reelsHooks,
      shorts_description_template:  str(seo['shorts_description_template']) ?? '',
      reels_description_template:   str(seo['reels_description_template']) ?? '',
      keyword_clusters:             keywordClusters,
      tags_secondary:               strArr(seo['tags_secondary']),
      link_template_placeholders:   strArr(seo['link_template_placeholders']),
      seo_rationale:                str(seo['seo_rationale']) ?? '',
    };
  }

  // ── compliance plan ─────────────────────────────────────────────────────────
  const complianceRaw = pkg['compliance_plan'] as Record<string, unknown> | undefined;
  if (complianceRaw) {
    const gatesRaw = complianceRaw['gates'];
    const gates = Array.isArray(gatesRaw)
      ? (gatesRaw as Array<Record<string, unknown>>).map(g => ({
          gate:   str(g['gate'])  ?? '',
          name:   str(g['name'])  ?? '',
          passed: g['passed'] === true,
          notes:  str(g['notes']),
        }))
      : [];
    updated.compliance_plan = {
      gates,
      all_passed: gates.every(g => g.passed),
      summary: str(complianceRaw['summary']),
    };
  }

  // ── risk review ─────────────────────────────────────────────────────────────
  const riskGate = pkg['strict_risk_gate_result'] as Record<string, unknown> | undefined;
  const manualNotes = str(pkg['commercial_risk_review_manual_notes']);
  if (riskGate) {
    const gateResultsRaw = riskGate['gate_results'] as Record<string, unknown> | undefined;
    const gateResults: Record<string, boolean> = {};
    if (gateResultsRaw) {
      for (const [k, v] of Object.entries(gateResultsRaw)) {
        gateResults[k] = v === true;
      }
    }
    updated.risk_review = {
      doctrinal_accuracy:   manualNotes ?? 'See manual review notes',
      copyright_notes:      null,
      language_sensitivity: null,
      overall_risk:         riskGate['all_low'] === true && riskGate['approved'] === true ? 'low' : 'medium',
      manual_review_notes:  manualNotes,
      strict_risk_gate: {
        all_low:      riskGate['all_low'] === true,
        approved:     riskGate['approved'] === true,
        gate_results: gateResults,
      },
    };
  } else if (manualNotes) {
    updated.risk_review = { ...updated.risk_review, manual_review_notes: manualNotes };
  }

  return { output: updated, source: 'json' };
}

/**
 * Given a parsed prose draft and an extracted JSON block, overlay any
 * top-level string / array fields that are present and non-empty in the JSON.
 * Handles both the new pre_audio_package nested format and the legacy flat format.
 * Marks `source` as 'json' if the JSON provided significant coverage, else 'mixed'.
 */
function applyJsonOverlay(
  draft: GeminiParsedOutput,
  json: Record<string, unknown>
): { output: GeminiParsedOutput; source: ParseSource } {
  // Detect new format (has pre_audio_package key)
  const pkg = (json['pre_audio_package'] as Record<string, unknown> | undefined)
               ?.['package'] as Record<string, unknown> | undefined;
  if (pkg) {
    return applyNewFormatOverlay(draft, pkg);
  }

  // ── Legacy flat format ───────────────────────────────────────────────────────
  const getString = (k: string): string | null => {
    const v = json[k];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const getArray = <T>(k: string): T[] | null => {
    const v = json[k];
    return Array.isArray(v) && v.length > 0 ? (v as T[]) : null;
  };

  let jsonFieldsUsed = 0;

  const updated: GeminiParsedOutput = { ...draft };

  const applyStr = (field: keyof GeminiParsedOutput, key: string) => {
    const v = getString(key);
    if (v) { (updated as unknown as Record<string, unknown>)[field] = v; jsonFieldsUsed++; }
  };

  applyStr('song_title',        'song_title');
  applyStr('lyrics_raw',        'lyrics_raw');
  applyStr('style_notes',       'style_notes');
  applyStr('vocal_guidance',    'vocal_guidance');
  applyStr('suno_style_prompt', 'suno_style_prompt');
  applyStr('background',        'background');

  const jsonScenes = getArray<ScenePlan>('scene_plan');
  if (jsonScenes) { updated.scene_plan = jsonScenes; jsonFieldsUsed++; }

  const jsonThumbs = getArray<ThumbnailConcept>('thumbnail_concepts');
  if (jsonThumbs) { updated.thumbnail_concepts = jsonThumbs; jsonFieldsUsed++; }

  const jsonCtas = getArray<string>('shorts_reels_cta');
  if (jsonCtas) { updated.shorts_reels_cta = jsonCtas; jsonFieldsUsed++; }

  if (updated.lyrics_raw !== draft.lyrics_raw) {
    updated.lyric_sections = parseLyricSections(updated.lyrics_raw);
  }

  const jsonSeo = json['seo'] as Record<string, unknown> | undefined;
  if (jsonSeo && typeof jsonSeo === 'object') {
    updated.seo = { ...parseSeoMetadata(''), ...jsonSeo } as SeoMetadata;
    jsonFieldsUsed++;
  }

  const jsonRisk = json['risk_review'] as Record<string, unknown> | undefined;
  if (jsonRisk && typeof jsonRisk === 'object') {
    updated.risk_review = { ...parseRiskReview(''), ...jsonRisk } as RiskReview;
    jsonFieldsUsed++;
  }

  const source: ParseSource = jsonFieldsUsed >= 5 ? 'json' : 'mixed';
  return { output: updated, source };
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse raw Gemini output text into a normalised, validated package.
 *
 * @param raw   - The raw string captured from the Gemini web UI.
 * @returns     - A {@link GeminiParseResult} — always returns, never throws.
 */
export function parseGeminiOutput(raw: string): GeminiParseResult {
  const warnings: string[] = [];

  // ── 1. Extract prose sections ──────────────────────────────────────────────
  const sections = extractSections(raw);

  if (sections.size === 0) {
    warnings.push('No === SECTION === delimiters found — attempting to parse as unstructured text');
  }

  const lyricsRaw      = getSection(sections, 'LYRICS', 'SONG LYRICS', 'LYRIC');
  const styleNotes     = getSection(sections, 'STYLE NOTES', 'STYLE', 'MUSICAL STYLE');
  const vocalGuide     = getSection(sections, 'VOCAL GUIDANCE', 'VOCAL GUIDE', 'PRONUNCIATION');
  const sunoPrompt     = getSection(sections, 'SUNO STYLE PROMPT', 'SUNO PROMPT', 'STYLE PROMPT');
  const background     = getSection(sections, 'BACKGROUND', 'SPIRITUAL BACKGROUND', 'CONTEXT');
  const songTitle      = getSection(sections, 'SONG TITLE', 'TITLE');
  const scenePlanText  = getSection(sections, 'SCENE PLAN', 'SCENES', 'VIDEO SCENES');
  const thumbnailText  = getSection(sections, 'THUMBNAIL CONCEPTS', 'THUMBNAILS', 'THUMBNAIL IDEAS');
  const seoText        = getSection(sections, 'SEO METADATA', 'SEO', 'PLATFORM METADATA', 'METADATA');
  const ctaText        = getSection(sections, 'SHORTS/REELS CTA', 'SHORTS REELS CTA', 'CTA', 'CALLS TO ACTION');
  const riskText       = getSection(sections, 'RISK REVIEW', 'RISK ASSESSMENT', 'RISK');

  // ── 2. Build prose-based draft ─────────────────────────────────────────────
  const lyricSections     = parseLyricSections(lyricsRaw);
  const scenePlan         = parseScenePlan(scenePlanText);
  const thumbnailConcepts = parseThumbnailConcepts(thumbnailText);
  const seo               = parseSeoMetadata(seoText);
  const riskReview        = parseRiskReview(riskText);
  const ctas              = parseCtas(ctaText);

  let draft: GeminiParsedOutput = {
    song_title:              songTitle,
    lyrics_raw:              lyricsRaw,
    lyric_sections:          lyricSections,
    lyrics_hindi_devanagari: '',
    lyrics_english:          '',
    style_notes:             styleNotes,
    vocal_guidance:          vocalGuide,
    suno_style_prompt:       sunoPrompt,
    suno_prompt_english:     '',
    background,
    scene_plan:              scenePlan,
    capcut_plan:             '',
    shorts:                  [],
    reels:                   [],
    thumbnail_concepts:      thumbnailConcepts,
    shorts_reels_cta:        ctas,
    opening_10_seconds_plan: '',
    seo,
    risk_review:             riskReview,
    compliance_plan:         null,
    completeness:            {} as CompletenessAudit, // filled below
    parse_warnings:          [],
    parsed_at:               Date.now(),
    source:                  'prose',
  };

  // ── 3. Overlay JSON block if present ──────────────────────────────────────
  const jsonBlock = extractJsonBlock(raw);
  if (jsonBlock) {
    const { output, source } = applyJsonOverlay(draft, jsonBlock);
    draft = output;
    draft.source = source;
  }

  // ── 4. Completeness audit ─────────────────────────────────────────────────
  draft.completeness = buildCompletenessAudit(draft);

  // ── 5. Warn rules ─────────────────────────────────────────────────────────
  for (const rule of WARN_RULES) {
    if (!rule.check(draft)) {
      warnings.push(rule.message(draft));
    }
  }

  draft.parse_warnings = warnings;

  // ── 6. Zod structural validation ─────────────────────────────────────────
  const zodResult = GeminiParsedOutputSchema.safeParse(draft);
  if (!zodResult.success) {
    const zodErrors = zodResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    return {
      success: false,
      data: draft,
      errors: ['Schema validation failed', ...zodErrors],
      warnings,
    };
  }

  // ── 7. Critical rules ─────────────────────────────────────────────────────
  const criticalErrors: string[] = [];
  for (const rule of CRITICAL_RULES) {
    if (!rule.check(draft)) {
      criticalErrors.push(rule.message(draft));
    }
  }

  if (criticalErrors.length > 0) {
    return { success: false, data: draft, errors: criticalErrors, warnings };
  }

  return { success: true, data: draft, errors: [], warnings };
}

// ─── Re-exports for convenience ───────────────────────────────────────────────

export {
  extractSections,
  parseLyricSections,
  parseScenePlan,
  parseThumbnailConcepts,
  parseSeoMetadata,
  parseRiskReview,
  parseCtas,
  buildCompletenessAudit,
  extractJsonBlock,
};

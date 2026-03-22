/**
 * Prompt builder for the ChatGPT scene prompt refinement module.
 *
 * Single batched request strategy: all scenes are sent in one prompt so that
 * ChatGPT can maintain visual and narrative continuity across the full video.
 */

import type { PromptRefinementInput } from './types';

export const SECTION_DELIMITER = '=== SECTION ===';

// ─── Default visual style guide ───────────────────────────────────────────────

import type { VisualStyleGuide, ContinuityNotes } from './types';

export const DEFAULT_VISUAL_STYLE_GUIDE: VisualStyleGuide = {
  safe_motifs: [
    'temple pillars',
    'oil lamps (diyas)',
    'marigold garlands',
    'folded hands in prayer',
    'sacred river banks',
    'incense smoke wisps',
    'lotus flowers',
    'bells and chimes',
    'devotee silhouettes',
    'golden sunrise/sunset',
  ],
  forbidden_imagery: [
    'violence or conflict',
    'commercial logos or branding',
    'western casual attire',
    'modern urban street scenes',
    'screens or devices',
    'provocative or immodest clothing',
    'horror or dark imagery',
    'political symbols',
  ],
  color_palette: 'warm saffron, gold, deep red, cream, soft ochre — muted cool tones only in bridge/transition scenes',
  lighting_style: 'soft natural light, golden hour warmth, candlelight and diya glow, gentle rim lighting',
  aspect_ratio: '9:16',
  crop_safe_zone: 'center 80% of frame; keep top 5% and bottom 15% clear for caption overlays on mobile',
};

export const DEFAULT_CONTINUITY_NOTES: ContinuityNotes = {
  color_grading: 'warm sepia-gold throughout; only the bridge scene may shift to cooler, more intimate tones',
  transition_style: 'dissolve or cross-fade at scene boundaries; avoid hard cuts except at the final chorus',
  camera_movement_grammar: 'push-in for emotional intensity (chorus, final chorus); pull-out for resolution (outro); static or gentle pan for verse',
  pacing: 'match musical phrase boundaries; each scene covers one complete lyric phrase (~8–12 seconds)',
  opening_anchor: 'Wide exterior establishing shot of temple at dawn — frames the entire spiritual journey',
  closing_anchor: 'Slow dissolve to single diya flame against dark background — calm resolution and peace',
};

// ─── Prompt builder ───────────────────────────────────────────────────────────

/**
 * Build the batched scene-refinement prompt.
 *
 * Sends all scenes in a single request so ChatGPT can reason about continuity
 * across the full video without multiple round-trips.
 */
export function buildPromptRefinementPrompt(input: PromptRefinementInput): string {
  const { song_title, devotional_theme, audio_mood, scenes, visual_bible, continuity_notes } = input;

  const motifs = visual_bible.safe_motifs.join(', ');
  const forbidden = visual_bible.forbidden_imagery.join(', ');
  const aspect = visual_bible.aspect_ratio;

  // Build compact scene table — enough context without being verbose
  const sceneTable = scenes
    .map(s => {
      const num = String(s.scene_number).padStart(2, '0');
      return (
        `Scene ${num} | ${s.start_sec}s–${s.end_sec}s | ${s.section} | energy:${s.energy}\n` +
        `  Lyric: "${s.lyric_excerpt}"\n` +
        `  Seed: ${s.grok_text_to_video_prompt_seed}\n` +
        `  Motion: ${s.capcut_motion} | Crop: ${s.crop_notes}\n` +
        `  Avoid: ${s.negative_prompt}`
      );
    })
    .join('\n\n');

  // Build output template — zero-padded scene numbers
  const outputTemplate = scenes
    .map(s => {
      const num = String(s.scene_number).padStart(2, '0');
      return `${SECTION_DELIMITER} SCENE_${num}_GROK_PROMPT
[2–4 sentence cinematic prompt for Grok]

${SECTION_DELIMITER} SCENE_${num}_DURATION_TARGET
[integer seconds]

${SECTION_DELIMITER} SCENE_${num}_ASPECT_RATIO
[${aspect}]

${SECTION_DELIMITER} SCENE_${num}_CONTINUITY_NOTE
[1 sentence: how this clip connects visually to the scenes before and after]

${SECTION_DELIMITER} SCENE_${num}_VISUAL_EMPHASIS
[1 sentence: the single most important visual element to foreground]

${SECTION_DELIMITER} SCENE_${num}_NEGATIVE_CONSTRAINTS
[comma-separated list of things Grok must NOT include]

${SECTION_DELIMITER} SCENE_${num}_PUBLIC_SAFE_WORDING
[confirm the prompt contains no violence, CSAM, copyrighted characters, or restricted content — or note any adjustments made]`;
    })
    .join('\n\n');

  return `You are a cinematic director and AI video prompt specialist creating Grok generation prompts for a devotional music video.

Your task: refine the seed prompts below into final, production-ready Grok prompts that are:
- Cinematically specific (camera angle, movement, focal point, lighting, atmosphere)
- Visually continuous across the full ${scenes.length}-scene video
- Strictly within the visual bible and continuity rules
- Public-safe for Grok's content policy (no violence, no CSAM, no restricted imagery)

## Song Context
**Title:** ${song_title}
**Theme:** ${devotional_theme}
**Audio mood / style:** ${audio_mood}

## Visual Bible
**Safe motifs (always encouraged):** ${motifs}
**Forbidden imagery (never include):** ${forbidden}
**Color palette:** ${visual_bible.color_palette}
**Lighting style:** ${visual_bible.lighting_style}
**Aspect ratio:** ${aspect}
**Crop safe zone:** ${visual_bible.crop_safe_zone}

## Continuity Rules
**Color grading:** ${continuity_notes.color_grading}
**Transition style:** ${continuity_notes.transition_style}
**Camera movement grammar:** ${continuity_notes.camera_movement_grammar}
**Pacing:** ${continuity_notes.pacing}
**Opening anchor:** ${continuity_notes.opening_anchor}
**Closing anchor:** ${continuity_notes.closing_anchor}

## Scenes (${scenes.length} total)

${sceneTable}

## Your Task

For EVERY scene listed above (scenes 01 through ${String(scenes.length).padStart(2, '0')}):

1. **GROK_PROMPT** — Write a 2–4 sentence cinematic Grok prompt. Include: subject, setting, camera move, lighting, atmosphere, and any key devotional props. Use present-tense descriptive language ("A devotee's hands hold..."). Do NOT include timecodes.
2. **DURATION_TARGET** — Integer seconds matching the scene's time range (end − start), rounded to nearest second.
3. **ASPECT_RATIO** — Use ${aspect} for all scenes unless the visual bible specifies otherwise.
4. **CONTINUITY_NOTE** — One sentence describing the visual handoff to/from adjacent scenes (e.g. "Dissolves from the wide establishing shot of Scene 01").
5. **VISUAL_EMPHASIS** — One sentence naming the single most important visual element to foreground.
6. **NEGATIVE_CONSTRAINTS** — Comma-separated list of what Grok must NOT generate (derive from the scene's "Avoid" list plus the global forbidden imagery list).
7. **PUBLIC_SAFE_WORDING** — Confirm the prompt is public-safe, or briefly note any changes you made to ensure compliance.

Return ONLY the structured output below — no preamble, no commentary outside the sections.

${outputTemplate}`;
}

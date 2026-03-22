/**
 * Prompt builder for the ChatGPT lyrics-correction stage.
 *
 * Detects whether the input lyrics are bilingual (Hindi/Sanskrit + English)
 * or English-only, and generates the appropriate prompt with explicit output
 * format instructions using === SECTION === delimiters.
 */

import type { LyricsCorrectionInput } from './types';

// ─── Language detection ───────────────────────────────────────────────────────

/** Unicode range for Devanagari script (Hindi / Sanskrit / Marathi) */
const DEVANAGARI_RE = /[\u0900-\u097F]/;

/**
 * Returns true when the lyrics contain Devanagari characters, or when the
 * target language explicitly names a language that uses it.
 */
export function isHindiContent(input: LyricsCorrectionInput): boolean {
  if (DEVANAGARI_RE.test(input.lyrics_raw)) return true;
  const lang = input.target_language.toLowerCase();
  return lang.includes('hindi') || lang.includes('sanskrit') || lang.includes('marathi');
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

/**
 * Build the full lyrics-correction prompt for ChatGPT.
 *
 * The prompt is explicitly structured so that the response can be
 * parsed with `parseChatGPTOutput()` in parser.ts.
 */
export function buildLyricsCorrectionPrompt(input: LyricsCorrectionInput): string {
  const bilingual = isHindiContent(input);

  const hindiSection = bilingual
    ? `
=== CORRECTED HINDI LYRICS ===
[Full corrected Hindi / Sanskrit lyrics. Keep all section labels ([Verse 1], [Chorus], etc.)
on their own lines. Do NOT include pronunciation marks inside this block.]
`
    : `
=== CORRECTED HINDI LYRICS ===
N/A — no Hindi content in the input.
`;

  return `You are a devotional music lyrics editor and linguist specialising in ${input.target_language} worship songs.

## TASK
Review the lyrics below and produce a corrected, production-ready version optimised for:
1. Theological accuracy and devotional depth
2. Syllable-count consistency with the intended melody
3. Natural phrasing and poetic quality
4. Compatibility with Suno AI music generation (clean section tags, no pronunciation marks)
${bilingual ? '5. Accuracy of Hindi / Sanskrit text and transliteration' : ''}

## CONTEXT
Song title  : ${input.song_title}
Theme       : ${input.devotional_theme}
Language    : ${input.target_language}${bilingual ? ' (bilingual — Hindi + English)' : ''}
Style       : ${input.style_notes}
Suno prompt : ${input.suno_style_prompt}
Vocal notes : ${input.vocal_guidance}
Background  : ${input.background}

## ORIGINAL LYRICS
${input.lyrics_raw}

---

## REQUIRED OUTPUT FORMAT
You MUST return ALL sections below using EXACTLY the === HEADER === delimiters shown.
Do not skip any section. Do not add extra sections.
${hindiSection}
=== CORRECTED ENGLISH LYRICS ===
[Full corrected English lyrics. Keep all section labels ([Verse 1], [Chorus], etc.)
on their own lines. If the song is Hindi-only, write "N/A" here.]

=== SUNO READY LYRICS ===
[The complete final lyrics formatted for direct paste into Suno.
Rules:
- Section tags on their own line: [Verse 1], [Chorus], [Bridge], [Outro], etc.
- No pronunciation annotations, IPA, or parenthetical notes
- Use the corrected English text (or romanised Hindi if English-only is not appropriate)
- Include every section in order]

=== PRONUNCIATION NOTES ===
[One note per line. Format exactly:
Word: <word or phrase> — <phonetic guide> — <stress note or "n/a">
Example:
Word: Prabhu — PRAB-hoo — stress first syllable
Word: Yeshu — YEH-shoo — soft "sh", no hard "j"
If no pronunciation guidance is needed, write "None."]

=== ISSUES FOUND ===
[Bullet list. Each line: - <description> (severity: low|medium|high) [location: <verse/section or "global">]
Example:
- Syllable count mismatch in [Verse 1] line 2: "anugrah" has 4 syllables but melody needs 3 (severity: high) [location: Verse 1]
- Minor grammar: "His mercy's pour" should be "His mercy pours" (severity: low) [location: Chorus]
If no issues, write "None."]

=== MANUAL REVIEW NOTES ===
[Numbered list of items that require human attention before production.
Example:
1. Confirm theological accuracy of "para-brahm" with the worship leader
2. The bridge modulation may need re-recorded demo before Suno submission
If none, write "None."]
`.trim();
}

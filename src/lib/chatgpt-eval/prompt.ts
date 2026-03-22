/**
 * Prompt builders for the ChatGPT audio evaluation module.
 *
 * Produces the text prompts sent to ChatGPT for per-candidate analysis
 * and cross-candidate comparison.
 */

import type { CandidateEvaluationInput } from './types';

// ─── Section delimiter (must match parser.ts) ─────────────────────────────────

export const SECTION_DELIMITER = '=== SECTION ===';

// ─── Per-Candidate Analysis Prompt ───────────────────────────────────────────

/**
 * Build the prompt for evaluating a single Suno audio candidate.
 *
 * @param input      Candidate metadata and context
 * @param hasAudio   Whether an audio file was successfully uploaded for this candidate
 */
export function buildCandidateAnalysisPrompt(
  input: CandidateEvaluationInput,
  hasAudio: boolean
): string {
  const audioNote = hasAudio
    ? `I have attached the audio file for Candidate ${input.label} above. Please listen carefully before scoring.`
    : `The audio file for Candidate ${input.label} could not be uploaded. Please base your evaluation on the lyrics, style prompt, and any other available context only. Mark audio-dependent scores with lower confidence.`;

  return `You are a professional music evaluator specializing in devotional and spiritual music.

${audioNote}

## Candidate ${input.label} Context

**Song title:** ${input.song_title}
**Duration:** ${input.duration_seconds != null ? `${input.duration_seconds} seconds` : 'unknown'}
**Style prompt used:** ${input.style_prompt}
**Song ID:** ${input.song_id ?? 'not captured'}

**Intended lyrics:**
\`\`\`
${input.intended_lyrics}
\`\`\`

## Your Task

Evaluate this candidate across ALL of the following dimensions. For each dimension, provide:
- A numeric score from 1 (very poor) to 10 (excellent)
- A concise, evidence-based rationale (1–3 sentences)

### Dimensions to score

1. **pronunciation_accuracy** — How accurately are the lyrics pronounced? Are Hindi/Sanskrit words rendered correctly?
2. **lyric_intelligibility** — Can the words be clearly understood throughout the track?
3. **hook_strength** — How compelling is the opening hook in the first ~10 seconds?
4. **chorus_impact** — How emotionally impactful and memorable is the chorus?
5. **musical_quality** — Overall production quality: arrangement, instrumentation, mix.
6. **viral_proxy_score** — A score based ONLY on measurable audio traits that correlate with high engagement: hook arrival time, melodic repetition in chorus, beat consistency, lyric clarity in first 10 seconds, and presence of emotional peak moments. Do NOT predict or claim virality — score only these observable traits.
7. **visual_sync_potential** — How naturally would this track sync with visual cuts every 8–10 seconds for a devotional Reels/Shorts video?

After scoring all dimensions, provide:
- An **overall_score** (weighted composite, 1–10, rounded to one decimal place)
- **notes**: 2–4 sentences of freeform observations about this candidate's distinctive qualities or notable weaknesses

## Required Output Format

Return your response using the exact section headers below. Do not add any text before the first section header.

${SECTION_DELIMITER} OVERALL_SCORE
[number 1-10, e.g. 7.5]

${SECTION_DELIMITER} PRONUNCIATION_ACCURACY_SCORE
[number 1-10]

${SECTION_DELIMITER} PRONUNCIATION_ACCURACY_RATIONALE
[1-3 sentences]

${SECTION_DELIMITER} LYRIC_INTELLIGIBILITY_SCORE
[number 1-10]

${SECTION_DELIMITER} LYRIC_INTELLIGIBILITY_RATIONALE
[1-3 sentences]

${SECTION_DELIMITER} HOOK_STRENGTH_SCORE
[number 1-10]

${SECTION_DELIMITER} HOOK_STRENGTH_RATIONALE
[1-3 sentences]

${SECTION_DELIMITER} CHORUS_IMPACT_SCORE
[number 1-10]

${SECTION_DELIMITER} CHORUS_IMPACT_RATIONALE
[1-3 sentences]

${SECTION_DELIMITER} MUSICAL_QUALITY_SCORE
[number 1-10]

${SECTION_DELIMITER} MUSICAL_QUALITY_RATIONALE
[1-3 sentences]

${SECTION_DELIMITER} VIRAL_PROXY_SCORE
[number 1-10]

${SECTION_DELIMITER} VIRAL_PROXY_RATIONALE
[1-3 sentences — measurable audio traits only, no virality predictions]

${SECTION_DELIMITER} VISUAL_SYNC_POTENTIAL_SCORE
[number 1-10]

${SECTION_DELIMITER} VISUAL_SYNC_POTENTIAL_RATIONALE
[1-3 sentences]

${SECTION_DELIMITER} NOTES
[2-4 sentences of freeform observations]
`;
}

// ─── Cross-Candidate Comparison Prompt ───────────────────────────────────────

/**
 * Build the prompt that asks ChatGPT to compare both candidates and pick a winner.
 *
 * @param inputA  Candidate A context
 * @param inputB  Candidate B context
 * @param hasAudioA  Whether candidate A audio was uploaded
 * @param hasAudioB  Whether candidate B audio was uploaded
 */
export function buildComparisonPrompt(
  inputA: CandidateEvaluationInput,
  inputB: CandidateEvaluationInput,
  hasAudioA: boolean,
  hasAudioB: boolean
): string {
  const audioStatus = [
    hasAudioA ? 'Candidate A audio: ✓ uploaded' : 'Candidate A audio: ✗ not available',
    hasAudioB ? 'Candidate B audio: ✓ uploaded' : 'Candidate B audio: ✗ not available',
  ].join('\n');

  return `You are a professional music evaluator specializing in devotional and spiritual music.
You have already evaluated both Suno audio candidates individually. Now compare them side by side.

## Audio Availability
${audioStatus}

## Candidate A
- Title: ${inputA.song_title}
- Duration: ${inputA.duration_seconds != null ? `${inputA.duration_seconds}s` : 'unknown'}
- Style: ${inputA.style_prompt}

## Candidate B
- Title: ${inputB.song_title}
- Duration: ${inputB.duration_seconds != null ? `${inputB.duration_seconds}s` : 'unknown'}
- Style: ${inputB.style_prompt}

## Your Task

Compare both candidates and recommend the stronger one for a devotional Reels/Shorts video.
Base your decision on the seven evaluation dimensions you scored: pronunciation accuracy,
lyric intelligibility, hook strength, chorus impact, musical quality, viral-proxy score, and
visual sync potential.

- If one candidate is clearly stronger, declare it the winner.
- If scores are within 0.3 of each other and neither has a decisive edge, declare a "tie".
- If audio quality or upload issues make a fair comparison impossible, declare "manual_review_required".

Do NOT predict virality or make claims about audience behavior.

## Required Output Format

Return your response using the exact section headers below. Do not add any text before the first section header.

${SECTION_DELIMITER} WINNER
[A | B | tie | manual_review_required]

${SECTION_DELIMITER} SCORE_DELTA
[candidate_a_overall − candidate_b_overall, e.g. 1.2 or -0.5]

${SECTION_DELIMITER} CONFIDENCE
[high | medium | low]

${SECTION_DELIMITER} DECISION_RATIONALE
[2-4 sentences explaining why this candidate was chosen]

${SECTION_DELIMITER} CANDIDATE_A_STRENGTHS
[bullet list, one strength per line, starting with -]

${SECTION_DELIMITER} CANDIDATE_B_STRENGTHS
[bullet list, one strength per line, starting with -]

${SECTION_DELIMITER} CAVEATS
[any edge cases, caveats, or notes for the human reviewer; "none" if no caveats]
`;
}

/**
 * Parsers for ChatGPT evaluation responses.
 *
 * Both parsers use the same `=== SECTION ===` delimiter strategy as the
 * Gemini and ChatGPT lyrics parsers: split on the capturing-group regex,
 * collect key→value pairs into a Map, then extract typed fields.
 *
 * Never throws — all errors return null.
 */

import type { CandidateAnalysis, ComparisonResult, WinnerLabel } from './types';

// ─── Section Extraction ───────────────────────────────────────────────────────

const SECTION_PATTERN = /^=== SECTION ===\s+(\S+)\s*$/m;

/**
 * Split a raw ChatGPT response into a Map<UPPER_KEY, content>.
 *
 * Parsing strategy:
 *   1. Split on lines that match `=== SECTION === KEY`
 *   2. Odd indices in the resulting array are section keys, even are bodies
 */
function extractSections(raw: string): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = raw.split(/^=== SECTION ===[ \t]*(\S+)[ \t]*$/m);

  // parts = [preamble, key1, body1, key2, body2, ...]
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const key = parts[i].trim().toUpperCase();
    const body = parts[i + 1].trim();
    sections.set(key, body);
  }
  return sections;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseScore(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.trim());
  return isNaN(n) ? null : Math.min(10, Math.max(1, n));
}

function parseText(raw: string | undefined): string {
  return (raw ?? '').trim();
}

function parseBulletList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter((line) => line.length > 0);
}

// ─── Candidate Analysis Parser ────────────────────────────────────────────────

/**
 * Parse a ChatGPT per-candidate analysis response.
 *
 * Returns null if any critical field is missing or unparseable.
 */
export function parseCandidateAnalysis(
  raw: string,
  label: 'A' | 'B'
): CandidateAnalysis | null {
  const s = extractSections(raw);

  const overallScore = parseScore(s.get('OVERALL_SCORE'));
  if (overallScore === null) return null;

  const pronunciationScore = parseScore(s.get('PRONUNCIATION_ACCURACY_SCORE'));
  const lyricScore = parseScore(s.get('LYRIC_INTELLIGIBILITY_SCORE'));
  const hookScore = parseScore(s.get('HOOK_STRENGTH_SCORE'));
  const chorusScore = parseScore(s.get('CHORUS_IMPACT_SCORE'));
  const musicalScore = parseScore(s.get('MUSICAL_QUALITY_SCORE'));
  const viralScore = parseScore(s.get('VIRAL_PROXY_SCORE'));
  const visualScore = parseScore(s.get('VISUAL_SYNC_POTENTIAL_SCORE'));

  if (
    pronunciationScore === null ||
    lyricScore === null ||
    hookScore === null ||
    chorusScore === null ||
    musicalScore === null ||
    viralScore === null ||
    visualScore === null
  ) {
    return null;
  }

  return {
    label,
    overall_score: overallScore,
    pronunciation_accuracy: {
      score: pronunciationScore,
      rationale: parseText(s.get('PRONUNCIATION_ACCURACY_RATIONALE')),
    },
    lyric_intelligibility: {
      score: lyricScore,
      rationale: parseText(s.get('LYRIC_INTELLIGIBILITY_RATIONALE')),
    },
    hook_strength: {
      score: hookScore,
      rationale: parseText(s.get('HOOK_STRENGTH_RATIONALE')),
    },
    chorus_impact: {
      score: chorusScore,
      rationale: parseText(s.get('CHORUS_IMPACT_RATIONALE')),
    },
    musical_quality: {
      score: musicalScore,
      rationale: parseText(s.get('MUSICAL_QUALITY_RATIONALE')),
    },
    viral_proxy_score: {
      score: viralScore,
      rationale: parseText(s.get('VIRAL_PROXY_RATIONALE')),
    },
    visual_sync_potential: {
      score: visualScore,
      rationale: parseText(s.get('VISUAL_SYNC_POTENTIAL_RATIONALE')),
    },
    notes: parseText(s.get('NOTES')),
  };
}

// ─── Comparison Result Parser ─────────────────────────────────────────────────

const VALID_WINNERS = new Set<WinnerLabel>(['A', 'B', 'tie', 'manual_review_required']);

/**
 * Parse a ChatGPT comparison response.
 *
 * Returns null if any critical field is missing or unparseable.
 */
export function parseComparisonResult(raw: string): ComparisonResult | null {
  const s = extractSections(raw);

  const winnerRaw = s.get('WINNER')?.trim().toLowerCase();
  const winner: WinnerLabel | undefined = (() => {
    if (winnerRaw === 'a') return 'A';
    if (winnerRaw === 'b') return 'B';
    if (winnerRaw === 'tie') return 'tie';
    if (winnerRaw === 'manual_review_required') return 'manual_review_required';
    return undefined;
  })();

  if (!winner || !VALID_WINNERS.has(winner)) return null;

  const scoreDeltaRaw = s.get('SCORE_DELTA');
  const scoreDelta = scoreDeltaRaw ? parseFloat(scoreDeltaRaw.trim()) : NaN;
  if (isNaN(scoreDelta)) return null;

  const confidenceRaw = s.get('CONFIDENCE')?.trim().toLowerCase();
  const confidence = (
    confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
      ? confidenceRaw
      : undefined
  ) as 'high' | 'medium' | 'low' | undefined;
  if (!confidence) return null;

  const decisionRationale = parseText(s.get('DECISION_RATIONALE'));
  if (!decisionRationale) return null;

  return {
    winner,
    score_delta: Math.round(scoreDelta * 100) / 100,
    decision_rationale: decisionRationale,
    confidence,
    candidate_a_strengths: parseBulletList(s.get('CANDIDATE_A_STRENGTHS')),
    candidate_b_strengths: parseBulletList(s.get('CANDIDATE_B_STRENGTHS')),
    caveats: parseText(s.get('CAVEATS')),
  };
}

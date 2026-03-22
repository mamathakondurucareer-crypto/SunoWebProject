/**
 * Parser for ChatGPT lyrics-correction responses.
 *
 * Strategy:
 *   1. Split the response on === HEADER === delimiters (same approach as gemini/parser.ts)
 *   2. Extract each section by key aliases (tolerates minor ChatGPT formatting variation)
 *   3. Parse sub-structures: PronunciationNote[], IssueFound[], string[]
 *   4. Apply CRITICAL_RULES — any failure → success: false
 *   5. Apply WARN_RULES   — any failure → warning added, success unchanged
 *   6. Validate root object with Zod
 *
 * Never throws — all errors are caught and returned in the result.
 */

import type {
  ChatGPTCorrectedOutput,
  ChatGPTParseResult,
  PronunciationNote,
  IssueFound,
  IssueSeverity,
} from './types';
import { ChatGPTCorrectedOutputSchema, CRITICAL_RULES, WARN_RULES } from './schema';

// ─── Section extraction ───────────────────────────────────────────────────────

/**
 * Split raw text on `=== ANY HEADER ===` markers and return a Map with
 * UPPER-CASE header names as keys and trimmed body text as values.
 *
 * The regex is a capturing group so `.split()` keeps the headers in the array,
 * giving: [preamble, header, body, header, body, ...]
 */
export function extractSections(raw: string): Map<string, string> {
  const parts = raw.split(/^(===\s*[^=\n]+?\s*===)\s*$/m);
  const map = new Map<string, string>();

  for (let i = 1; i < parts.length - 1; i += 2) {
    const header = parts[i]!.replace(/^===\s*/, '').replace(/\s*===$/, '').trim().toUpperCase();
    const body = (parts[i + 1] ?? '').trim();
    map.set(header, body);
  }

  return map;
}

/**
 * Try multiple key aliases on the section map (all compared upper-case).
 * Returns the first match's body, or '' if none found.
 */
function getSection(map: Map<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = map.get(k.toUpperCase());
    if (v !== undefined) return v;
  }
  return '';
}

// ─── Lyrics normalisation ─────────────────────────────────────────────────────

/**
 * If a section body is "N/A" or similar, treat it as absent (return null).
 * Otherwise return the trimmed text.
 */
function nullIfNA(text: string): string | null {
  const t = text.trim();
  if (!t || /^n\/a\b/i.test(t)) return null;
  return t;
}

// ─── Pronunciation note parser ────────────────────────────────────────────────

/**
 * Supported line formats:
 *   Word: prabhu — PRAB-hoo — stress first syllable
 *   Word: prabhu — PRAB-hoo
 *   prabhu — PRAB-hoo — stress first syllable
 *   prabhu: PRAB-hoo (stress first syllable)
 */
export function parsePronunciationNotes(text: string): PronunciationNote[] {
  if (!text || /^none\.?$/i.test(text.trim())) return [];

  const notes: PronunciationNote[] = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // Strip leading "Word:" label (case-insensitive)
    const stripped = line.replace(/^word:\s*/i, '').trim();

    // Try "word — guide — stress_note" (em-dash or double-hyphen separator)
    const emParts = stripped.split(/\s*[—–]\s*/);
    if (emParts.length >= 2) {
      notes.push({
        word: (emParts[0] ?? '').trim(),
        guide: (emParts[1] ?? '').trim(),
        stress_note: emParts.length >= 3 ? (emParts[2] ?? '').trim() || null : null,
      });
      continue;
    }

    // Try "word: guide (stress_note)" — colon separator, paren stress
    const colonMatch = stripped.match(/^(.+?):\s*(.+?)(?:\s*\(([^)]+)\))?$/);
    if (colonMatch) {
      notes.push({
        word: (colonMatch[1] ?? '').trim(),
        guide: (colonMatch[2] ?? '').trim(),
        stress_note: colonMatch[3] ? (colonMatch[3] ?? '').trim() : null,
      });
      continue;
    }

    // Fallback: treat whole line as a word/guide combined
    if (stripped.length > 0) {
      notes.push({ word: stripped, guide: stripped, stress_note: null });
    }
  }

  return notes;
}

// ─── Issues found parser ──────────────────────────────────────────────────────

/** Coerce any severity-like string to our enum. */
function parseSeverity(raw: string): IssueSeverity {
  const s = raw.toLowerCase().trim();
  if (s === 'high') return 'high';
  if (s === 'medium' || s === 'med') return 'medium';
  return 'low';
}

/**
 * Supported line formats:
 *   - Description (severity: high) [location: Verse 1]
 *   - Description [HIGH] [location: global]
 *   - Description (severity: medium)
 *   1. Description (severity: low)
 */
export function parseIssuesFound(text: string): IssueFound[] {
  if (!text || /^none\.?$/i.test(text.trim())) return [];

  const issues: IssueFound[] = [];

  for (const raw of text.split('\n')) {
    // Strip list prefix (-, *, 1., 2., etc.)
    const line = raw.trim().replace(/^[-*•]\s*|^\d+\.\s*/, '');
    if (!line) continue;

    let description = line;
    let severity: IssueSeverity = 'low';
    let location: string | null = null;

    // Extract [location: ...]
    const locationMatch = description.match(/\[location:\s*([^\]]+)\]/i);
    if (locationMatch) {
      location = (locationMatch[1] ?? '').trim() || null;
      description = description.replace(locationMatch[0], '').trim();
    }

    // Extract (severity: high|medium|low)
    const sevParenMatch = description.match(/\(severity:\s*(high|medium|med|low)\)/i);
    if (sevParenMatch) {
      severity = parseSeverity(sevParenMatch[1] ?? '');
      description = description.replace(sevParenMatch[0], '').trim();
    }

    // Extract [HIGH] / [MEDIUM] / [LOW] bracket form
    const sevBracketMatch = description.match(/\[(high|medium|med|low)\]/i);
    if (sevBracketMatch && !sevParenMatch) {
      severity = parseSeverity(sevBracketMatch[1] ?? '');
      description = description.replace(sevBracketMatch[0], '').trim();
    }

    // Remove trailing punctuation artefacts
    description = description.replace(/[,;]\s*$/, '').trim();

    if (description.length > 0) {
      issues.push({ description, severity, location });
    }
  }

  return issues;
}

// ─── Manual review notes parser ───────────────────────────────────────────────

/**
 * Parse numbered or bulleted list.
 * Returns one string per non-empty item.
 */
export function parseManualReviewNotes(text: string): string[] {
  if (!text || /^none\.?$/i.test(text.trim())) return [];

  return text
    .split('\n')
    .map((l) => l.trim().replace(/^[-*•]\s*|^\d+\.\s*/, '').trim())
    .filter((l) => l.length > 0);
}

// ─── Main parse entry point ───────────────────────────────────────────────────

/**
 * Parse a raw ChatGPT lyrics-correction response.
 *
 * Always returns a `ChatGPTParseResult` — never throws.
 */
export function parseChatGPTOutput(raw: string): ChatGPTParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    if (!raw || raw.trim().length < 20) {
      return {
        success: false,
        errors: ['Response is empty or too short to parse'],
        warnings: [],
      };
    }

    // ── 1. Extract sections ──────────────────────────────────────────────────
    const map = extractSections(raw);

    // Determine parse source: if we found ≥3 expected section headers → structured
    const structuredHeaders = [
      'CORRECTED HINDI LYRICS',
      'CORRECTED ENGLISH LYRICS',
      'SUNO READY LYRICS',
      'PRONUNCIATION NOTES',
      'ISSUES FOUND',
      'MANUAL REVIEW NOTES',
    ];
    const foundCount = structuredHeaders.filter((h) => map.has(h)).length;
    const source = foundCount >= 3 ? 'structured' : 'prose' as const;

    if (source === 'prose') {
      warnings.push(
        `Only ${foundCount}/6 expected section headers found — falling back to prose extraction`
      );
    }

    // ── 2. Extract each field ────────────────────────────────────────────────
    const hindiRaw = getSection(map, 'CORRECTED HINDI LYRICS', 'HINDI LYRICS', 'HINDI');
    const englishRaw = getSection(
      map,
      'CORRECTED ENGLISH LYRICS',
      'ENGLISH LYRICS',
      'ENGLISH'
    );
    const sunoRaw = getSection(
      map,
      'SUNO READY LYRICS',
      'SUNO LYRICS',
      'SUNO-READY LYRICS',
      'SUNO FORMATTED LYRICS'
    );
    const pronunciationRaw = getSection(
      map,
      'PRONUNCIATION NOTES',
      'PRONUNCIATION GUIDE',
      'PRONUNCIATION'
    );
    const issuesRaw = getSection(
      map,
      'ISSUES FOUND',
      'ISSUES',
      'CHANGES MADE',
      'CORRECTIONS'
    );
    const reviewRaw = getSection(
      map,
      'MANUAL REVIEW NOTES',
      'MANUAL REVIEW',
      'REVIEW NOTES',
      'REVIEW'
    );

    // ── 3. Prose fallback when suno_ready_lyrics is missing ──────────────────
    // If sunoRaw is empty but we have english or hindi content, use that
    let sunoResolved = nullIfNA(sunoRaw) ?? '';
    if (!sunoResolved) {
      const fallback = nullIfNA(englishRaw) ?? nullIfNA(hindiRaw) ?? '';
      if (fallback) {
        sunoResolved = fallback;
        warnings.push(
          'SUNO READY LYRICS section not found — using corrected lyrics as fallback'
        );
      }
    }

    // ── 4. Build output object ───────────────────────────────────────────────
    const draft: ChatGPTCorrectedOutput = {
      corrected_hindi_lyrics: nullIfNA(hindiRaw),
      corrected_english_lyrics: nullIfNA(englishRaw),
      suno_ready_lyrics: sunoResolved,
      pronunciation_notes: parsePronunciationNotes(pronunciationRaw),
      issues_found: parseIssuesFound(issuesRaw),
      manual_review_notes: parseManualReviewNotes(reviewRaw),
      parse_warnings: [],
      parsed_at: Date.now(),
      source,
    };

    // ── 5. Apply warn rules ──────────────────────────────────────────────────
    for (const rule of WARN_RULES) {
      if (!rule.check(draft)) {
        warnings.push(rule.message(draft));
      }
    }
    draft.parse_warnings = [...warnings];

    // ── 6. Apply critical rules ──────────────────────────────────────────────
    for (const rule of CRITICAL_RULES) {
      if (!rule.check(draft)) {
        errors.push(rule.message(draft));
      }
    }

    // ── 7. Zod validation ────────────────────────────────────────────────────
    const zodResult = ChatGPTCorrectedOutputSchema.safeParse(draft);
    if (!zodResult.success) {
      for (const issue of zodResult.error.issues) {
        errors.push(`Schema: ${issue.path.join('.')} — ${issue.message}`);
      }
    }

    if (errors.length > 0) {
      return { success: false, data: draft, errors, warnings };
    }

    return { success: true, data: draft, errors: [], warnings };
  } catch (err) {
    return {
      success: false,
      errors: [`Unexpected parser error: ${String(err)}`],
      warnings,
    };
  }
}

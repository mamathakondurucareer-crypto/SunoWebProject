/**
 * Zod schemas and validation rule sets for the ChatGPT lyrics-correction output.
 *
 * CRITICAL_RULES  → failure stops the workflow; errors[] is populated
 * WARN_RULES      → non-fatal; warnings[] is populated but parse succeeds
 */

import { z } from 'zod';
import type { ChatGPTCorrectedOutput } from './types';

// ─── Leaf schemas ─────────────────────────────────────────────────────────────

export const PronunciationNoteSchema = z.object({
  word: z.string().min(1),
  guide: z.string().min(1),
  stress_note: z.string().nullable(),
});

export const IssueSeveritySchema = z.enum(['low', 'medium', 'high']);

export const IssueFoundSchema = z.object({
  description: z.string().min(1),
  severity: IssueSeveritySchema,
  location: z.string().nullable(),
});

// ─── Root schema ──────────────────────────────────────────────────────────────

export const ChatGPTCorrectedOutputSchema = z.object({
  corrected_hindi_lyrics: z.string().nullable(),
  corrected_english_lyrics: z.string().nullable(),
  suno_ready_lyrics: z.string(),
  pronunciation_notes: z.array(PronunciationNoteSchema),
  issues_found: z.array(IssueFoundSchema),
  manual_review_notes: z.array(z.string()),
  parse_warnings: z.array(z.string()),
  parsed_at: z.number().int().positive(),
  source: z.enum(['structured', 'prose']),
});

export const ChatGPTParseResultSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    data: ChatGPTCorrectedOutputSchema,
    errors: z.array(z.string()).length(0),
    warnings: z.array(z.string()),
  }),
  z.object({
    success: z.literal(false),
    data: ChatGPTCorrectedOutputSchema.optional(),
    errors: z.array(z.string()).min(1),
    warnings: z.array(z.string()),
  }),
]);

// ─── Validation rule types ────────────────────────────────────────────────────

export interface CriticalRule {
  field: string;
  check: (data: ChatGPTCorrectedOutput) => boolean;
  message: (data: ChatGPTCorrectedOutput) => string;
}

export interface WarnRule {
  field: string;
  check: (data: ChatGPTCorrectedOutput) => boolean;
  message: (data: ChatGPTCorrectedOutput) => string;
}

// ─── Critical rules (parse fails) ────────────────────────────────────────────

export const CRITICAL_RULES: CriticalRule[] = [
  {
    field: 'suno_ready_lyrics',
    check: (d) => d.suno_ready_lyrics.trim().length >= 20,
    message: (d) =>
      `suno_ready_lyrics is too short (${d.suno_ready_lyrics.trim().length} chars — expected ≥ 20)`,
  },
  {
    field: 'corrected_lyrics_present',
    check: (d) =>
      (d.corrected_hindi_lyrics !== null && d.corrected_hindi_lyrics.trim().length > 0) ||
      (d.corrected_english_lyrics !== null && d.corrected_english_lyrics.trim().length > 0),
    message: () =>
      'Neither corrected_hindi_lyrics nor corrected_english_lyrics contains usable content',
  },
];

// ─── Warn rules (non-fatal) ───────────────────────────────────────────────────

export const WARN_RULES: WarnRule[] = [
  {
    field: 'pronunciation_notes',
    check: (d) => d.pronunciation_notes.length > 0,
    message: () => 'No pronunciation notes provided — consider adding phonetic guidance',
  },
  {
    field: 'issues_found',
    check: (d) => d.issues_found.length > 0,
    message: () =>
      'No issues found reported — verify ChatGPT performed a thorough review',
  },
  {
    field: 'manual_review_notes',
    check: (d) => d.manual_review_notes.length > 0,
    message: () => 'No manual review notes provided',
  },
  {
    field: 'suno_ready_lyrics_sections',
    check: (d) => /\[(verse|chorus|bridge|outro|intro|pre-chorus)/i.test(d.suno_ready_lyrics),
    message: () => 'suno_ready_lyrics does not contain any Suno section tags like [Verse 1]',
  },
  {
    field: 'high_severity_issues',
    check: (d) => !d.issues_found.some((i) => i.severity === 'high'),
    message: (d) => {
      const count = d.issues_found.filter((i) => i.severity === 'high').length;
      return `${count} high-severity issue(s) found — manual review strongly recommended`;
    },
  },
];

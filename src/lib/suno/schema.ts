/**
 * Zod schemas and validation rule sets for the Suno generation output.
 *
 * CRITICAL_RULES  → failure stops the workflow; errors[] is populated
 * WARN_RULES      → non-fatal; warnings[] is populated but result succeeds
 */

import { z } from 'zod';
import type { SunoCandidate, SunoGenerationResult } from './types';

// ─── Leaf schemas ─────────────────────────────────────────────────────────────

export const CandidateLabelSchema = z.enum(['A', 'B']);

export const SunoCandidateSchema = z.object({
  label: CandidateLabelSchema,
  song_title: z.string(),
  duration_raw: z.string().nullable(),
  duration_seconds: z.number().nullable(),
  style_prompt: z.string(),
  song_id: z.string().nullable(),
  audio_path: z.string().nullable(),
  thumbnail_path: z.string().nullable(),
  downloaded: z.boolean(),
});

export const SunoRequestPayloadSchema = z.object({
  lyrics: z.string().min(1),
  style_prompt: z.string(),
  title: z.string(),
  submitted_at: z.number().int().positive(),
});

// ─── Root schema ──────────────────────────────────────────────────────────────

export const SunoGenerationResultSchema = z.object({
  candidate_a: SunoCandidateSchema,
  candidate_b: SunoCandidateSchema,
  request_payload: SunoRequestPayloadSchema,
  generated_at: z.number().int().positive(),
  page_url: z.string(),
  warnings: z.array(z.string()),
});

export const SunoStoredRunSchema = z.object({
  run_dir: z.string(),
  metadata_path: z.string(),
  request_payload_path: z.string(),
  candidate_a_audio: z.string().nullable(),
  candidate_b_audio: z.string().nullable(),
  candidate_a_thumbnail: z.string().nullable(),
  candidate_b_thumbnail: z.string().nullable(),
  candidates_screenshot: z.string().nullable(),
});

// ─── Validation rule types ────────────────────────────────────────────────────

export interface CriticalRule {
  field: string;
  check: (data: SunoGenerationResult) => boolean;
  message: (data: SunoGenerationResult) => string;
}

export interface WarnRule {
  field: string;
  check: (data: SunoGenerationResult) => boolean;
  message: (data: SunoGenerationResult) => string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function downloadedCount(data: SunoGenerationResult): number {
  return [data.candidate_a, data.candidate_b].filter((c: SunoCandidate) => c.downloaded).length;
}

// ─── Critical rules (result fails) ───────────────────────────────────────────

export const CRITICAL_RULES: CriticalRule[] = [
  {
    field: 'candidates_present',
    check: (d) =>
      d.candidate_a.song_title.trim().length > 0 || d.candidate_b.song_title.trim().length > 0,
    message: () => 'No song candidates were detected — Suno may have failed to generate',
  },
  {
    field: 'at_least_one_downloaded',
    check: (d) => downloadedCount(d) >= 1,
    message: () =>
      'Neither candidate audio was downloaded — manual download required before proceeding',
  },
];

// ─── Warn rules (non-fatal) ───────────────────────────────────────────────────

export const WARN_RULES: WarnRule[] = [
  {
    field: 'both_candidates_downloaded',
    check: (d) => downloadedCount(d) === 2,
    message: (d) => {
      const n = downloadedCount(d);
      return `Only ${n}/2 candidate(s) were downloaded — the missing candidate may require manual download`;
    },
  },
  {
    field: 'candidate_a_duration',
    check: (d) => d.candidate_a.duration_seconds !== null,
    message: () => 'Candidate A: duration could not be determined',
  },
  {
    field: 'candidate_b_duration',
    check: (d) => d.candidate_b.duration_seconds !== null,
    message: () => 'Candidate B: duration could not be determined',
  },
  {
    field: 'style_prompt_length',
    check: (d) => d.request_payload.style_prompt.trim().length >= 10,
    message: () =>
      'Style prompt is very short — consider adding more descriptors (genre, BPM, instruments)',
  },
  {
    field: 'song_ids_captured',
    check: (d) => d.candidate_a.song_id !== null || d.candidate_b.song_id !== null,
    message: () =>
      'No Suno song IDs captured — deep links and re-download may not be possible',
  },
];

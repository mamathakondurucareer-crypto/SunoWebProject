/**
 * Zod schemas + validation rules for the ChatGPT evaluation module.
 */

import { z } from 'zod';
import type { CandidateAnalysis, ComparisonResult } from './types';

// ─── Score Detail ─────────────────────────────────────────────────────────────

export const ScoreDetailSchema = z.object({
  score: z.number().min(1).max(10),
  rationale: z.string(),
});

// ─── Candidate Analysis ───────────────────────────────────────────────────────

export const CandidateAnalysisSchema = z.object({
  label: z.enum(['A', 'B']),
  overall_score: z.number().min(1).max(10),
  pronunciation_accuracy: ScoreDetailSchema,
  lyric_intelligibility: ScoreDetailSchema,
  hook_strength: ScoreDetailSchema,
  chorus_impact: ScoreDetailSchema,
  musical_quality: ScoreDetailSchema,
  viral_proxy_score: ScoreDetailSchema,
  visual_sync_potential: ScoreDetailSchema,
  notes: z.string(),
});

// ─── Comparison Result ────────────────────────────────────────────────────────

export const ComparisonResultSchema = z.object({
  winner: z.enum(['A', 'B', 'tie', 'manual_review_required']),
  score_delta: z.number(),
  decision_rationale: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  candidate_a_strengths: z.array(z.string()),
  candidate_b_strengths: z.array(z.string()),
  caveats: z.string(),
});

// ─── Stored Run ───────────────────────────────────────────────────────────────

export const EvaluationStoredRunSchema = z.object({
  run_dir: z.string(),
  candidate_a_analysis_path: z.string(),
  candidate_b_analysis_path: z.string(),
  comparison_path: z.string(),
  selected_candidate_path: z.string(),
  chatgpt_screenshot: z.string().nullable(),
});

// ─── Validation Rules ─────────────────────────────────────────────────────────

export interface CriticalEvalRule {
  field: string;
  check: (analysis: CandidateAnalysis) => boolean;
  message: (analysis: CandidateAnalysis) => string;
}

export interface CriticalCompareRule {
  field: string;
  check: (result: ComparisonResult) => boolean;
  message: (result: ComparisonResult) => string;
}

export interface WarnEvalRule {
  field: string;
  check: (analysis: CandidateAnalysis) => boolean;
  message: (analysis: CandidateAnalysis) => string;
}

export const CRITICAL_EVAL_RULES: CriticalEvalRule[] = [
  {
    field: 'overall_score_present',
    check: (a) => a.overall_score >= 1 && a.overall_score <= 10,
    message: (a) =>
      `Candidate ${a.label} overall_score (${a.overall_score}) is outside the valid 1–10 range.`,
  },
  {
    field: 'all_dimensions_present',
    check: (a) =>
      [
        a.pronunciation_accuracy,
        a.lyric_intelligibility,
        a.hook_strength,
        a.chorus_impact,
        a.musical_quality,
        a.viral_proxy_score,
        a.visual_sync_potential,
      ].every((d) => d.score >= 1 && d.score <= 10),
    message: (a) =>
      `Candidate ${a.label} has one or more dimension scores outside the valid 1–10 range.`,
  },
];

export const CRITICAL_COMPARE_RULES: CriticalCompareRule[] = [
  {
    field: 'winner_present',
    check: (r) => ['A', 'B', 'tie', 'manual_review_required'].includes(r.winner),
    message: () => 'Comparison result is missing a valid winner field.',
  },
  {
    field: 'rationale_present',
    check: (r) => r.decision_rationale.trim().length > 0,
    message: () => 'Comparison result has an empty decision_rationale.',
  },
];

export const WARN_EVAL_RULES: WarnEvalRule[] = [
  {
    field: 'notes_present',
    check: (a) => a.notes.trim().length > 10,
    message: (a) =>
      `Candidate ${a.label} has very short notes (${a.notes.trim().length} chars). ChatGPT may have provided minimal feedback.`,
  },
  {
    field: 'viral_proxy_not_virality_claim',
    check: (a) => !a.viral_proxy_score.rationale.toLowerCase().includes('will go viral'),
    message: (a) =>
      `Candidate ${a.label} viral_proxy_score rationale contains a virality prediction claim — remove it.`,
  },
];

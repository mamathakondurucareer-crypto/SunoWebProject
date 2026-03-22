/**
 * Public API for the ChatGPT audio evaluation module.
 *
 * @example
 *   import {
 *     buildCandidateAnalysisPrompt,
 *     buildComparisonPrompt,
 *     parseCandidateAnalysis,
 *     parseComparisonResult,
 *     saveEvaluationRun,
 *     CRITICAL_EVAL_RULES,
 *     WARN_EVAL_RULES,
 *   } from '@/lib/chatgpt-eval';
 */

// Types
export type {
  CandidateEvaluationInput,
  ScoreDetail,
  CandidateAnalysis,
  ComparisonResult,
  WinnerLabel,
  EvaluationStoredRun,
} from './types';

// Zod schemas
export {
  ScoreDetailSchema,
  CandidateAnalysisSchema,
  ComparisonResultSchema,
  EvaluationStoredRunSchema,
} from './schema';

// Validation rules
export type { CriticalEvalRule, CriticalCompareRule, WarnEvalRule } from './schema';
export {
  CRITICAL_EVAL_RULES,
  CRITICAL_COMPARE_RULES,
  WARN_EVAL_RULES,
} from './schema';

// Prompt builders
export { SECTION_DELIMITER, buildCandidateAnalysisPrompt, buildComparisonPrompt } from './prompt';

// Parsers
export { parseCandidateAnalysis, parseComparisonResult } from './parser';

// Storage
export type { SaveEvaluationRunInput } from './storage';
export { saveEvaluationRun, loadAnalysis, loadComparison } from './storage';

/**
 * Public API for the Suno music-generation module.
 *
 * Import from this barrel rather than individual files.
 *
 * @example
 *   import {
 *     saveSunoRun,
 *     loadSunoRun,
 *     parseDurationSeconds,
 *     CRITICAL_RULES,
 *     WARN_RULES,
 *   } from '@/lib/suno';
 */

// Types
export type {
  SunoGenerationInput,
  SunoRequestPayload,
  CandidateLabel,
  SunoCandidate,
  SunoGenerationResult,
  SunoStoredRun,
} from './types';

// Zod schemas
export {
  CandidateLabelSchema,
  SunoCandidateSchema,
  SunoRequestPayloadSchema,
  SunoGenerationResultSchema,
  SunoStoredRunSchema,
} from './schema';

// Validation rules
export type { CriticalRule, WarnRule } from './schema';
export { CRITICAL_RULES, WARN_RULES } from './schema';

// Storage
export {
  saveSunoRun,
  loadSunoRun,
  deriveSunoStoredRun,
  parseDurationSeconds,
  validateStoredRun,
} from './storage';

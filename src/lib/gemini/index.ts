/**
 * Gemini module public API.
 *
 * Import from here, not from individual files.
 *
 * @example
 *   import { parseGeminiOutput } from '@/lib/gemini';
 *   import type { GeminiParsedOutput, GeminiParseResult } from '@/lib/gemini';
 */

// Types
export type {
  LyricSectionType,
  LyricSection,
  ScenePlan,
  ThumbnailConcept,
  SeoMetadata,
  CtaList,
  RiskLevel,
  RiskReview,
  CompletenessAudit,
  ParseSource,
  GeminiParsedOutput,
  GeminiParseResult,
} from './types';

// Zod schemas & rules
export {
  LyricSectionTypeSchema,
  LyricSectionSchema,
  ScenePlanSchema,
  ThumbnailConceptSchema,
  SeoMetadataSchema,
  RiskLevelSchema,
  RiskReviewSchema,
  CompletenessAuditSchema,
  ParseSourceSchema,
  GeminiParsedOutputSchema,
  GeminiParseResultSchema,
  CRITICAL_RULES,
  WARN_RULES,
} from './schema';

// Parser
export {
  parseGeminiOutput,
  // Sub-parsers exposed for unit tests and downstream reuse
  extractSections,
  parseLyricSections,
  parseScenePlan,
  parseThumbnailConcepts,
  parseSeoMetadata,
  parseRiskReview,
  parseCtas,
  buildCompletenessAudit,
  extractJsonBlock,
} from './parser';

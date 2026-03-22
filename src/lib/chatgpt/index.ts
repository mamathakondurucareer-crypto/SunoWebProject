/**
 * Public surface of the chatgpt/ module.
 *
 * Consumers import from '@/lib/chatgpt':
 *   - Types and interfaces
 *   - Zod schemas and validation rules
 *   - Prompt builder
 *   - Output parser
 */

export type {
  LyricsCorrectionInput,
  PronunciationNote,
  IssueSeverity,
  IssueFound,
  CorrectionParseSource,
  ChatGPTCorrectedOutput,
  ChatGPTParseResult,
} from './types';

export {
  PronunciationNoteSchema,
  IssueSeveritySchema,
  IssueFoundSchema,
  ChatGPTCorrectedOutputSchema,
  ChatGPTParseResultSchema,
  CRITICAL_RULES,
  WARN_RULES,
} from './schema';
export type { CriticalRule, WarnRule } from './schema';

export { isHindiContent, buildLyricsCorrectionPrompt } from './prompt';

export {
  extractSections,
  parsePronunciationNotes,
  parseIssuesFound,
  parseManualReviewNotes,
  parseChatGPTOutput,
} from './parser';

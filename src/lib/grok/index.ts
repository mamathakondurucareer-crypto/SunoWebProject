/**
 * Public API for the Grok video generation module.
 *
 * Import from this barrel rather than individual files.
 *
 * @example
 *   import {
 *     saveSceneArtifacts,
 *     saveGenerationManifest,
 *     loadGenerationManifest,
 *     roundToGrokDuration,
 *     CRITICAL_GROK_RULES,
 *     WARN_GROK_RULES,
 *   } from '@/lib/grok';
 */

// Types
export type {
  GrokDuration,
  GrokAspectRatio,
  GrokResolution,
  GrokGenerationStatus,
  GrokRequestSettings,
  GrokSceneRequest,
  GrokSceneResult,
  GrokGenerationRun,
} from './types';

// Zod schemas
export {
  GrokDurationSchema,
  GrokAspectRatioSchema,
  GrokResolutionSchema,
  GrokGenerationStatusSchema,
  GrokRequestSettingsSchema,
  GrokSceneResultSchema,
  GrokGenerationRunSchema,
} from './schema';

// Validation rules
export type { CriticalGrokRule, WarnGrokRule } from './schema';
export { CRITICAL_GROK_RULES, WARN_GROK_RULES } from './schema';

// Storage
export {
  sceneDir,
  sceneVideoFilename,
  saveSceneArtifacts,
  saveGenerationManifest,
  loadGenerationManifest,
  roundToGrokDuration,
} from './storage';

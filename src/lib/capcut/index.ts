/**
 * CapCut handoff packaging module — barrel export.
 *
 * Produces a local folder of assets + documents that a human editor
 * (or future automation) can import directly into CapCut Desktop.
 *
 * Usage:
 *   import { saveCapCutPackage, CRITICAL_CAPCUT_RULES, ... } from '@/lib/capcut';
 */

// Types
export type {
  CapCutPackageRequest,
  HookMoment,
  HookEmphasisType,
  ShortsExtractionWindow,
  ShortsPlatform,
  CapCutClipEntry,
  VideoTrackEntry,
  AudioTrackEntry,
  SubtitleTrackEntry,
  CapCutTimeline,
  SrtEntry,
  CapCutPackageRun,
  // Re-exports from scene-plan / grok
  MusicalSection,
  EnergyLevel,
  SceneSegment,
  SceneManifest,
  GrokSceneResult,
} from './types';

// Zod schemas
export {
  MusicalSectionSchema,
  EnergyLevelSchema,
  HookEmphasisTypeSchema,
  ShortsPlatformSchema,
  HookMomentSchema,
  ShortsExtractionWindowSchema,
  CapCutClipEntrySchema,
  VideoTrackEntrySchema,
  AudioTrackEntrySchema,
  SubtitleTrackEntrySchema,
  CapCutTimelineSchema,
  CapCutPackageRequestSchema,
  CapCutPackageRunSchema,
} from './schema';

// Validation rules
export {
  CRITICAL_CAPCUT_RULES,
  WARN_CAPCUT_RULES,
} from './schema';

export type {
  CriticalCapCutRule,
  WarnCapCutRule,
} from './schema';

// Builder functions
export {
  buildClipsManifest,
  buildTimeline,
  buildSrtEntries,
  renderSrt,
  renderEditManifestMarkdown,
  autoDetectHookMoments,
  autoDetectShortsWindows,
} from './builder';

// Storage functions
export {
  packageDir,
  saveCapCutPackage,
  loadCapCutPackageManifest,
} from './storage';

/**
 * Public API for the Canva thumbnail brief module.
 *
 * Import from this barrel rather than individual files.
 *
 * @example
 *   import {
 *     buildThumbnailBriefs,
 *     buildThumbnailBrief,
 *     renderCanvaGuideMarkdown,
 *     saveThumbnailBriefRun,
 *     loadThumbnailBriefManifest,
 *     CRITICAL_CANVA_RULES,
 *     WARN_CANVA_RULES,
 *   } from '@/lib/canva';
 */

// Types
export type {
  ThumbnailFormat,
  ThumbnailDimensions,
  TextWeight,
  TextAlignment,
  PositionAnchor,
  TextOverlay,
  BackgroundLayer,
  SubjectLayer,
  ColorOverlay,
  LayerPlan,
  ExportFormat,
  SocialPlatform,
  ExportTarget,
  ThumbnailFormatSpec,
  ThumbnailBriefRequest,
  ThumbnailBrief,
  ThumbnailBriefRun,
} from './types';

// Zod schemas
export {
  ThumbnailFormatSchema,
  TextWeightSchema,
  TextAlignmentSchema,
  PositionAnchorSchema,
  ExportFormatSchema,
  SocialPlatformSchema,
  TextOverlaySchema,
  BackgroundLayerSchema,
  SubjectLayerSchema,
  ColorOverlaySchema,
  LayerPlanSchema,
  ThumbnailDimensionsSchema,
  ExportTargetSchema,
  ThumbnailFormatSpecSchema,
  ThumbnailBriefSchema,
  ThumbnailBriefRunSchema,
  ThumbnailBriefRequestSchema,
} from './schema';

// Validation rules
export type { CriticalCanvaRule, WarnCanvaRule } from './schema';
export { CRITICAL_CANVA_RULES, WARN_CANVA_RULES, validateBrief } from './schema';

// Brief generator
export {
  FORMAT_SPECS,
  buildThumbnailBriefs,
  buildThumbnailBrief,
  renderCanvaGuideMarkdown,
} from './brief';

// Storage
export {
  thumbnailsDir,
  formatDir,
  saveThumbnailBriefRun,
  loadThumbnailBriefManifest,
} from './storage';

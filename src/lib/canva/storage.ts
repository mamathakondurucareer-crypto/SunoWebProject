/**
 * Local storage module for Canva thumbnail brief artifacts.
 *
 * Per-run directory structure:
 *
 *   {runDir}/thumbnails/
 *     thumbnail_brief_manifest.json
 *     desktop/
 *       brief.json
 *       canva_guide.md
 *     mobile/
 *       brief.json
 *       canva_guide.md
 *     multi_social/
 *       brief.json
 *       canva_guide.md
 *     canva_guide/
 *       brief.json
 *       canva_guide.md
 *
 * Never throws — all errors are caught; missing data surfaces as null paths.
 */

import fs from 'fs';
import path from 'path';
import type { ThumbnailFormat, ThumbnailBrief, ThumbnailBriefRun } from './types';
import { ThumbnailBriefRunSchema } from './schema';
import { renderCanvaGuideMarkdown } from './brief';
import type { ThumbnailBriefRequest } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const MANIFEST_FILENAME = 'thumbnail_brief_manifest.json';
const THUMBNAILS_SUBDIR = 'thumbnails';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the thumbnails root directory for a run. */
export function thumbnailsDir(runDir: string): string {
  return path.join(runDir, THUMBNAILS_SUBDIR);
}

/** Returns the per-format subdirectory path. */
export function formatDir(runDir: string, format: ThumbnailFormat): string {
  return path.join(runDir, THUMBNAILS_SUBDIR, format);
}

// ─── Artifact write ───────────────────────────────────────────────────────────

/**
 * Write all briefs + guides to `{runDir}/thumbnails/` and return the manifest.
 *
 * Writes per-format:
 *   - `{format}/brief.json`      — full ThumbnailBrief JSON
 *   - `{format}/canva_guide.md`  — human-readable markdown guide
 *
 * Then writes:
 *   - `thumbnail_brief_manifest.json` — ThumbnailBriefRun summary
 *
 * Returns the ThumbnailBriefRun; never throws.
 */
export function saveThumbnailBriefRun(
  briefs: Map<ThumbnailFormat, ThumbnailBrief>,
  req: ThumbnailBriefRequest,
  runDir: string
): ThumbnailBriefRun {
  const thumbsDir = thumbnailsDir(runDir);
  fs.mkdirSync(thumbsDir, { recursive: true });

  const briefPaths: Record<ThumbnailFormat, string | null> = {
    desktop: null,
    mobile: null,
    multi_social: null,
    canva_guide: null,
  };
  const guidePaths: Record<ThumbnailFormat, string | null> = {
    desktop: null,
    mobile: null,
    multi_social: null,
    canva_guide: null,
  };
  const formatsGenerated: ThumbnailFormat[] = [];

  for (const [format, brief] of briefs) {
    try {
      const dir = formatDir(runDir, format);
      fs.mkdirSync(dir, { recursive: true });

      const briefPath = path.join(dir, 'brief.json');
      fs.writeFileSync(briefPath, JSON.stringify(brief, null, 2), 'utf-8');
      briefPaths[format] = briefPath;

      const guidePath = path.join(dir, 'canva_guide.md');
      fs.writeFileSync(guidePath, renderCanvaGuideMarkdown(brief, req), 'utf-8');
      guidePaths[format] = guidePath;

      formatsGenerated.push(format);
    } catch {
      // Leave paths as null; caller can check formats_generated
    }
  }

  const manifestPath = path.join(thumbsDir, MANIFEST_FILENAME);
  const run: ThumbnailBriefRun = {
    run_dir: runDir,
    manifest_path: manifestPath,
    brief_paths: briefPaths,
    guide_paths: guidePaths,
    formats_generated: formatsGenerated,
    created_at: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(manifestPath, JSON.stringify(run, null, 2), 'utf-8');
  } catch {
    // Manifest write failed; run is still returned with correct paths
  }

  return run;
}

// ─── Manifest load ────────────────────────────────────────────────────────────

/**
 * Load a `ThumbnailBriefRun` manifest from a run directory.
 *
 * Returns `null` if the file is missing or fails to parse.
 */
export function loadThumbnailBriefManifest(runDir: string): ThumbnailBriefRun | null {
  const manifestPath = path.join(runDir, THUMBNAILS_SUBDIR, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const result = ThumbnailBriefRunSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

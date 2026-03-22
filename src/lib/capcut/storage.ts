/**
 * Local storage module for CapCut handoff package artifacts.
 *
 * Directory structure written per run:
 *
 *   {runDir}/capcut_package/
 *     assets/
 *       audio/                   ← copied winning audio file
 *       video/                   ← symlinked or copied Grok clips
 *     clips_manifest.json        ← ordered clip list with editorial notes
 *     timeline.json              ← multi-track timeline descriptor
 *     subtitles.srt              ← SRT subtitle file
 *     edit_manifest.md           ← full human-readable editorial guide
 *     capcut_package_manifest.json  ← top-level run summary
 *
 * Never throws — all errors are caught; missing paths surface as empty strings.
 */

import fs from 'fs';
import path from 'path';
import type {
  CapCutPackageRequest,
  CapCutClipEntry,
  CapCutTimeline,
  SrtEntry,
  ShortsExtractionWindow,
  CapCutPackageRun,
} from './types';
import { CapCutPackageRunSchema } from './schema';
import {
  buildClipsManifest,
  buildTimeline,
  buildSrtEntries,
  renderSrt,
  renderEditManifestMarkdown,
  autoDetectHookMoments,
  autoDetectShortsWindows,
} from './builder';

// ─── Constants ────────────────────────────────────────────────────────────────

const PACKAGE_SUBDIR        = 'capcut_package';
const ASSETS_AUDIO_SUBDIR   = 'assets/audio';
const ASSETS_VIDEO_SUBDIR   = 'assets/video';
const MANIFEST_FILENAME     = 'capcut_package_manifest.json';
const CLIPS_MANIFEST_FILE   = 'clips_manifest.json';
const TIMELINE_FILE         = 'timeline.json';
const SUBTITLES_FILE        = 'subtitles.srt';
const EDIT_MANIFEST_FILE    = 'edit_manifest.md';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the root package directory for a run. */
export function packageDir(runDir: string): string {
  return path.join(runDir, PACKAGE_SUBDIR);
}

// ─── Main write function ──────────────────────────────────────────────────────

/**
 * Build and write the complete CapCut handoff package to `{runDir}/capcut_package/`.
 *
 * Writes:
 *   - clips_manifest.json
 *   - timeline.json
 *   - subtitles.srt
 *   - edit_manifest.md
 *   - assets/audio/{filename}   (copy of winning audio)
 *   - capcut_package_manifest.json
 *
 * Note: Grok video clips are referenced by absolute path in clips_manifest.json
 * and timeline.json rather than copied, since they can be large. The editor
 * is expected to have access to the run directory.
 *
 * Returns the CapCutPackageRun manifest; never throws.
 */
export function saveCapCutPackage(req: CapCutPackageRequest, runDir: string): CapCutPackageRun {
  const pkgDir = packageDir(runDir);
  const audioDir = path.join(pkgDir, ASSETS_AUDIO_SUBDIR);
  fs.mkdirSync(audioDir, { recursive: true });
  fs.mkdirSync(path.join(pkgDir, ASSETS_VIDEO_SUBDIR), { recursive: true });

  // ── Resolve hook moments + shorts windows (auto-detect if missing) ─────────
  const hookMoments = req.hook_moments.length > 0
    ? req.hook_moments
    : autoDetectHookMoments(req);

  const effectiveReq: CapCutPackageRequest = { ...req, hook_moments: hookMoments };

  const shortsWindows: ShortsExtractionWindow[] = req.shorts_windows.length > 0
    ? req.shorts_windows
    : autoDetectShortsWindows(effectiveReq);

  // ── Build data structures ─────────────────────────────────────────────────
  const clips: CapCutClipEntry[] = buildClipsManifest(effectiveReq);
  const timeline: CapCutTimeline  = buildTimeline(effectiveReq, clips);
  const srtEntries: SrtEntry[]    = buildSrtEntries(effectiveReq);
  const srtText: string           = renderSrt(srtEntries);
  const editMarkdown: string      = renderEditManifestMarkdown(effectiveReq, clips, shortsWindows);

  // ── Copy audio asset ──────────────────────────────────────────────────────
  let resolvedAudioPath: string | null = req.winner_audio_path;
  if (req.winner_audio_path && fs.existsSync(req.winner_audio_path)) {
    try {
      const audioFilename = path.basename(req.winner_audio_path);
      const destAudio = path.join(audioDir, audioFilename);
      fs.copyFileSync(req.winner_audio_path, destAudio);
      resolvedAudioPath = destAudio;
    } catch {
      // Keep original path reference if copy fails
    }
  }

  // Update audio track with the (possibly copied) path
  if (resolvedAudioPath && timeline.audio_track[0]) {
    timeline.audio_track[0].audio_path = resolvedAudioPath;
  }

  // ── Write artifacts ───────────────────────────────────────────────────────
  let clipsManifestPath = '';
  let timelinePath = '';
  let subtitlesPath = '';
  let editManifestPath = '';

  try {
    clipsManifestPath = path.join(pkgDir, CLIPS_MANIFEST_FILE);
    fs.writeFileSync(clipsManifestPath, JSON.stringify({ clips }, null, 2), 'utf-8');
  } catch { clipsManifestPath = ''; }

  try {
    timelinePath = path.join(pkgDir, TIMELINE_FILE);
    fs.writeFileSync(timelinePath, JSON.stringify(timeline, null, 2), 'utf-8');
  } catch { timelinePath = ''; }

  try {
    subtitlesPath = path.join(pkgDir, SUBTITLES_FILE);
    fs.writeFileSync(subtitlesPath, srtText, 'utf-8');
  } catch { subtitlesPath = ''; }

  try {
    editManifestPath = path.join(pkgDir, EDIT_MANIFEST_FILE);
    fs.writeFileSync(editManifestPath, editMarkdown, 'utf-8');
  } catch { editManifestPath = ''; }

  // ── Build run manifest ────────────────────────────────────────────────────
  const clipsAvailable = clips.filter((c) => c.clip_available).length;
  const manifestPath   = path.join(pkgDir, MANIFEST_FILENAME);

  const run: CapCutPackageRun = {
    run_dir:              runDir,
    package_dir:          pkgDir,
    manifest_path:        manifestPath,
    clips_manifest_path:  clipsManifestPath,
    timeline_path:        timelinePath,
    subtitles_path:       subtitlesPath,
    edit_manifest_path:   editManifestPath,
    total_scenes:         clips.length,
    clips_available:      clipsAvailable,
    clips_missing:        clips.length - clipsAvailable,
    has_audio:            resolvedAudioPath !== null && fs.existsSync(resolvedAudioPath ?? ''),
    shorts_windows:       shortsWindows,
    created_at:           new Date().toISOString(),
  };

  try {
    fs.writeFileSync(manifestPath, JSON.stringify(run, null, 2), 'utf-8');
  } catch { /* manifest write failure is non-fatal */ }

  return run;
}

// ─── Load manifest ────────────────────────────────────────────────────────────

/**
 * Load a previously written CapCutPackageRun manifest from a run directory.
 * Returns null if the file is missing or fails schema validation.
 */
export function loadCapCutPackageManifest(runDir: string): CapCutPackageRun | null {
  const manifestPath = path.join(runDir, PACKAGE_SUBDIR, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const raw    = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const result = CapCutPackageRunSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

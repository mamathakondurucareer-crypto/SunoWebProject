/**
 * Local storage module for Grok video generation artifacts.
 *
 * Per-scene directory structure:
 *
 *   {runDir}/video/
 *     scene_001/
 *       prompt.txt
 *       request_settings.json
 *       scene_001.mp4          ← downloaded video (may be absent on failure)
 *       metadata.json
 *       failure_screenshot.png ← on failure only
 *       failure.html           ← on failure only
 *     scene_002/
 *       ...
 *     generation_manifest.json
 *
 * Never throws — all errors are caught; missing data surfaces as null paths.
 */

import fs from 'fs';
import path from 'path';
import type { GrokSceneResult, GrokGenerationRun } from './types';
import { GrokGenerationRunSchema } from './schema';

// ─── Constants ────────────────────────────────────────────────────────────────

const GENERATION_MANIFEST_FILENAME = 'generation_manifest.json';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a zero-padded scene directory name, e.g. "scene_001" */
export function sceneDir(runDir: string, sceneNumber: number): string {
  const padded = String(sceneNumber).padStart(3, '0');
  return path.join(runDir, 'video', `scene_${padded}`);
}

/** Returns the expected .mp4 filename for a scene, e.g. "scene_001.mp4" */
export function sceneVideoFilename(sceneNumber: number): string {
  return `scene_${String(sceneNumber).padStart(3, '0')}.mp4`;
}

// ─── Per-scene artifact write ─────────────────────────────────────────────────

/**
 * Write all per-scene artifacts to `{runDir}/video/scene_NNN/`.
 *
 * Writes:
 *   - `prompt.txt`             — the raw grok_prompt string
 *   - `request_settings.json`  — the GrokRequestSettings used
 *   - `metadata.json`          — the full GrokSceneResult object
 *
 * The video file and failure screenshots are written by the adapter directly;
 * this function only writes the JSON/text artifacts.
 *
 * Returns the absolute path of the scene directory.
 */
export function saveSceneArtifacts(result: GrokSceneResult, runDir: string): string {
  const dir = sceneDir(runDir, result.scene_number);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, 'prompt.txt'), result.grok_prompt, 'utf-8');
  fs.writeFileSync(
    path.join(dir, 'request_settings.json'),
    JSON.stringify(result.settings, null, 2),
    'utf-8'
  );
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(result, null, 2), 'utf-8');

  return dir;
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

/**
 * Write the top-level `generation_manifest.json` to `{runDir}/video/`.
 *
 * This is a summary across all scenes and is always written last.
 */
export function saveGenerationManifest(run: GrokGenerationRun, runDir: string): string {
  const videoDir = path.join(runDir, 'video');
  fs.mkdirSync(videoDir, { recursive: true });

  const manifestPath = path.join(videoDir, GENERATION_MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, JSON.stringify(run, null, 2), 'utf-8');
  return manifestPath;
}

/**
 * Load a `GrokGenerationRun` manifest from a run directory.
 *
 * Returns `null` if the file is missing or fails to parse.
 */
export function loadGenerationManifest(runDir: string): GrokGenerationRun | null {
  const manifestPath = path.join(runDir, 'video', GENERATION_MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const result = GrokGenerationRunSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Snap a raw duration target (seconds) to the nearest Grok-supported value.
 *
 * Grok supports: 5 | 10 | 15 | 20
 *   ≤ 7  → 5
 *   ≤ 12 → 10
 *   ≤ 17 → 15
 *   >  17 → 20
 */
export function roundToGrokDuration(target: number): 5 | 10 | 15 | 20 {
  if (target <= 7) return 5;
  if (target <= 12) return 10;
  if (target <= 17) return 15;
  return 20;
}

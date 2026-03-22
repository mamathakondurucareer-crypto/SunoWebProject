/**
 * Local storage module for Suno generation artifacts.
 *
 * Responsibilities:
 *   1. Write candidate audio metadata and payload JSON to the run directory
 *   2. Return a SunoStoredRun with all absolute paths
 *   3. Load a previously-saved run back from disk
 *
 * Never throws — all errors are caught; missing data surfaces as null paths.
 */

import fs from 'fs';
import path from 'path';
import type { SunoGenerationResult, SunoStoredRun } from './types';
import { SunoGenerationResultSchema, SunoStoredRunSchema } from './schema';

// ─── Constants ────────────────────────────────────────────────────────────────

const METADATA_FILENAME = 'suno_metadata.json';
const REQUEST_PAYLOAD_FILENAME = 'suno_request_payload.json';
const CANDIDATE_A_AUDIO_FILENAME = 'suno_candidate_a.mp3';
const CANDIDATE_B_AUDIO_FILENAME = 'suno_candidate_b.mp3';
const CANDIDATE_A_THUMBNAIL_FILENAME = 'suno_candidate_a_thumb.png';
const CANDIDATE_B_THUMBNAIL_FILENAME = 'suno_candidate_b_thumb.png';
const CANDIDATES_SCREENSHOT_FILENAME = 'suno_candidates.png';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Persist a completed `SunoGenerationResult` to `runDir`.
 *
 * Writes:
 *   - `suno_metadata.json`      — full result object
 *   - `suno_request_payload.json` — just the submission payload
 *
 * Audio and thumbnail files are written by the adapter directly (via Playwright
 * downloads / screenshots). This function records their expected paths and
 * checks which exist on disk so that `SunoStoredRun` reflects reality.
 *
 * Returns a `SunoStoredRun` with absolute paths (null when not on disk).
 */
export function saveSunoRun(result: SunoGenerationResult, runDir: string): SunoStoredRun {
  fs.mkdirSync(runDir, { recursive: true });

  // Write metadata JSON
  const metadataPath = path.join(runDir, METADATA_FILENAME);
  fs.writeFileSync(metadataPath, JSON.stringify(result, null, 2), 'utf-8');

  // Write request payload JSON
  const requestPayloadPath = path.join(runDir, REQUEST_PAYLOAD_FILENAME);
  fs.writeFileSync(
    requestPayloadPath,
    JSON.stringify(result.request_payload, null, 2),
    'utf-8'
  );

  // Resolve audio paths — use candidate.audio_path if already set, else expected default
  const candidateAAudio =
    result.candidate_a.audio_path ??
    path.join(runDir, 'audio', CANDIDATE_A_AUDIO_FILENAME);
  const candidateBAudio =
    result.candidate_b.audio_path ??
    path.join(runDir, 'audio', CANDIDATE_B_AUDIO_FILENAME);

  // Resolve thumbnail paths
  const candidateAThumb =
    result.candidate_a.thumbnail_path ??
    path.join(runDir, CANDIDATE_A_THUMBNAIL_FILENAME);
  const candidateBThumb =
    result.candidate_b.thumbnail_path ??
    path.join(runDir, CANDIDATE_B_THUMBNAIL_FILENAME);

  const screenshotPath = path.join(runDir, CANDIDATES_SCREENSHOT_FILENAME);

  const stored: SunoStoredRun = {
    run_dir: runDir,
    metadata_path: metadataPath,
    request_payload_path: requestPayloadPath,
    candidate_a_audio: fs.existsSync(candidateAAudio) ? candidateAAudio : null,
    candidate_b_audio: fs.existsSync(candidateBAudio) ? candidateBAudio : null,
    candidate_a_thumbnail: fs.existsSync(candidateAThumb) ? candidateAThumb : null,
    candidate_b_thumbnail: fs.existsSync(candidateBThumb) ? candidateBThumb : null,
    candidates_screenshot: fs.existsSync(screenshotPath) ? screenshotPath : null,
  };

  return stored;
}

/**
 * Load a `SunoGenerationResult` from a previously-saved run directory.
 *
 * Returns `null` if the file doesn't exist or fails to parse.
 */
export function loadSunoRun(runDir: string): SunoGenerationResult | null {
  const metadataPath = path.join(runDir, METADATA_FILENAME);
  if (!fs.existsSync(metadataPath)) return null;

  try {
    const raw = fs.readFileSync(metadataPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const result = SunoGenerationResultSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Load a `SunoStoredRun` manifest from an existing run directory by
 * re-deriving all paths and checking the filesystem.
 *
 * Useful when the manifest was not explicitly saved but the run dir exists.
 */
export function deriveSunoStoredRun(
  result: SunoGenerationResult,
  runDir: string
): SunoStoredRun {
  const metadataPath = path.join(runDir, METADATA_FILENAME);
  const requestPayloadPath = path.join(runDir, REQUEST_PAYLOAD_FILENAME);

  const candidateAAudio =
    result.candidate_a.audio_path ??
    path.join(runDir, 'audio', CANDIDATE_A_AUDIO_FILENAME);
  const candidateBAudio =
    result.candidate_b.audio_path ??
    path.join(runDir, 'audio', CANDIDATE_B_AUDIO_FILENAME);

  const candidateAThumb =
    result.candidate_a.thumbnail_path ??
    path.join(runDir, CANDIDATE_A_THUMBNAIL_FILENAME);
  const candidateBThumb =
    result.candidate_b.thumbnail_path ??
    path.join(runDir, CANDIDATE_B_THUMBNAIL_FILENAME);

  const screenshotPath = path.join(runDir, CANDIDATES_SCREENSHOT_FILENAME);

  return {
    run_dir: runDir,
    metadata_path: metadataPath,
    request_payload_path: requestPayloadPath,
    candidate_a_audio: fs.existsSync(candidateAAudio) ? candidateAAudio : null,
    candidate_b_audio: fs.existsSync(candidateBAudio) ? candidateBAudio : null,
    candidate_a_thumbnail: fs.existsSync(candidateAThumb) ? candidateAThumb : null,
    candidate_b_thumbnail: fs.existsSync(candidateBThumb) ? candidateBThumb : null,
    candidates_screenshot: fs.existsSync(screenshotPath) ? screenshotPath : null,
  };
}

/**
 * Parse a duration string like "3:42" or "1:02:15" into total seconds.
 * Returns null if the input is not parseable.
 */
export function parseDurationSeconds(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const parts = trimmed.split(':').map((p) => parseInt(p, 10));
  if (parts.some(isNaN)) return null;

  if (parts.length === 2) {
    const [mins, secs] = parts as [number, number];
    return mins * 60 + secs;
  }
  if (parts.length === 3) {
    const [hours, mins, secs] = parts as [number, number, number];
    return hours * 3600 + mins * 60 + secs;
  }
  return null;
}

/**
 * Validate a `SunoStoredRun` object with Zod.
 * Returns `{ valid: true, data }` or `{ valid: false, errors }`.
 */
export function validateStoredRun(
  stored: unknown
): { valid: true; data: SunoStoredRun } | { valid: false; errors: string[] } {
  const result = SunoStoredRunSchema.safeParse(stored);
  if (result.success) {
    return { valid: true, data: result.data };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  };
}

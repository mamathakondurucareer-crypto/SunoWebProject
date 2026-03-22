/**
 * Parser for ChatGPT scene prompt refinement responses.
 *
 * Uses the same `=== SECTION ===` delimiter strategy as the eval parsers:
 * split on capturing-group regex → Map<UPPER_KEY, body> → typed output.
 *
 * Never throws — all errors return null or an empty array.
 */

import type { RefinedScenePrompt } from './types';
import type { MusicalSection } from '@/lib/scene-plan/types';

// ─── Section extraction (shared strategy) ────────────────────────────────────

function extractSections(raw: string): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = raw.split(/^=== SECTION ===[ \t]*(\S+)[ \t]*$/m);

  for (let i = 1; i + 1 < parts.length; i += 2) {
    const key = (parts[i] ?? '').trim().toUpperCase();
    const body = (parts[i + 1] ?? '').trim();
    sections.set(key, body);
  }
  return sections;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseText(v: string | undefined): string {
  return (v ?? '').trim();
}

function parseCommaSeparated(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function parseDuration(v: string | undefined, fallback: number): number {
  const n = parseInt((v ?? '').trim(), 10);
  return isNaN(n) || n <= 0 ? fallback : n;
}

function parseAspectRatio(v: string | undefined): '9:16' | '16:9' | '1:1' {
  const s = (v ?? '').trim();
  if (s === '16:9' || s === '1:1') return s;
  return '9:16';  // default for vertical devotional video
}

// ─── Scene key utilities ──────────────────────────────────────────────────────

/**
 * Extract all unique zero-padded scene numbers from section keys.
 * e.g. "SCENE_01_GROK_PROMPT" → "01"
 */
function extractSceneNumbers(sections: Map<string, string>): string[] {
  const seen = new Set<string>();
  for (const key of sections.keys()) {
    const m = /^SCENE_(\d+)_/.exec(key);
    if (m) seen.add(m[1]!);
  }
  return Array.from(seen).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

// ─── Per-scene section key builders ──────────────────────────────────────────

function sceneKey(num: string, field: string): string {
  return `SCENE_${num}_${field}`;
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export interface SceneSourceRow {
  scene_number: number;
  section: MusicalSection;
  start_sec: number;
  end_sec: number;
}

/**
 * Parse a batched ChatGPT refinement response.
 *
 * @param raw           Raw ChatGPT response text
 * @param sourceScenes  Original scene list from timed_scene_manifest.json — used
 *                      to back-fill section, start_sec, end_sec, and duration_target
 *                      when ChatGPT omits them.
 * @returns Array of RefinedScenePrompt, or null if no scenes could be parsed.
 */
export function parseRefinedPrompts(
  raw: string,
  sourceScenes: SceneSourceRow[]
): RefinedScenePrompt[] | null {
  if (!raw || raw.trim().length === 0) return null;

  const sections = extractSections(raw);
  const sceneNums = extractSceneNumbers(sections);
  if (sceneNums.length === 0) return null;

  // Build a lookup: scene_number → source row
  const sourceMap = new Map<number, SceneSourceRow>();
  for (const row of sourceScenes) {
    sourceMap.set(row.scene_number, row);
  }

  const results: RefinedScenePrompt[] = [];

  for (const num of sceneNums) {
    const sceneNumber = parseInt(num, 10);
    const source = sourceMap.get(sceneNumber);

    const grokPrompt = parseText(sections.get(sceneKey(num, 'GROK_PROMPT')));
    if (grokPrompt.length < 10) continue;  // skip malformed scene blocks

    const fallbackDuration = source ? Math.round(source.end_sec - source.start_sec) : 10;

    results.push({
      scene_number:       sceneNumber,
      section:            source?.section ?? 'unknown',
      start_sec:          source?.start_sec ?? 0,
      end_sec:            source?.end_sec ?? fallbackDuration,
      duration_target:    parseDuration(sections.get(sceneKey(num, 'DURATION_TARGET')), fallbackDuration),
      aspect_ratio:       parseAspectRatio(sections.get(sceneKey(num, 'ASPECT_RATIO'))),
      grok_prompt:        grokPrompt,
      continuity_note:    parseText(sections.get(sceneKey(num, 'CONTINUITY_NOTE'))),
      visual_emphasis:    parseText(sections.get(sceneKey(num, 'VISUAL_EMPHASIS'))),
      negative_constraints: parseCommaSeparated(sections.get(sceneKey(num, 'NEGATIVE_CONSTRAINTS'))),
      public_safe_wording: parseText(sections.get(sceneKey(num, 'PUBLIC_SAFE_WORDING'))),
    });
  }

  return results.length > 0 ? results : null;
}

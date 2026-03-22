/**
 * CapCut handoff adapter — local package generation.
 *
 * CapCut is a desktop/mobile app; there is no public automation API in v1.
 * This adapter builds a complete handoff package on disk that the editor
 * can import directly into CapCut Desktop.
 *
 * Stage input (ctx.stageRun.input):
 *   song_title              string   optional — falls back to project name
 *   devotional_theme        string   optional — falls back to project theme
 *   winner_audio_path       string   absolute path to the winning audio file
 *   audio_duration_seconds  number   total audio duration in seconds
 *   lyrics                  string   raw lyrics with [Section] markers
 *   scenes                  object[] SceneSegment array from scene-plan stage
 *   grok_results            object[] GrokSceneResult array from grok stage
 *   hook_moments            object[] optional HookMoment array
 *   shorts_windows          object[] optional ShortsExtractionWindow array
 *   target_aspect_ratio     string   '16:9' | '9:16'  — defaults to '16:9'
 *   fps                     number   24 | 25 | 30      — defaults to 24
 *   resolution              object   { width, height } — defaults to 1920×1080
 *
 * Stage output (result.output):
 *   run_dir                 string
 *   package_dir             string
 *   manifest_path           string
 *   clips_manifest_path     string
 *   timeline_path           string
 *   subtitles_path          string
 *   edit_manifest_path      string
 *   total_scenes            number
 *   clips_available         number
 *   clips_missing           number
 *   has_audio               boolean
 *   shorts_windows          object[]
 *   created_at              string
 */

import type { Page } from 'playwright';
import { BaseServiceAdapter, type SelectorMap } from './base';
import type { StageContext, StageResult } from '@/types';
import {
  saveCapCutPackage,
  CRITICAL_CAPCUT_RULES,
  WARN_CAPCUT_RULES,
  CapCutPackageRequestSchema,
} from '@/lib/capcut';
import type { CapCutPackageRequest, HookMoment, ShortsExtractionWindow } from '@/lib/capcut';

// ─── CapCutAdapter ────────────────────────────────────────────────────────────

export class CapCutAdapter extends BaseServiceAdapter {
  constructor(profilePath: string) {
    super('capcut', profilePath);
  }

  /** Not applicable for this local-only adapter. */
  async isLoggedIn(_page: Page): Promise<boolean> {
    return true;
  }

  async execute(ctx: StageContext, _selectors: SelectorMap): Promise<StageResult> {
    const input = (ctx.stageRun.input ?? {}) as Record<string, unknown>;

    // ── Build package request from stage input ─────────────────────────────

    const req = buildPackageRequest(input, ctx.project.name, ctx.project.devotional_theme);

    // Validate the assembled request
    const parsed = CapCutPackageRequestSchema.safeParse(req);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid CapCut package request: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      };
    }

    // ── Generate package locally — no browser required ─────────────────────

    this.log.info('package', 'Building CapCut handoff package…');
    let run: import('@/lib/capcut').CapCutPackageRun;
    try {
      run = saveCapCutPackage(parsed.data as CapCutPackageRequest, ctx.runDir);
    } catch (err) {
      return {
        success: false,
        error: `CapCut package generation failed: ${String(err)}`,
      };
    }
    this.log.info('package', `Package written to: ${run.package_dir}`);
    this.log.info('package', `Scenes: ${run.clips_available}/${run.total_scenes} clips available`);

    // ── Apply validation rules ─────────────────────────────────────────────

    const errors: string[] = [];
    const warnings: string[] = [];

    for (const rule of CRITICAL_CAPCUT_RULES) {
      if (!rule.check(run)) errors.push(rule.message(run));
    }
    for (const rule of WARN_CAPCUT_RULES) {
      if (!rule.check(run)) warnings.push(rule.message(run));
    }

    if (errors.length > 0) {
      return {
        success: false,
        error: errors.join('; '),
        output: run as unknown as Record<string, unknown>,
      };
    }

    // ── Collect asset paths for the UI ────────────────────────────────────

    const assetPaths: StageResult['assetPaths'] = [];

    if (run.edit_manifest_path) {
      assetPaths.push({
        path: run.edit_manifest_path,
        type: 'document',
        name: 'CapCut Editorial Guide',
      });
    }
    if (run.clips_manifest_path) {
      assetPaths.push({
        path: run.clips_manifest_path,
        type: 'document',
        name: 'Clips Manifest (JSON)',
        mimeType: 'application/json',
      });
    }
    if (run.timeline_path) {
      assetPaths.push({
        path: run.timeline_path,
        type: 'document',
        name: 'Timeline Descriptor (JSON)',
        mimeType: 'application/json',
      });
    }
    if (run.subtitles_path) {
      assetPaths.push({
        path: run.subtitles_path,
        type: 'document',
        name: 'Subtitles (SRT)',
      });
    }

    return {
      success: true,
      output: {
        ...(run as unknown as Record<string, unknown>),
        ...(warnings.length > 0 ? { warnings } : {}),
      },
      assetPaths,
    };
  }
}

// ─── Input builder ────────────────────────────────────────────────────────────

const DEFAULT_FPS      = 24 as const;
const DEFAULT_WIDTH    = 1920;
const DEFAULT_HEIGHT   = 1080;
const DEFAULT_RATIO    = '16:9' as const;

function buildPackageRequest(
  input: Record<string, unknown>,
  projectName: string,
  projectTheme: string,
): CapCutPackageRequest {
  // fps — must be 24 | 25 | 30
  const fpsRaw = Number(input.fps ?? DEFAULT_FPS);
  const fps: 24 | 25 | 30 = (fpsRaw === 25 || fpsRaw === 30) ? fpsRaw : DEFAULT_FPS;

  // resolution
  let resolution = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  if (
    input.resolution &&
    typeof input.resolution === 'object' &&
    'width' in (input.resolution as object) &&
    'height' in (input.resolution as object)
  ) {
    const r = input.resolution as { width: unknown; height: unknown };
    const w = Number(r.width);
    const h = Number(r.height);
    if (w > 0 && h > 0) resolution = { width: w, height: h };
  }

  // target_aspect_ratio
  const ratioRaw = String(input.target_aspect_ratio ?? DEFAULT_RATIO);
  const target_aspect_ratio: '16:9' | '9:16' =
    ratioRaw === '9:16' ? '9:16' : DEFAULT_RATIO;

  // scenes — pass through as-is; schema validates shape
  const scenes = Array.isArray(input.scenes) ? input.scenes : [];

  // grok_results
  const grok_results: CapCutPackageRequest['grok_results'] = Array.isArray(input.grok_results)
    ? (input.grok_results as CapCutPackageRequest['grok_results'])
    : [];

  // hook_moments — validate each entry has required fields
  const hook_moments: HookMoment[] = [];
  if (Array.isArray(input.hook_moments)) {
    for (const h of input.hook_moments as unknown[]) {
      if (h && typeof h === 'object') {
        const m = h as Record<string, unknown>;
        if (typeof m.timestamp_sec === 'number' && typeof m.description === 'string') {
          hook_moments.push({
            timestamp_sec:  m.timestamp_sec,
            description:    m.description,
            lyric_line:     typeof m.lyric_line === 'string' ? m.lyric_line : undefined,
            emphasis_type:  (m.emphasis_type as HookMoment['emphasis_type']) ?? 'lyric_punch',
          });
        }
      }
    }
  }

  // shorts_windows
  const shorts_windows: ShortsExtractionWindow[] = [];
  if (Array.isArray(input.shorts_windows)) {
    for (const w of input.shorts_windows as unknown[]) {
      if (w && typeof w === 'object') {
        const sw = w as Record<string, unknown>;
        if (typeof sw.start_sec === 'number' && typeof sw.end_sec === 'number') {
          shorts_windows.push({
            start_sec:    sw.start_sec,
            end_sec:      sw.end_sec,
            rationale:    typeof sw.rationale    === 'string' ? sw.rationale    : '',
            platform:     (sw.platform as ShortsExtractionWindow['platform']) ?? 'YouTube Shorts',
            reframe_note: typeof sw.reframe_note === 'string' ? sw.reframe_note : '',
          });
        }
      }
    }
  }

  return {
    song_title:             String(input.song_title    ?? projectName),
    devotional_theme:       String(input.devotional_theme ?? projectTheme),
    winner_audio_path:      input.winner_audio_path ? String(input.winner_audio_path) : null,
    audio_duration_seconds: Number(input.audio_duration_seconds ?? 180),
    lyrics:                 String(input.lyrics ?? ''),
    scenes:                 scenes as CapCutPackageRequest['scenes'],
    grok_results:           grok_results,
    hook_moments,
    shorts_windows,
    target_aspect_ratio,
    fps,
    resolution,
  };
}

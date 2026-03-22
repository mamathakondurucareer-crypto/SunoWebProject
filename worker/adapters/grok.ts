import type { Page } from 'playwright';
import { BaseServiceAdapter, type SelectorMap } from './base';
import type { StageContext, StageResult } from '@/types';
import {
  registerDefaults,
  captureDiagnosticBundle,
  captureConsoleErrors,
  downloadViaPageFetch,
  extractVideoSrc,
  pollForNewFile,
  snapshotDir,
} from '../browser';
import {
  saveSceneArtifacts,
  saveGenerationManifest,
  roundToGrokDuration,
  sceneDir,
  sceneVideoFilename,
  CRITICAL_GROK_RULES,
  WARN_GROK_RULES,
} from '@/lib/grok';
import type {
  GrokSceneRequest,
  GrokSceneResult,
  GrokRequestSettings,
  GrokGenerationRun,
  GrokDuration,
} from '@/lib/grok';
import fs from 'fs';
import path from 'path';

const GROK_URL = 'https://grok.com';

// ─── Selector defaults ────────────────────────────────────────────────────────

registerDefaults('grok', {
  prompt_input: [
    'textarea[placeholder*="Describe" i]',
    'textarea[placeholder*="prompt" i]',
    'div[contenteditable="true"][class*="prompt"]',
    '[data-testid="video-prompt"]',
    'textarea',
  ],
  generate_button: [
    'button:has-text("Generate")',
    'button[type="submit"]:has-text("Generate")',
    '[data-testid="generate-button"]',
    'button[aria-label*="Generate" i]',
    'button:has-text("Create")',
  ],
  duration_selector: [
    '[data-testid="duration-selector"]',
    'button[aria-label*="duration" i]',
    '[class*="DurationPicker"]',
    '[class*="duration-picker"]',
    'select[name*="duration"]',
  ],
  aspect_ratio_selector: [
    '[data-testid="aspect-ratio-selector"]',
    'button[aria-label*="aspect" i]',
    '[class*="AspectRatio"]',
    '[class*="aspect-ratio"]',
    'select[name*="aspect"]',
  ],
  variations_selector: [
    '[data-testid="variations-selector"]',
    'button[aria-label*="variation" i]',
    '[class*="Variations"]',
    'select[name*="variation"]',
  ],
  generation_status: [
    '[data-testid="generation-status"]',
    '[class*="GenerationStatus"]',
    '[class*="generation-status"]',
    '[class*="progress"]',
    '[aria-label*="generating" i]',
  ],
  video_result: [
    'video[src]',
    '[data-testid="video-result"] video',
    '[class*="VideoPlayer"] video',
    '[class*="video-player"] video',
    'video',
  ],
  download_button: [
    'button[aria-label*="Download" i]',
    '[data-testid="download-button"]',
    'button:has-text("Download")',
    'a[download]',
    '[class*="download"]',
  ],
  queue_item: [
    '[data-testid="queue-item"]',
    '[class*="QueueItem"]',
    '[class*="queue-item"]',
    '[class*="GenerationItem"]',
  ],
});

// ─── Timing constants ─────────────────────────────────────────────────────────

/** Max time to wait for a single scene to reach 'complete' status */
const SCENE_GENERATION_TIMEOUT_MS = 600_000; // 10 minutes
/** Polling interval while waiting for video */
const POLL_INTERVAL_MS = 8_000;
/** Max poll iterations per scene */
const MAX_POLL_ITERS = SCENE_GENERATION_TIMEOUT_MS / POLL_INTERVAL_MS;
/** How long to wait after submit before first poll */
const INITIAL_SUBMIT_WAIT_MS = 5_000;
/** Default resolution if not specified */
const DEFAULT_RESOLUTION = '720p' as const;
/** Default variation count */
const DEFAULT_VARIATIONS = 1;

// ─── GrokAdapter ──────────────────────────────────────────────────────────────

export class GrokAdapter extends BaseServiceAdapter {
  constructor(profilePath: string) {
    // Grok generation can take up to 10 minutes per scene
    super('grok', profilePath, { timeout: 660_000, navTimeout: 60_000 });
  }

  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      const loginCount = await page
        .locator(
          'button:has-text("Log in"), button:has-text("Sign in"), a[href*="/login"], a[href*="/sign-in"]'
        )
        .count();
      return loginCount === 0;
    } catch {
      return false;
    }
  }

  async execute(ctx: StageContext, selectors: SelectorMap): Promise<StageResult> {
    const page = await this.getPage();
    const consoleCapture = captureConsoleErrors(page);

    try {
      this.log.info('execute', 'Navigating to Grok', { url: GROK_URL });
      await page.goto(GROK_URL, { waitUntil: 'domcontentloaded' });
      await this.waitForNetworkIdle(page, 15_000);

      if (!(await this.isLoggedIn(page))) {
        consoleCapture.stop();
        return {
          success: false,
          error: 'Grok: Not logged in. Please connect the Grok browser profile from Settings.',
        };
      }

      return await this.executeGrokGeneration(page, ctx, selectors);
    } catch (err) {
      this.log.error('execute', `Grok execution failed: ${String(err)}`);
      consoleCapture.stop();

      const bundle = await captureDiagnosticBundle(page, ctx.runDir, ctx.stageRun.stage_key, {
        consoleCapture,
      });

      return {
        success: false,
        error: String(err),
        assetPaths: [
          ...(bundle.screenshot
            ? [{ path: bundle.screenshot, type: 'screenshot' as const, name: 'Failure Screenshot' }]
            : []),
          ...(bundle.html
            ? [{ path: bundle.html, type: 'html_dump' as const, name: 'Failure HTML' }]
            : []),
          ...(bundle.manifestPath
            ? [{ path: bundle.manifestPath, type: 'document' as const, name: 'Diagnostic Bundle' }]
            : []),
        ],
      };
    } finally {
      consoleCapture.stop();
    }
  }

  // ─── Main generation flow ──────────────────────────────────────────────────

  private async executeGrokGeneration(
    page: Page,
    ctx: StageContext,
    selectors: SelectorMap
  ): Promise<StageResult> {
    const input = ctx.stageRun.input ?? {};

    // Accept scenes from prompt_refinement_manifest or direct scene_requests array
    const rawScenes = (input.scenes as GrokSceneRequest[]) ?? [];
    if (rawScenes.length === 0) {
      return { success: false, error: 'Grok: No scene requests provided in stage input' };
    }

    const resolution = (input.resolution as string) ?? DEFAULT_RESOLUTION;
    const variationsOverride =
      typeof input.variations === 'number' ? (input.variations as number) : DEFAULT_VARIATIONS;

    const runDir = ctx.runDir;
    const videoDir = path.join(runDir, 'video');
    fs.mkdirSync(videoDir, { recursive: true });

    const sceneResults: GrokSceneResult[] = [];
    const assetPaths: StageResult['assetPaths'] = [];
    const warnings: string[] = [];

    // Sequential mode: submit → wait → download → next scene
    for (const sceneReq of rawScenes) {
      const result = await this.processScene(
        page,
        sceneReq,
        runDir,
        resolution as '480p' | '720p' | '1080p',
        variationsOverride,
        selectors
      );
      sceneResults.push(result);

      // Register per-scene assets
      if (result.video_path) {
        assetPaths!.push({
          path: result.video_path,
          type: 'video',
          name: `Scene ${result.scene_number} Video`,
          mimeType: 'video/mp4',
        });
      }
      if (result.screenshot_path) {
        assetPaths!.push({
          path: result.screenshot_path,
          type: 'screenshot',
          name: `Scene ${result.scene_number} Screenshot`,
        });
      }
      if (result.failure_html_path) {
        assetPaths!.push({
          path: result.failure_html_path,
          type: 'html_dump',
          name: `Scene ${result.scene_number} Failure HTML`,
        });
      }

      // Navigate back to Grok home for next scene
      if (rawScenes.indexOf(sceneReq) < rawScenes.length - 1) {
        await page.goto(GROK_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(2_000);
      }
    }

    // ── Build run manifest ───────────────────────────────────────────────────
    const successfulScenes = sceneResults.filter((s) => s.status === 'complete').length;
    const failedScenes = sceneResults.filter((s) => s.status === 'failed').length;

    const run: GrokGenerationRun = {
      total_scenes: rawScenes.length,
      successful_scenes: successfulScenes,
      failed_scenes: failedScenes,
      scenes: sceneResults,
      created_at: new Date().toISOString(),
      run_dir: runDir,
    };

    // ── Apply validation rules ───────────────────────────────────────────────
    const errors: string[] = [];
    for (const rule of CRITICAL_GROK_RULES) {
      if (!rule.check(run)) errors.push(rule.message(run));
    }
    for (const rule of WARN_GROK_RULES) {
      if (!rule.check(run)) warnings.push(rule.message(run));
    }

    // ── Save manifest ────────────────────────────────────────────────────────
    const manifestPath = saveGenerationManifest(run, runDir);
    assetPaths!.push({
      path: manifestPath,
      type: 'document',
      name: 'Grok Generation Manifest',
      mimeType: 'application/json',
    });

    this.log.info('executeGrokGeneration', 'Generation run complete', {
      total: run.total_scenes,
      successful: run.successful_scenes,
      failed: run.failed_scenes,
      warnings: warnings.length,
      errors: errors.length,
    });

    if (errors.length > 0) {
      return {
        success: false,
        error: `Grok generation validation failed: ${errors.join('; ')}`,
        output: this.buildOutput(run, manifestPath, warnings),
        assetPaths,
      };
    }

    return {
      success: true,
      output: this.buildOutput(run, manifestPath, warnings),
      assetPaths,
    };
  }

  // ─── Per-scene processing ──────────────────────────────────────────────────

  private async processScene(
    page: Page,
    sceneReq: GrokSceneRequest,
    runDir: string,
    resolution: '480p' | '720p' | '1080p',
    variationsOverride: number,
    selectors: SelectorMap
  ): Promise<GrokSceneResult> {
    const duration = roundToGrokDuration(sceneReq.duration_target);
    const settings: GrokRequestSettings = {
      duration_seconds: duration,
      aspect_ratio: sceneReq.aspect_ratio,
      variations: variationsOverride,
      resolution,
    };

    const submittedAt = Date.now();

    const base: GrokSceneResult = {
      scene_number: sceneReq.scene_number,
      status: 'pending',
      grok_prompt: sceneReq.grok_prompt,
      settings,
      video_path: null,
      video_url: null,
      generation_id: null,
      submitted_at: submittedAt,
      completed_at: null,
      duration_ms: null,
      error: null,
      screenshot_path: null,
      failure_html_path: null,
    };

    const dir = sceneDir(runDir, sceneReq.scene_number);
    fs.mkdirSync(dir, { recursive: true });

    try {
      this.log.info('processScene', `Scene ${sceneReq.scene_number}: submitting`, {
        duration,
        aspect_ratio: sceneReq.aspect_ratio,
      });

      // ── Fill prompt ───────────────────────────────────────────────────────
      await this.fillPrompt(page, selectors, sceneReq.grok_prompt);

      // ── Configure generation settings ─────────────────────────────────────
      await this.setDuration(page, selectors, duration);
      await this.setAspectRatio(page, selectors, sceneReq.aspect_ratio);
      await this.setVariations(page, selectors, variationsOverride);

      // ── Submit ─────────────────────────────────────────────────────────────
      await this.clickGenerate(page, selectors);
      base.status = 'queued';
      await page.waitForTimeout(INITIAL_SUBMIT_WAIT_MS);

      // ── Wait for completion ────────────────────────────────────────────────
      const generationId = await this.extractGenerationId(page);
      if (generationId) base.generation_id = generationId;

      const videoVisible = await this.waitForVideoComplete(page, selectors);
      if (!videoVisible) {
        throw new Error('Grok scene generation timed out — video never appeared');
      }

      base.status = 'generating';

      // ── Capture video URL ──────────────────────────────────────────────────
      const videoUrl = await this.extractVideoUrl(page, selectors);
      if (videoUrl) base.video_url = videoUrl;

      // ── Download video ─────────────────────────────────────────────────────
      const filename = sceneVideoFilename(sceneReq.scene_number);
      const videoPath = await this.downloadSceneVideo(page, selectors, dir, filename, videoUrl);

      base.video_path = videoPath;
      base.status = 'complete';
      base.completed_at = Date.now();
      base.duration_ms = base.completed_at - submittedAt;

      // ── Success screenshot ─────────────────────────────────────────────────
      const screenshotPath = path.join(dir, 'screenshot.png');
      await page.screenshot({ path: screenshotPath }).catch(() => {});
      if (fs.existsSync(screenshotPath)) base.screenshot_path = screenshotPath;

      this.log.info('processScene', `Scene ${sceneReq.scene_number}: complete`, {
        videoPath,
        duration_ms: base.duration_ms,
      });
    } catch (err) {
      const errMsg = String(err);
      this.log.error('processScene', `Scene ${sceneReq.scene_number} failed: ${errMsg}`);

      base.status = 'failed';
      base.error = errMsg;
      base.completed_at = Date.now();
      base.duration_ms = base.completed_at - submittedAt;

      // ── Failure artifacts ──────────────────────────────────────────────────
      const failSS = path.join(dir, 'failure_screenshot.png');
      await page.screenshot({ path: failSS }).catch(() => {});
      if (fs.existsSync(failSS)) base.screenshot_path = failSS;

      const failHtml = path.join(dir, 'failure.html');
      await page.content().then((html) => fs.writeFileSync(failHtml, html, 'utf-8')).catch(() => {});
      if (fs.existsSync(failHtml)) base.failure_html_path = failHtml;
    }

    // Always write per-scene artifacts
    saveSceneArtifacts(base, runDir);

    return base;
  }

  // ─── UI interaction helpers ────────────────────────────────────────────────

  private async fillPrompt(
    page: Page,
    selectors: SelectorMap,
    prompt: string
  ): Promise<void> {
    const sel = await this.resolveSelector('prompt_input', page, selectors);
    if (!sel) throw new Error('Grok: Could not find prompt input field');

    const field = page.locator(sel).first();
    await field.waitFor({ timeout: 20_000, state: 'visible' });
    await field.click();
    await field.fill(prompt);
    await page.waitForTimeout(300);
  }

  private async setDuration(
    page: Page,
    selectors: SelectorMap,
    duration: GrokDuration
  ): Promise<void> {
    const sel = await this.resolveSelector('duration_selector', page, selectors);
    if (!sel) {
      this.log.warn('setDuration', 'Duration selector not found — using default');
      return;
    }
    try {
      const el = page.locator(sel).first();
      if (!(await el.isVisible().catch(() => false))) return;

      const tagName = await el.evaluate((e) => e.tagName.toLowerCase());
      if (tagName === 'select') {
        await el.selectOption(String(duration));
      } else {
        // Button/toggle — look for a child or sibling with the duration label
        await el.click();
        await page.waitForTimeout(400);
        const opt = page.locator(`[role="option"]:has-text("${duration}"), button:has-text("${duration}s"), li:has-text("${duration}")`).first();
        if (await opt.isVisible().catch(() => false)) {
          await opt.click();
        }
      }
      await page.waitForTimeout(300);
    } catch {
      this.log.warn('setDuration', 'Could not set duration — using default');
    }
  }

  private async setAspectRatio(
    page: Page,
    selectors: SelectorMap,
    aspectRatio: string
  ): Promise<void> {
    const sel = await this.resolveSelector('aspect_ratio_selector', page, selectors);
    if (!sel) {
      this.log.warn('setAspectRatio', 'Aspect ratio selector not found — using default');
      return;
    }
    try {
      const el = page.locator(sel).first();
      if (!(await el.isVisible().catch(() => false))) return;

      const tagName = await el.evaluate((e) => e.tagName.toLowerCase());
      if (tagName === 'select') {
        await el.selectOption(aspectRatio);
      } else {
        await el.click();
        await page.waitForTimeout(400);
        const opt = page.locator(`[role="option"]:has-text("${aspectRatio}"), button:has-text("${aspectRatio}"), li:has-text("${aspectRatio}")`).first();
        if (await opt.isVisible().catch(() => false)) {
          await opt.click();
        }
      }
      await page.waitForTimeout(300);
    } catch {
      this.log.warn('setAspectRatio', 'Could not set aspect ratio — using default');
    }
  }

  private async setVariations(
    page: Page,
    selectors: SelectorMap,
    count: number
  ): Promise<void> {
    const sel = await this.resolveSelector('variations_selector', page, selectors);
    if (!sel) return;
    try {
      const el = page.locator(sel).first();
      if (!(await el.isVisible().catch(() => false))) return;

      const tagName = await el.evaluate((e) => e.tagName.toLowerCase());
      if (tagName === 'select') {
        await el.selectOption(String(count));
      } else {
        await el.click();
        await page.waitForTimeout(400);
        const opt = page.locator(`[role="option"]:has-text("${count}"), button:has-text("${count}"), li:has-text("${count}")`).first();
        if (await opt.isVisible().catch(() => false)) {
          await opt.click();
        }
      }
      await page.waitForTimeout(300);
    } catch {
      this.log.warn('setVariations', 'Could not set variations — using default');
    }
  }

  private async clickGenerate(page: Page, selectors: SelectorMap): Promise<void> {
    const sel = await this.resolveSelector('generate_button', page, selectors);
    if (!sel) throw new Error('Grok: Could not find Generate button');

    const btn = page.locator(sel).first();
    await btn.waitFor({ timeout: 15_000, state: 'visible' });
    await btn.click();
    this.log.info('clickGenerate', 'Generate button clicked');
  }

  // ─── Generation wait ───────────────────────────────────────────────────────

  private async waitForVideoComplete(
    page: Page,
    selectors: SelectorMap
  ): Promise<boolean> {
    const videoSel = await this.resolveSelector('video_result', page, selectors);
    if (!videoSel) return false;

    for (let i = 0; i < MAX_POLL_ITERS; i++) {
      await page.waitForTimeout(POLL_INTERVAL_MS);

      // Check for visible video element with a src
      const hasVideo = await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLVideoElement | null;
        return el !== null && (el.src?.length > 0 || el.currentSrc?.length > 0);
      }, videoSel.split(',')[0].trim()).catch(() => false);

      if (hasVideo) {
        this.log.info('waitForVideoComplete', `Video appeared after ${(i + 1) * POLL_INTERVAL_MS / 1000}s`);
        return true;
      }

      // Also check for any error/failure indicators
      const hasError = await page
        .locator('[class*="error" i]:visible, [class*="failed" i]:visible, [data-testid*="error"]:visible')
        .count()
        .then((c) => c > 0)
        .catch(() => false);

      if (hasError) {
        throw new Error('Grok reported an error during generation');
      }

      if (i % 5 === 0) {
        this.log.info('waitForVideoComplete', `Still waiting... (${(i + 1) * POLL_INTERVAL_MS / 1000}s elapsed)`);
      }
    }

    return false;
  }

  // ─── Data extraction helpers ───────────────────────────────────────────────

  private async extractGenerationId(page: Page): Promise<string | null> {
    try {
      // Look for generation ID in URL, data attributes, or network requests
      const url = page.url();
      const urlMatch = url.match(/\/generations?\/([a-f0-9-]{8,})/i);
      if (urlMatch) return urlMatch[1];

      return await page.evaluate(() => {
        const el = document.querySelector('[data-generation-id], [data-id]');
        if (el) {
          return (
            el.getAttribute('data-generation-id') ??
            el.getAttribute('data-id') ??
            null
          );
        }
        // Try to find it in any visible text that looks like a UUID
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
          const m = node.textContent?.match(/\b([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/i);
          if (m) return m[1];
        }
        return null;
      });
    } catch {
      return null;
    }
  }

  private async extractVideoUrl(
    page: Page,
    selectors: SelectorMap
  ): Promise<string | null> {
    try {
      const videoSel = await this.resolveSelector('video_result', page, selectors);
      if (videoSel) {
        const src = await extractVideoSrc(page, videoSel.split(',')[0].trim());
        if (src) return src;
      }

      // Fallback: find any video element with a src
      return await page.evaluate(() => {
        const videos = Array.from(document.querySelectorAll('video'));
        for (const v of videos) {
          const src = v.src || v.currentSrc;
          if (src && src.startsWith('http')) return src;
          const source = v.querySelector('source[src]');
          if (source) {
            const s = source.getAttribute('src');
            if (s && s.startsWith('http')) return s;
          }
        }
        return null;
      });
    } catch {
      return null;
    }
  }

  // ─── Video download ────────────────────────────────────────────────────────

  private async downloadSceneVideo(
    page: Page,
    selectors: SelectorMap,
    sceneDirectory: string,
    filename: string,
    videoUrl: string | null
  ): Promise<string | null> {
    const destPath = path.join(sceneDirectory, filename);

    // Strategy 1: Playwright download event via download button
    try {
      const dlSel = await this.resolveSelector('download_button', page, selectors);
      if (dlSel) {
        const dlBtn = page.locator(dlSel).first();
        if (await dlBtn.isVisible().catch(() => false)) {
          const saved = await this.saveDownload(
            page,
            () => dlBtn.click(),
            sceneDirectory,
            filename,
            120_000
          );
          if (saved) {
            this.log.info('downloadSceneVideo', 'Downloaded via download button', { saved });
            return saved;
          }
        }
      }
    } catch {
      // Fall through
    }

    // Strategy 2: downloadViaPageFetch using captured video URL
    if (videoUrl) {
      try {
        await downloadViaPageFetch(page, videoUrl, sceneDirectory, filename);
        if (fs.existsSync(destPath)) {
          this.log.info('downloadSceneVideo', 'Downloaded via page fetch', { url: videoUrl });
          return destPath;
        }
      } catch {
        // Fall through
      }
    }

    // Strategy 3: pollForNewFile (catches silent XHR blob saves)
    try {
      const before = snapshotDir(sceneDirectory);
      const found = await pollForNewFile(sceneDirectory, before, /\.(mp4|mov|webm)$/i, 30_000);
      if (found) {
        // Rename to expected filename if different
        if (found !== destPath) {
          fs.renameSync(found, destPath);
        }
        this.log.info('downloadSceneVideo', 'Downloaded via poll fallback', { found });
        return destPath;
      }
    } catch {
      // Fall through
    }

    this.log.warn('downloadSceneVideo', 'All download strategies failed — video_url recorded only');
    return null;
  }

  // ─── Output builders ───────────────────────────────────────────────────────

  private buildOutput(
    run: GrokGenerationRun,
    manifestPath: string,
    warnings: string[]
  ): Record<string, unknown> {
    return {
      total_scenes: run.total_scenes,
      successful_scenes: run.successful_scenes,
      failed_scenes: run.failed_scenes,
      scenes: run.scenes.map((s) => ({
        scene_number: s.scene_number,
        status: s.status,
        video_path: s.video_path,
        video_url: s.video_url,
        generation_id: s.generation_id,
        duration_ms: s.duration_ms,
        settings: s.settings,
        error: s.error,
      })),
      manifest_path: manifestPath,
      created_at: run.created_at,
      run_dir: run.run_dir,
      warnings,
    };
  }
}

import type { Page } from 'playwright';
import { BaseServiceAdapter, type SelectorMap } from './base';
import type { StageContext, StageResult } from '@/types';
import {
  registerDefaults,
  captureDiagnosticBundle,
  captureConsoleErrors,
  downloadViaPageFetch,
  extractAttribute,
} from '../browser';
import {
  saveSunoRun,
  parseDurationSeconds,
  CRITICAL_RULES,
  WARN_RULES,
} from '@/lib/suno';
import type {
  SunoCandidate,
  SunoGenerationResult,
  SunoRequestPayload,
} from '@/lib/suno';
import fs from 'fs';
import path from 'path';

const SUNO_CREATE_URL = 'https://suno.com/create';

// ─── Selector defaults ────────────────────────────────────────────────────────

registerDefaults('suno', {
  custom_mode_toggle: [
    'button:has-text("Custom")',
    '[data-testid="custom-mode-button"]',
    'button[aria-label*="Custom"]',
    '[class*="CustomMode"]',
  ],
  lyrics_input: [
    'textarea[placeholder*="lyrics" i]',
    'textarea[placeholder*="Lyrics" i]',
    '[data-testid="lyrics-input"]',
    '[contenteditable="true"][class*="lyrics"]',
  ],
  style_input: [
    'textarea[placeholder*="style" i]',
    'input[placeholder*="style" i]',
    '[data-testid="style-input"]',
    'textarea[placeholder*="Describe"]',
  ],
  title_input: [
    'input[placeholder*="title" i]',
    'input[placeholder*="Title" i]',
    '[data-testid="title-input"]',
    'input[name="title"]',
  ],
  create_button: [
    'button:has-text("Create")',
    'button[type="submit"]:has-text("Create")',
    '[data-testid="create-button"]',
    'button[aria-label*="Create"]',
  ],
  song_card: [
    '[data-testid="song-card"]',
    '[class*="SongCard"]',
    '[class*="song-card"]',
    '[class*="song-item"]',
    '[class*="ClipCard"]',
    '[class*="clip-card"]',
  ],
  song_title: [
    '[data-testid="song-title"]',
    '[class*="song-title"]',
    '[class*="SongTitle"]',
    'h3',
    'h4',
  ],
  song_duration: [
    '[data-testid="song-duration"]',
    '[class*="duration"]',
    'time',
    '[class*="Duration"]',
  ],
  download_button: [
    'button[aria-label*="Download" i]',
    '[data-testid="download-button"]',
    'button:has-text("Download")',
    '[class*="download"]',
  ],
  audio_source: [
    'audio source[src]',
    'audio[src]',
    '[data-audio-src]',
    '[class*="AudioPlayer"] source',
  ],
});

// ─── Generation wait constants ────────────────────────────────────────────────

/** How long to wait for the Create button before giving up */
const CREATE_BTN_TIMEOUT = 20_000;
/** How long to wait for at least 2 song cards to appear */
const GENERATION_TIMEOUT_MS = 360_000; // 6 minutes
/** Polling interval while waiting for song cards */
const POLL_INTERVAL_MS = 5_000;
/** Max poll iterations */
const MAX_POLL_ITERATIONS = GENERATION_TIMEOUT_MS / POLL_INTERVAL_MS;

// ─── SunoAdapter ─────────────────────────────────────────────────────────────

export class SunoAdapter extends BaseServiceAdapter {
  constructor(profilePath: string) {
    super('suno', profilePath, { timeout: 60_000, navTimeout: 45_000 });
  }

  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      const signInCount = await page
        .locator('button:has-text("Sign in"), a[href*="/login"], a[href*="/sign-in"]')
        .count();
      return signInCount === 0;
    } catch {
      return false;
    }
  }

  async execute(ctx: StageContext, selectors: SelectorMap): Promise<StageResult> {
    const page = await this.getPage();
    const consoleCapture = captureConsoleErrors(page);

    try {
      this.log.info('execute', 'Navigating to Suno Create', { url: SUNO_CREATE_URL });
      await page.goto(SUNO_CREATE_URL, { waitUntil: 'domcontentloaded' });
      await this.waitForNetworkIdle(page, 15_000);

      if (!(await this.isLoggedIn(page))) {
        consoleCapture.stop();
        return {
          success: false,
          error: 'Suno: Not logged in. Please connect the Suno browser profile from Settings.',
        };
      }

      return await this.executeGeneration(page, ctx, selectors);
    } catch (err) {
      this.log.error('execute', `Suno execution failed: ${String(err)}`);
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

  private async executeGeneration(
    page: Page,
    ctx: StageContext,
    selectors: SelectorMap
  ): Promise<StageResult> {
    const input = ctx.stageRun.input ?? {};
    const lyrics =
      (input.suno_ready_lyrics as string) ??
      (input.corrected_english_lyrics as string) ??
      (input.corrected_hindi_lyrics as string) ??
      (input.lyrics as string) ??
      '';
    const stylePrompt =
      (input.suno_style_prompt as string) ??
      'devotional bhajan, harmonium, tabla, 80 BPM, soulful female vocals';
    const songTitle = (input.song_title as string) ?? ctx.project.name;
    const fallbackMode = Boolean(input.fallback_mode);

    if (!lyrics || lyrics.trim().length < 10) {
      return { success: false, error: 'Suno: No usable lyrics provided in stage input' };
    }

    const submittedAt = Date.now();

    // ── Step 1: Enable custom mode ──────────────────────────────────────────
    await this.enableCustomMode(page, selectors);

    // ── Step 2: Fill lyrics ────────────────────────────────────────────────
    await this.fillLyrics(page, selectors, lyrics);

    // ── Step 3: Fill style prompt ──────────────────────────────────────────
    await this.fillStylePrompt(page, selectors, stylePrompt);

    // ── Step 4: Fill title ─────────────────────────────────────────────────
    await this.fillTitle(page, selectors, songTitle);

    // ── Step 5: Submit and wait for both song cards ────────────────────────
    await this.submitGeneration(page, selectors);
    const cardCount = await this.waitForSongCards(page, selectors);

    if (cardCount === 0) {
      throw new Error('Suno generation timed out — no song cards appeared after 6 minutes');
    }

    this.log.info('executeGeneration', `Detected ${cardCount} song card(s)`);

    // ── Step 6: Take full-page screenshot ──────────────────────────────────
    fs.mkdirSync(ctx.runDir, { recursive: true });
    const screenshotPath = path.join(ctx.runDir, 'suno_candidates.png');
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

    // ── Step 7: Extract candidate metadata ────────────────────────────────
    const audioDir = path.join(ctx.runDir, 'audio');
    fs.mkdirSync(audioDir, { recursive: true });

    const requestPayload: SunoRequestPayload = {
      lyrics: lyrics.slice(0, 3000),
      style_prompt: stylePrompt.slice(0, 200),
      title: songTitle,
      submitted_at: submittedAt,
    };

    const [candidateA, candidateB] = await Promise.all([
      this.extractCandidate(page, selectors, 0, 'A', stylePrompt, audioDir, fallbackMode),
      this.extractCandidate(page, selectors, 1, 'B', stylePrompt, audioDir, fallbackMode),
    ]);

    // ── Step 8: Build generation result ───────────────────────────────────
    const warnings: string[] = [];
    if (cardCount < 2) {
      warnings.push(`Only ${cardCount} song card(s) were visible — expected 2`);
    }

    const result: SunoGenerationResult = {
      candidate_a: candidateA,
      candidate_b: candidateB,
      request_payload: requestPayload,
      generated_at: Date.now(),
      page_url: page.url(),
      warnings,
    };

    // ── Step 9: Apply validation rules ─────────────────────────────────────
    const errors: string[] = [];
    for (const rule of CRITICAL_RULES) {
      if (!rule.check(result)) {
        errors.push(rule.message(result));
      }
    }
    for (const rule of WARN_RULES) {
      if (!rule.check(result)) {
        warnings.push(rule.message(result));
      }
    }
    result.warnings = [...warnings];

    // ── Step 10: Save artifacts ────────────────────────────────────────────
    const stored = saveSunoRun(result, ctx.runDir);

    this.log.info('executeGeneration', 'Suno run saved', {
      candidateADownloaded: candidateA.downloaded,
      candidateBDownloaded: candidateB.downloaded,
      warnings: warnings.length,
      errors: errors.length,
    });

    if (errors.length > 0) {
      return {
        success: false,
        error: `Suno generation validation failed: ${errors.join('; ')}`,
        output: this.buildOutput(result, stored),
        assetPaths: this.buildAssetPaths(stored, screenshotPath),
      };
    }

    return {
      success: true,
      output: this.buildOutput(result, stored),
      assetPaths: this.buildAssetPaths(stored, screenshotPath),
    };
  }

  // ─── UI interaction helpers ────────────────────────────────────────────────

  private async enableCustomMode(page: Page, selectors: SelectorMap): Promise<void> {
    const customSel = await this.resolveSelector('custom_mode_toggle', page, selectors);
    if (!customSel) {
      this.log.warn('enableCustomMode', 'Custom mode toggle not found — proceeding anyway');
      return;
    }
    try {
      const btn = page.locator(customSel).first();
      const isActive = await btn.evaluate((el) => {
        const e = el as HTMLElement;
        return (
          e.classList.contains('active') ||
          e.getAttribute('aria-pressed') === 'true' ||
          e.getAttribute('data-active') === 'true'
        );
      }).catch(() => false);

      if (!isActive) {
        await btn.click();
        await page.waitForTimeout(800);
      }
    } catch {
      this.log.warn('enableCustomMode', 'Could not activate custom mode — proceeding');
    }
  }

  private async fillLyrics(
    page: Page,
    selectors: SelectorMap,
    lyrics: string
  ): Promise<void> {
    const lyricsSel = await this.resolveSelector('lyrics_input', page, selectors);
    if (!lyricsSel) throw new Error('Suno: Could not find lyrics input field');

    const field = page.locator(lyricsSel).first();
    await field.waitFor({ timeout: 15_000, state: 'visible' });
    await field.click();
    await field.fill(lyrics.slice(0, 3000));
    await page.waitForTimeout(300);
  }

  private async fillStylePrompt(
    page: Page,
    selectors: SelectorMap,
    stylePrompt: string
  ): Promise<void> {
    const styleSel = await this.resolveSelector('style_input', page, selectors);
    if (!styleSel) {
      this.log.warn('fillStylePrompt', 'Style input not found — skipping');
      return;
    }
    try {
      const field = page.locator(styleSel).first();
      await field.click();
      await field.fill(stylePrompt.slice(0, 200));
      await page.waitForTimeout(300);
    } catch {
      this.log.warn('fillStylePrompt', 'Could not fill style prompt — skipping');
    }
  }

  private async fillTitle(
    page: Page,
    selectors: SelectorMap,
    title: string
  ): Promise<void> {
    const titleSel = await this.resolveSelector('title_input', page, selectors);
    if (!titleSel) return;
    try {
      const field = page.locator(titleSel).first();
      await field.click();
      await field.fill(title);
      await page.waitForTimeout(300);
    } catch {
      this.log.warn('fillTitle', 'Could not fill title — skipping');
    }
  }

  private async submitGeneration(page: Page, selectors: SelectorMap): Promise<void> {
    const createSel = await this.resolveSelector('create_button', page, selectors);
    if (!createSel) throw new Error('Suno: Could not find Create button');

    const btn = page.locator(createSel).first();
    await btn.waitFor({ timeout: CREATE_BTN_TIMEOUT, state: 'visible' });
    await btn.click();

    this.log.info('submitGeneration', 'Create button clicked — waiting for generation');
    await page.waitForTimeout(3_000);
  }

  private async waitForSongCards(page: Page, selectors: SelectorMap): Promise<number> {
    const cardSel = await this.resolveSelector('song_card', page, selectors);
    if (!cardSel) {
      this.log.warn('waitForSongCards', 'Song card selector not found');
      return 0;
    }

    for (let i = 0; i < MAX_POLL_ITERATIONS; i++) {
      const count = await page.locator(cardSel).count().catch(() => 0);
      if (count >= 2) return count;
      if (count > 0) {
        this.log.info('waitForSongCards', `${count} card(s) visible — waiting for more`);
      }
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    // Return however many are visible even if < 2
    return page.locator(cardSel).count().catch(() => 0);
  }

  // ─── Candidate extraction ──────────────────────────────────────────────────

  private async extractCandidate(
    page: Page,
    selectors: SelectorMap,
    index: number,
    label: 'A' | 'B',
    stylePrompt: string,
    audioDir: string,
    fallbackMode: boolean
  ): Promise<SunoCandidate> {
    const cardSel = await this.resolveSelector('song_card', page, selectors);
    const filename = `suno_candidate_${label.toLowerCase()}.mp3`;
    const thumbFilename = `suno_candidate_${label.toLowerCase()}_thumb.png`;

    let songTitle = `Candidate ${label}`;
    let durationRaw: string | null = null;
    let songId: string | null = null;
    let audioPath: string | null = null;
    let thumbnailPath: string | null = null;
    let downloaded = false;

    try {
      if (cardSel) {
        const card = page.locator(cardSel).nth(index);
        const cardVisible = await card.isVisible().catch(() => false);

        if (cardVisible) {
          // Extract title
          const titleSel = await this.resolveSelector('song_title', page, selectors);
          if (titleSel) {
            const titleText = await card.locator(titleSel).first().textContent().catch(() => null);
            if (titleText?.trim()) songTitle = titleText.trim();
          }

          // Extract duration
          const durationSel = await this.resolveSelector('song_duration', page, selectors);
          if (durationSel) {
            durationRaw = await card.locator(durationSel).first().textContent().catch(() => null);
          }

          // Extract song ID from href / data attributes
          songId = await card.evaluate((el) => {
            const link = el.querySelector('a[href*="/song/"]') as HTMLAnchorElement | null;
            if (link) {
              const match = link.href.match(/\/song\/([a-f0-9-]+)/i);
              return match?.[1] ?? null;
            }
            return (
              el.getAttribute('data-id') ??
              el.getAttribute('data-song-id') ??
              null
            );
          }).catch(() => null);

          // Capture thumbnail screenshot of this card
          try {
            const thumbPath = path.join(path.dirname(audioDir), thumbFilename);
            await card.screenshot({ path: thumbPath });
            thumbnailPath = thumbPath;
          } catch {
            // Non-critical
          }

          // Attempt audio download
          if (!fallbackMode) {
            audioPath = await this.downloadCandidateAudio(
              page,
              card,
              selectors,
              songId,
              audioDir,
              filename
            );
            downloaded = audioPath !== null;
          }
        }
      }
    } catch (err) {
      this.log.warn(
        'extractCandidate',
        `Candidate ${label} extraction error: ${String(err)} — using partial data`
      );
    }

    return {
      label,
      song_title: songTitle,
      duration_raw: durationRaw?.trim() ?? null,
      duration_seconds: parseDurationSeconds(durationRaw),
      style_prompt: stylePrompt,
      song_id: songId,
      audio_path: audioPath,
      thumbnail_path: thumbnailPath,
      downloaded,
    };
  }

  private async downloadCandidateAudio(
    page: Page,
    card: ReturnType<Page['locator']>,
    selectors: SelectorMap,
    songId: string | null,
    audioDir: string,
    filename: string
  ): Promise<string | null> {
    const destPath = path.join(audioDir, filename);

    // Strategy 1: Playwright download via download button
    try {
      const dlSel = await this.resolveSelector('download_button', page, selectors);
      if (dlSel) {
        const dlBtn = card.locator(dlSel).first();
        if (await dlBtn.isVisible().catch(() => false)) {
          const saved = await this.saveDownload(
            page,
            () => dlBtn.click(),
            audioDir,
            filename,
            120_000
          );
          return saved;
        }
      }
    } catch {
      // Fall through to next strategy
    }

    // Strategy 2: Grab audio src attribute and download via page.evaluate / fetch
    try {
      const audioSrcSel = await this.resolveSelector('audio_source', page, selectors);
      const audioSrc = audioSrcSel
        ? await extractAttribute(page, audioSrcSel, 'src').catch(() => null)
        : null;

      const srcToUse = audioSrc ?? (songId ? `https://cdn1.suno.ai/${songId}.mp3` : null);

      if (srcToUse) {
        await downloadViaPageFetch(page, srcToUse, audioDir, filename);
        return destPath;
      }
    } catch {
      // Fall through
    }

    return null;
  }

  // ─── Output builders ───────────────────────────────────────────────────────

  private buildOutput(
    result: SunoGenerationResult,
    stored: ReturnType<typeof saveSunoRun>
  ): Record<string, unknown> {
    return {
      candidate_a: {
        label: result.candidate_a.label,
        song_title: result.candidate_a.song_title,
        duration_raw: result.candidate_a.duration_raw,
        duration_seconds: result.candidate_a.duration_seconds,
        style_prompt: result.candidate_a.style_prompt,
        song_id: result.candidate_a.song_id,
        audio_path: stored.candidate_a_audio,
        thumbnail_path: stored.candidate_a_thumbnail,
        downloaded: result.candidate_a.downloaded,
      },
      candidate_b: {
        label: result.candidate_b.label,
        song_title: result.candidate_b.song_title,
        duration_raw: result.candidate_b.duration_raw,
        duration_seconds: result.candidate_b.duration_seconds,
        style_prompt: result.candidate_b.style_prompt,
        song_id: result.candidate_b.song_id,
        audio_path: stored.candidate_b_audio,
        thumbnail_path: stored.candidate_b_thumbnail,
        downloaded: result.candidate_b.downloaded,
      },
      request_payload: result.request_payload,
      generated_at: result.generated_at,
      page_url: result.page_url,
      warnings: result.warnings,
      metadata_file: stored.metadata_path,
      request_payload_file: stored.request_payload_path,
    };
  }

  private buildAssetPaths(
    stored: ReturnType<typeof saveSunoRun>,
    screenshotPath: string
  ): StageResult['assetPaths'] {
    const assets: StageResult['assetPaths'] = [];

    if (fs.existsSync(screenshotPath)) {
      assets.push({ path: screenshotPath, type: 'screenshot', name: 'Suno Candidates Screenshot' });
    }
    if (stored.candidate_a_audio) {
      assets.push({
        path: stored.candidate_a_audio,
        type: 'audio',
        name: 'Suno Candidate A',
        mimeType: 'audio/mpeg',
      });
    }
    if (stored.candidate_b_audio) {
      assets.push({
        path: stored.candidate_b_audio,
        type: 'audio',
        name: 'Suno Candidate B',
        mimeType: 'audio/mpeg',
      });
    }
    if (stored.candidate_a_thumbnail) {
      assets.push({
        path: stored.candidate_a_thumbnail,
        type: 'screenshot',
        name: 'Candidate A Thumbnail',
      });
    }
    if (stored.candidate_b_thumbnail) {
      assets.push({
        path: stored.candidate_b_thumbnail,
        type: 'screenshot',
        name: 'Candidate B Thumbnail',
      });
    }
    if (stored.metadata_path && fs.existsSync(stored.metadata_path)) {
      assets.push({
        path: stored.metadata_path,
        type: 'document',
        name: 'Suno Metadata JSON',
        mimeType: 'application/json',
      });
    }

    return assets;
  }
}

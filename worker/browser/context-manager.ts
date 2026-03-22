/**
 * Browser context lifecycle manager.
 *
 * Encapsulates Playwright persistent context creation, page management,
 * and clean shutdown. One instance per service adapter.
 *
 * Separating this from the adapter logic means the browser plumbing can
 * evolve independently of the automation scripts.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import type { BrowserLaunchOptions, ServiceName } from './types';
import { ensureProfileDir } from './profile-manager';
import { createLogger } from './logger';
import { injectAntiDetection } from './page-helpers';

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_VIEWPORT = { width: 1280, height: 900 } as const;

const STEALTH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--disable-dev-shm-usage',
] as const;

function resolveOptions(overrides: BrowserLaunchOptions): Required<BrowserLaunchOptions> {
  return {
    headless:    overrides.headless    ?? (process.env.PLAYWRIGHT_HEADLESS !== 'false'),
    slowMo:      overrides.slowMo      ?? Number(process.env.PLAYWRIGHT_SLOW_MO      ?? 100),
    timeout:     overrides.timeout     ?? Number(process.env.PLAYWRIGHT_TIMEOUT_MS   ?? 60_000),
    navTimeout:  overrides.navTimeout  ?? Number(process.env.PLAYWRIGHT_NAV_TIMEOUT_MS ?? 30_000),
    viewport:    overrides.viewport    ?? DEFAULT_VIEWPORT,
    downloadsDir: overrides.downloadsDir ??
      process.env.DOWNLOADS_DIR ?? path.join(process.cwd(), 'data', 'downloads'),
    extraArgs:   overrides.extraArgs   ?? [],
  };
}

// ─── BrowserContextManager ────────────────────────────────────────────────────

export class BrowserContextManager {
  private context: BrowserContext | null = null;
  private readonly opts: Required<BrowserLaunchOptions>;
  private readonly log;

  constructor(
    private readonly service: ServiceName,
    options: BrowserLaunchOptions = {}
  ) {
    this.opts = resolveOptions(options);
    this.log  = createLogger(service);
  }

  // ─── Context lifecycle ──────────────────────────────────────────────────────

  /**
   * Lazily create the persistent context. Safe to call multiple times.
   */
  async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context;

    const profileDir = ensureProfileDir(this.service);
    this.log.info('context', 'Launching persistent Chromium context', {
      profileDir,
      headless: this.opts.headless,
      slowMo: this.opts.slowMo,
    });

    fs.mkdirSync(this.opts.downloadsDir, { recursive: true });

    this.context = await chromium.launchPersistentContext(profileDir, {
      headless: this.opts.headless,
      slowMo:   this.opts.slowMo,
      viewport: this.opts.viewport,
      args: [...STEALTH_ARGS, ...this.opts.extraArgs],
      ignoreHTTPSErrors: true,
      acceptDownloads:   true,
      downloadsPath: this.opts.downloadsDir,
    });

    this.context.setDefaultTimeout(this.opts.timeout);
    this.context.setDefaultNavigationTimeout(this.opts.navTimeout);

    this.log.debug('context', 'Context ready');
    return this.context;
  }

  /**
   * Get the existing page or open a fresh one.
   * Reuses the first open page to avoid accumulating tabs.
   */
  async getPage(): Promise<Page> {
    const ctx = await this.ensureContext();
    const pages = ctx.pages();
    const page = pages.length > 0 ? pages[0] : await ctx.newPage();

    // Apply anti-detection on every page open (addInitScript survives navigation)
    await injectAntiDetection(page).catch(() => {});

    return page;
  }

  /**
   * Open a brand-new tab (keeps existing pages open).
   * Useful when you need to navigate without losing the current page state.
   */
  async newPage(): Promise<Page> {
    const ctx = await this.ensureContext();
    const page = await ctx.newPage();
    await injectAntiDetection(page).catch(() => {});
    return page;
  }

  /**
   * Close the browser context and release resources.
   * The profile on disk is preserved for the next session.
   */
  async close(): Promise<void> {
    if (!this.context) return;
    this.log.info('context', 'Closing browser context');
    try {
      await this.context.close();
    } catch (err) {
      this.log.warn('context', `Error closing context: ${String(err)}`);
    } finally {
      this.context = null;
    }
  }

  /** True if the context is currently open. */
  get isOpen(): boolean {
    return this.context !== null;
  }

  // ─── Accessors ──────────────────────────────────────────────────────────────

  get defaultTimeout(): number { return this.opts.timeout; }
  get navTimeout(): number     { return this.opts.navTimeout; }

  // ─── Manual login support ───────────────────────────────────────────────────

  /**
   * Open a visible browser window so the user can manually log in.
   * Once they've authenticated, close this context — the session is persisted
   * to disk and will be reused by the next `ensureContext()` call.
   *
   * This is intentionally headed (never headless).
   */
  async openForManualLogin(startUrl: string): Promise<void> {
    // Force a fresh headed context for the login flow
    await this.close();

    const profileDir = ensureProfileDir(this.service);
    this.log.info('login', `Opening headed browser for manual login`, { startUrl });

    this.context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      slowMo: 0,
      viewport: this.opts.viewport,
      args: [...STEALTH_ARGS, ...this.opts.extraArgs],
      ignoreHTTPSErrors: true,
      acceptDownloads: true,
      downloadsPath: this.opts.downloadsDir,
    });

    this.context.setDefaultTimeout(this.opts.timeout);
    this.context.setDefaultNavigationTimeout(this.opts.navTimeout);

    const page = this.context.pages()[0] ?? await this.context.newPage();
    await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
  }
}

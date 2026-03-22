/**
 * Base service adapter.
 *
 * Provides a consistent interface for all browser-automation adapters:
 *   - Lazy browser context via BrowserContextManager
 *   - Structured logging via BrowserLogger
 *   - Convenience wrappers that delegate to the browser/ foundation layer
 *
 * Subclasses must implement:
 *   - isLoggedIn(page): check whether the service session is authenticated
 *   - execute(ctx, selectors): run the stage-specific automation
 */

import type { Page } from 'playwright';
import type { StageContext, StageResult, ServiceName } from '@/types';
import {
  BrowserContextManager,
  BrowserLogger,
  createLogger,
  type BrowserLaunchOptions,
  type SelectorMap,
  type FailureArtifacts,
  type DownloadResult,
  type FindFirstOptions,
  type WaitForStableTextOptions,
  // Page helpers
  waitForNetworkIdle,
  findFirstVisible,
  extractLastText,
  clearAndFill,
  waitForStableText,
  // Error capture
  captureFailureArtifacts,
  // Downloads
  saveDownload as _saveDownload,
  // Selector resolution
  sel,
  resolveSelector,
} from '../browser';

// Re-export SelectorMap so existing adapters import it from here
export type { SelectorMap };

// ─── BaseServiceAdapter ───────────────────────────────────────────────────────

export abstract class BaseServiceAdapter {
  protected readonly contextManager: BrowserContextManager;
  protected readonly log: BrowserLogger;

  constructor(
    readonly service: ServiceName,
    profilePath: string,
    options: BrowserLaunchOptions = {}
  ) {
    // BrowserContextManager already reads env vars for defaults; passing
    // profilePath as downloadsDir-override isn't needed — profile paths are
    // now managed by ProfileManager inside BrowserContextManager.
    // We pass `profilePath` as downloadsDir only when the caller explicitly
    // provided a different path, otherwise the manager uses the registry.
    this.contextManager = new BrowserContextManager(service, options);
    this.log = createLogger(service);
  }

  // ─── Timeout accessor ───────────────────────────────────────────────────────

  /** Default action/locator timeout in ms (reads from context manager). */
  protected get timeout(): number {
    return this.contextManager.defaultTimeout;
  }

  // ─── Context / page access ──────────────────────────────────────────────────

  /** Get (or lazily create) the authenticated browser page. */
  async getPage(): Promise<Page> {
    return this.contextManager.getPage();
  }

  /** Close the browser context. Profile data is kept on disk. */
  async closeContext(): Promise<void> {
    await this.contextManager.close();
  }

  /** Open a headed browser so the user can log in manually. */
  async openForManualLogin(startUrl: string): Promise<void> {
    await this.contextManager.openForManualLogin(startUrl);
  }

  // ─── Abstract methods ───────────────────────────────────────────────────────

  /**
   * Check whether the active page session is authenticated.
   * Called automatically before `execute()`.
   */
  abstract isLoggedIn(page: Page): Promise<boolean>;

  /**
   * Run the stage-specific automation and return a structured result.
   */
  abstract execute(ctx: StageContext, selectors: SelectorMap): Promise<StageResult>;

  // ─── Failure capture ────────────────────────────────────────────────────────

  /**
   * Capture a screenshot and HTML snapshot on failure.
   * Never throws — all errors are swallowed so the original error propagates.
   */
  async captureFailureArtifacts(
    page: Page,
    runDir: string,
    stageKey: string
  ): Promise<FailureArtifacts> {
    return captureFailureArtifacts(page, runDir, stageKey);
  }

  // ─── Network helpers ────────────────────────────────────────────────────────

  /** Wait for network to go idle. Swallows timeout. */
  protected async waitForNetworkIdle(page: Page, timeoutMs = 10_000): Promise<void> {
    return waitForNetworkIdle(page, timeoutMs);
  }

  // ─── Input helpers ──────────────────────────────────────────────────────────

  /** Select-all + fill. Works for <input>, <textarea>, and contenteditable. */
  protected async clearAndType(page: Page, selector: string, text: string): Promise<void> {
    return clearAndFill(page, selector, text);
  }

  // ─── Selector helpers ───────────────────────────────────────────────────────

  /**
   * Try each selector in order and return the first visible one.
   * Returns null if none are found within `timeout` ms.
   */
  protected async findFirst(
    page: Page,
    selectors: string[],
    timeout = 10_000
  ): Promise<string | null> {
    return findFirstVisible(page, selectors, { timeoutMs: timeout });
  }

  /**
   * Look up a selector from a DB override map, falling back to `defaultValue`.
   * Shorthand: sel(map, 'lyrics_input', 'textarea[placeholder*="lyrics"]')
   */
  protected sel(map: SelectorMap, key: string, defaultValue: string): string {
    return sel(map, key, defaultValue);
  }

  /**
   * Resolve the best working selector for a key using the full registry.
   * Prefer this over `sel()` when the page is available.
   */
  protected async resolveSelector(
    key: string,
    page: Page,
    dbMap: SelectorMap = {}
  ): Promise<string | null> {
    return resolveSelector(this.service, key, page, dbMap);
  }

  // ─── Text extraction ────────────────────────────────────────────────────────

  /** Get the text content of the LAST matching element. */
  protected async extractLastText(page: Page, selector: string): Promise<string> {
    return extractLastText(page, selector);
  }

  /**
   * Poll until element text stops changing (for AI streaming responses).
   * Returns the stable text content.
   */
  protected async waitForStableText(
    page: Page,
    selector: string,
    options?: WaitForStableTextOptions
  ): Promise<string> {
    return waitForStableText(page, selector, options);
  }

  // ─── Downloads ──────────────────────────────────────────────────────────────

  /**
   * Trigger a download and save the file to `destDir/filename`.
   * Returns the saved file path.
   */
  protected async saveDownload(
    page: Page,
    triggerFn: () => Promise<void>,
    destDir: string,
    filename: string,
    timeoutMs?: number
  ): Promise<string> {
    return _saveDownload(page, triggerFn, destDir, filename, timeoutMs);
  }
}

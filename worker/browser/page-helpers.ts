/**
 * Reusable Playwright page utility functions.
 *
 * All functions are stateless and accept a `Page` as their first argument.
 * No provider-specific logic — pure automation primitives.
 */

import type { Page } from 'playwright';
import type { FindFirstOptions, WaitForStableTextOptions } from './types';
import { sleep } from './retry';

// ─── Navigation ───────────────────────────────────────────────────────────────

/**
 * Wait for network to go idle. Swallows timeout — caller decides what to do.
 */
export async function waitForNetworkIdle(page: Page, timeoutMs = 10_000): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: timeoutMs });
  } catch {
    // page is usable even if network never fully idles
  }
}

/**
 * Wait for DOM content to be loaded (faster than 'load').
 */
export async function waitForDOMReady(page: Page, timeoutMs = 15_000): Promise<void> {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs });
  } catch {
    // continue
  }
}

// ─── Selector resolution ──────────────────────────────────────────────────────

/**
 * Try each selector in order, returning the first that becomes visible.
 * Returns `null` if none are found within the total time budget.
 *
 * @example
 *   const sel = await findFirstVisible(page, ['#v2-input', '.v1-input', 'textarea']);
 *   if (sel) await page.locator(sel).fill(text);
 */
export async function findFirstVisible(
  page: Page,
  selectors: readonly string[],
  options: FindFirstOptions = {}
): Promise<string | null> {
  const { probeMs = 3_000, state = 'visible' } = options;

  for (const sel of selectors) {
    try {
      await page.locator(sel).first().waitFor({ timeout: probeMs, state });
      return sel;
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Wait until at least one selector from the list is visible.
 * Returns the winning selector, or throws if none appear in time.
 */
export async function waitForAny(
  page: Page,
  selectors: readonly string[],
  timeoutMs = 15_000
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const sel of selectors) {
      try {
        const count = await page.locator(sel).count();
        if (count > 0) {
          const visible = await page.locator(sel).first().isVisible().catch(() => false);
          if (visible) return sel;
        }
      } catch {
        // continue
      }
    }
    await sleep(300);
  }

  throw new Error(`waitForAny: none of [${selectors.join(', ')}] appeared within ${timeoutMs}ms`);
}

// ─── Input helpers ────────────────────────────────────────────────────────────

/**
 * Select-all then fill — works for both <input> and contenteditable.
 */
export async function clearAndFill(page: Page, selector: string, text: string): Promise<void> {
  const locator = page.locator(selector).first();
  await locator.click({ timeout: 10_000 });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await locator.fill(text);
}

/**
 * Type text character-by-character to mimic human input.
 * Useful for inputs that listen to keydown/keypress events instead of input.
 */
export async function typeSlowly(
  page: Page,
  selector: string,
  text: string,
  delayMs = 50
): Promise<void> {
  const locator = page.locator(selector).first();
  await locator.click({ timeout: 10_000 });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await locator.pressSequentially(text, { delay: delayMs });
}

/**
 * Insert text via the clipboard — bypasses React synthetic event quirks.
 */
export async function pasteText(page: Page, selector: string, text: string): Promise<void> {
  await page.locator(selector).first().click({ timeout: 10_000 });
  await page.evaluate(async (t) => {
    await navigator.clipboard.writeText(t).catch(() => {
      // Clipboard API not available in all contexts — fall through
    });
  }, text);
  await page.keyboard.press('Control+V');
}

/**
 * Triple-click to select all text in a field, then type replacement.
 */
export async function replaceFieldText(page: Page, selector: string, text: string): Promise<void> {
  const locator = page.locator(selector).first();
  await locator.click({ clickCount: 3, timeout: 10_000 });
  await locator.fill(text);
}

// ─── Text extraction ──────────────────────────────────────────────────────────

/**
 * Get the text content of the LAST matching element.
 * Useful for chat interfaces that append new messages.
 */
export async function extractLastText(page: Page, selector: string): Promise<string> {
  const elements = await page.locator(selector).all();
  if (elements.length === 0) return '';
  return (await elements[elements.length - 1].textContent()) ?? '';
}

/**
 * Get all text matches as an array.
 */
export async function extractAllText(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).allTextContents();
}

/**
 * Get an attribute value from the first matching element.
 */
export async function extractAttribute(
  page: Page,
  selector: string,
  attribute: string
): Promise<string | null> {
  return page.locator(selector).first().getAttribute(attribute).catch(() => null);
}

// ─── Streaming / stable-text detection ───────────────────────────────────────

/**
 * Poll a selector until its text content stops changing.
 * Designed for AI chat interfaces that stream responses.
 *
 * @example
 *   await waitForStableText(page, '.response .prose', { stableCount: 3, timeoutMs: 120_000 });
 */
export async function waitForStableText(
  page: Page,
  selector: string,
  options: WaitForStableTextOptions = {}
): Promise<string> {
  const {
    stableCount = 3,
    pollIntervalMs = 1_000,
    timeoutMs = 120_000,
  } = options;

  const deadline = Date.now() + timeoutMs;
  let lastText = '';
  let consecutiveStable = 0;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    const currentText = await extractLastText(page, selector).catch(() => '');

    if (currentText.length > 0 && currentText === lastText) {
      consecutiveStable++;
      if (consecutiveStable >= stableCount) return currentText;
    } else {
      consecutiveStable = 0;
    }

    lastText = currentText;
  }

  // Return whatever we have — caller can decide if it's sufficient
  return lastText;
}

/**
 * Wait until a "stop streaming" / "thinking" indicator disappears.
 * Common pattern: AI shows a spinner while generating.
 */
export async function waitForStreamingComplete(
  page: Page,
  streamingIndicatorSelector: string,
  timeoutMs = 120_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  // First wait for the indicator to appear (proves generation started)
  try {
    await page.locator(streamingIndicatorSelector).first().waitFor({
      timeout: 10_000,
      state: 'visible',
    });
  } catch {
    // indicator may not appear before completing — that's ok
  }

  // Now wait for it to disappear
  while (Date.now() < deadline) {
    const count = await page.locator(streamingIndicatorSelector).count().catch(() => 0);
    if (count === 0) return;
    await sleep(1_000);
  }
}

// ─── Scroll helpers ───────────────────────────────────────────────────────────

export async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
}

export async function scrollToTop(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
}

export async function scrollIntoView(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().scrollIntoViewIfNeeded().catch(() => {});
}

// ─── Visibility checks ────────────────────────────────────────────────────────

export async function isVisible(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().isVisible().catch(() => false);
}

export async function isHidden(page: Page, selector: string): Promise<boolean> {
  const visible = await isVisible(page, selector);
  return !visible;
}

export async function waitForVisible(page: Page, selector: string, timeoutMs = 10_000): Promise<void> {
  await page.locator(selector).first().waitFor({ timeout: timeoutMs, state: 'visible' });
}

export async function waitForHidden(page: Page, selector: string, timeoutMs = 10_000): Promise<void> {
  await page.locator(selector).first().waitFor({ timeout: timeoutMs, state: 'hidden' });
}

// ─── Anti-detection ───────────────────────────────────────────────────────────

/**
 * Inject scripts that mask common Playwright/Chromium automation signals.
 * Call once after `page.goto()` when a site shows bot-detection behaviour.
 */
export async function injectAntiDetection(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Remove the `webdriver` flag
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // Spoof plugins array (empty in headless Chromium)
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3],
    });

    // Spoof languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    // Remove chrome.runtime automation marker if present
    if ((window as unknown as Record<string, unknown>).chrome) {
      const chrome = (window as unknown as Record<string, unknown>).chrome as Record<string, unknown>;
      if (chrome.runtime) {
        (chrome.runtime as Record<string, unknown>).onConnect = undefined;
      }
    }
  });
}

// ─── Dialog handling ──────────────────────────────────────────────────────────

/**
 * Auto-dismiss any alert/confirm/prompt dialogs that appear.
 * Returns a cleanup function to stop auto-dismissing.
 */
export function autoDismissDialogs(page: Page): () => void {
  const handler = (dialog: { accept: () => Promise<void> }) => {
    dialog.accept().catch(() => {});
  };
  page.on('dialog', handler);
  return () => page.off('dialog', handler);
}

// ─── Iframe helpers ───────────────────────────────────────────────────────────

/**
 * Wait for an iframe to load and return its frame for further interaction.
 */
export async function getFrameBySelector(
  page: Page,
  iframeSelector: string,
  timeoutMs = 10_000
): Promise<import('playwright').Frame | null> {
  try {
    const elementHandle = await page.locator(iframeSelector).first().elementHandle({ timeout: timeoutMs });
    if (!elementHandle) return null;
    return await elementHandle.contentFrame();
  } catch {
    return null;
  }
}

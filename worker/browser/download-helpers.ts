/**
 * File download helpers for Playwright browser automation.
 *
 * Provides event-based and polling-based strategies for capturing
 * browser-triggered file downloads.
 */

import type { Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import type { DownloadResult } from './types';
import { sleep, TimeoutError } from './retry';

// ─── Event-based download (preferred) ────────────────────────────────────────

/**
 * Trigger a download and wait for the browser `download` event.
 *
 * @param page        - Playwright page
 * @param triggerFn   - Async function that causes the download (e.g. button click)
 * @param destDir     - Directory to save the file into
 * @param filename    - Target filename (including extension)
 * @param timeoutMs   - Max wait for the download event (default 60 s)
 *
 * @example
 *   const result = await waitForDownload(
 *     page,
 *     () => page.locator('button:has-text("Download")').click(),
 *     ctx.runDir,
 *     'suno_candidate_a.mp3',
 *   );
 */
export async function waitForDownload(
  page: Page,
  triggerFn: () => Promise<void>,
  destDir: string,
  filename: string,
  timeoutMs = 60_000
): Promise<DownloadResult> {
  fs.mkdirSync(destDir, { recursive: true });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: timeoutMs }),
    triggerFn(),
  ]);

  const dest = path.join(destDir, filename);
  await download.saveAs(dest);

  return {
    savedPath: dest,
    suggestedFilename: download.suggestedFilename(),
    mimeType: null, // Playwright Download doesn't expose MIME directly
  };
}

/**
 * Trigger a download, wait for the event, and return the path.
 * Shorthand over `waitForDownload` when you only need the path.
 */
export async function saveDownload(
  page: Page,
  triggerFn: () => Promise<void>,
  destDir: string,
  filename: string,
  timeoutMs = 60_000
): Promise<string> {
  const result = await waitForDownload(page, triggerFn, destDir, filename, timeoutMs);
  return result.savedPath;
}

// ─── Multi-download ───────────────────────────────────────────────────────────

/**
 * Capture multiple downloads triggered by a single action.
 * Returns an array of results in the order they were received.
 *
 * @param count      - How many downloads to wait for
 * @param names      - Filenames to assign (indexed). If fewer than `count`, extras
 *                     use their `suggestedFilename`.
 *
 * @example
 *   const results = await waitForMultipleDownloads(
 *     page,
 *     () => page.locator('#bulk-download').click(),
 *     destDir,
 *     2,
 *     ['candidate_a.mp3', 'candidate_b.mp3'],
 *   );
 */
export async function waitForMultipleDownloads(
  page: Page,
  triggerFn: () => Promise<void>,
  destDir: string,
  count: number,
  names: string[] = [],
  timeoutMs = 120_000
): Promise<DownloadResult[]> {
  fs.mkdirSync(destDir, { recursive: true });

  const results: DownloadResult[] = [];
  const pending = new Array(count).fill(null).map((_, i) =>
    page.waitForEvent('download', { timeout: timeoutMs }).then(async dl => {
      const filename = names[i] ?? dl.suggestedFilename();
      const dest = path.join(destDir, filename);
      await dl.saveAs(dest);
      results.push({ savedPath: dest, suggestedFilename: dl.suggestedFilename(), mimeType: null });
    })
  );

  await triggerFn();
  await Promise.all(pending);

  return results;
}

// ─── Polling-based download (fallback) ───────────────────────────────────────

/**
 * Watch a directory for a newly added file matching `pattern`.
 *
 * Use this as a fallback when the target service uses a non-standard download
 * mechanism (e.g. a silent XHR blob save rather than a browser download event).
 *
 * @param dir         - Directory to watch
 * @param beforeState - Set of filenames present BEFORE the trigger (from `snapshotDir`)
 * @param pattern     - Optional regex to filter new files (e.g. /\.mp4$/)
 * @param timeoutMs   - Max wait time
 */
export async function pollForNewFile(
  dir: string,
  beforeState: Set<string>,
  pattern?: RegExp,
  timeoutMs = 60_000
): Promise<string | null> {
  fs.mkdirSync(dir, { recursive: true });
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await sleep(1_000);
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!beforeState.has(entry)) {
        if (!pattern || pattern.test(entry)) {
          return path.join(dir, entry);
        }
      }
    }
  }

  return null;
}

/**
 * Snapshot the current filenames in a directory.
 * Pass the result to `pollForNewFile` as `beforeState`.
 */
export function snapshotDir(dir: string): Set<string> {
  try {
    return new Set(fs.readdirSync(dir));
  } catch {
    return new Set();
  }
}

// ─── URL-based download ───────────────────────────────────────────────────────

/**
 * Download a file from a URL using the page's fetch context (inherits cookies/auth).
 * Useful when a download link requires authentication cookies.
 */
export async function downloadViaPageFetch(
  page: Page,
  url: string,
  destDir: string,
  filename: string,
  timeoutMs = 60_000
): Promise<string> {
  fs.mkdirSync(destDir, { recursive: true });

  const buffer: Buffer = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new TimeoutError(`downloadViaPageFetch timed out after ${timeoutMs}ms`)),
      timeoutMs
    );

    page.evaluate(async (fetchUrl: string) => {
      const res = await fetch(fetchUrl, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ab = await res.arrayBuffer();
      return Array.from(new Uint8Array(ab));
    }, url).then(bytes => {
      clearTimeout(timer);
      resolve(Buffer.from(bytes as number[]));
    }).catch(err => {
      clearTimeout(timer);
      reject(err);
    });
  });

  const dest = path.join(destDir, filename);
  fs.writeFileSync(dest, buffer);
  return dest;
}

// ─── Video src extraction ─────────────────────────────────────────────────────

/**
 * Extract the `src` attribute from a `<video>` element as a fallback when
 * direct download isn't available.
 */
export async function extractVideoSrc(page: Page, videoSelector = 'video'): Promise<string | null> {
  return page.locator(videoSelector).first().getAttribute('src').catch(() => null);
}

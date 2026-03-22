/**
 * Failure artifact capture utilities.
 *
 * Captures screenshots, HTML snapshots, console errors, and network failures.
 * All writes are best-effort — failures here must never mask the original error.
 */

import type { Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import type { FailureArtifacts } from './types';

// ─── Core capture ─────────────────────────────────────────────────────────────

/**
 * Take a full-page screenshot and save it.
 * Returns the saved path, or null on failure.
 */
export async function captureScreenshot(
  page: Page,
  filePath: string,
  fullPage = true
): Promise<string | null> {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    await page.screenshot({ path: filePath, fullPage });
    return fs.existsSync(filePath) ? filePath : null;
  } catch {
    return null;
  }
}

/**
 * Dump the page HTML to a file.
 * Returns the saved path, or null on failure.
 */
export async function captureHTML(page: Page, filePath: string): Promise<string | null> {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const html = await page.content();
    fs.writeFileSync(filePath, html, 'utf-8');
    return fs.existsSync(filePath) ? filePath : null;
  } catch {
    return null;
  }
}

/**
 * Capture both screenshot and HTML in one call.
 *
 * @param page         - The Playwright page to capture
 * @param dir          - Directory to write artifacts into
 * @param label        - Label used in the filename (e.g. stage key)
 * @returns            - Paths to captured files (undefined if capture failed)
 */
export async function captureFailureArtifacts(
  page: Page,
  dir: string,
  label: string
): Promise<FailureArtifacts> {
  const artifactsDir = path.join(dir, 'failures');
  fs.mkdirSync(artifactsDir, { recursive: true });

  const timestamp = Date.now();
  const safeName = label.replace(/[^a-z0-9_-]/gi, '_');

  const screenshotPath = path.join(artifactsDir, `${safeName}_${timestamp}.png`);
  const htmlPath       = path.join(artifactsDir, `${safeName}_${timestamp}.html`);

  const [screenshot, html] = await Promise.all([
    captureScreenshot(page, screenshotPath),
    captureHTML(page, htmlPath),
  ]);

  return {
    screenshot: screenshot ?? undefined,
    html:       html ?? undefined,
    capturedAt: timestamp,
  };
}

// ─── Console error capture ────────────────────────────────────────────────────

export interface ConsoleCapture {
  errors: string[];
  warnings: string[];
  /** Remove listeners and stop collecting */
  stop: () => void;
}

/**
 * Attach listeners to the page console and collect errors/warnings.
 * Call `stop()` on the returned object when you no longer need collection.
 *
 * @example
 *   const capture = captureConsoleErrors(page);
 *   await doWork(page);
 *   capture.stop();
 *   if (capture.errors.length) log.warn('console-errors', capture.errors.join('; '));
 */
export function captureConsoleErrors(page: Page): ConsoleCapture {
  const errors: string[] = [];
  const warnings: string[] = [];

  const handler = (msg: import('playwright').ConsoleMessage) => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') errors.push(text);
    if (type === 'warning') warnings.push(text);
  };

  page.on('console', handler);

  return {
    errors,
    warnings,
    stop: () => page.off('console', handler),
  };
}

// ─── Network error capture ────────────────────────────────────────────────────

export interface NetworkCapture {
  failures: Array<{ url: string; status: number; method: string }>;
  stop: () => void;
}

/**
 * Collect HTTP responses with status >= 400.
 */
export function captureNetworkErrors(page: Page): NetworkCapture {
  const failures: Array<{ url: string; status: number; method: string }> = [];

  const handler = (response: import('playwright').Response) => {
    if (response.status() >= 400) {
      failures.push({
        url: response.url(),
        status: response.status(),
        method: response.request().method(),
      });
    }
  };

  page.on('response', handler);

  return {
    failures,
    stop: () => page.off('response', handler),
  };
}

// ─── Diagnostic bundle ────────────────────────────────────────────────────────

export interface DiagnosticBundle extends FailureArtifacts {
  url: string;
  title: string;
  consoleErrors: string[];
  networkFailures: Array<{ url: string; status: number; method: string }>;
  /** Written to disk as JSON alongside screenshot/HTML */
  manifestPath?: string;
}

/**
 * Full diagnostic capture: screenshot + HTML + page metadata.
 * Writes a JSON manifest file containing all metadata.
 */
export async function captureDiagnosticBundle(
  page: Page,
  dir: string,
  label: string,
  extra?: {
    consoleCapture?: ConsoleCapture;
    networkCapture?: NetworkCapture;
  }
): Promise<DiagnosticBundle> {
  const artifacts = await captureFailureArtifacts(page, dir, label);

  const url   = page.url();
  const title = await page.title().catch(() => '');
  const consoleErrors    = extra?.consoleCapture?.errors  ?? [];
  const networkFailures  = extra?.networkCapture?.failures ?? [];

  const bundle: DiagnosticBundle = {
    ...artifacts,
    url,
    title,
    consoleErrors,
    networkFailures,
  };

  // Write JSON manifest
  try {
    const safeName    = label.replace(/[^a-z0-9_-]/gi, '_');
    const manifestDir = path.join(dir, 'failures');
    fs.mkdirSync(manifestDir, { recursive: true });
    const manifestPath = path.join(manifestDir, `${safeName}_${artifacts.capturedAt}_manifest.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(bundle, null, 2), 'utf-8');
    bundle.manifestPath = manifestPath;
  } catch {
    // non-critical
  }

  return bundle;
}

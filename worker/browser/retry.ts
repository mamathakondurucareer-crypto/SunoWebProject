/**
 * Retry, timeout, and fallback helpers for browser automation.
 *
 * All functions are pure async utilities with no Playwright dependency.
 * They compose naturally with any async operation.
 */

import type { RetryOptions } from './types';

// ─── withRetry ────────────────────────────────────────────────────────────────

/**
 * Execute `fn` up to `maxAttempts` times, waiting between attempts.
 *
 * @example
 *   const text = await withRetry(() => page.textContent('.result'), {
 *     maxAttempts: 3,
 *     delayMs: 1000,
 *     backoff: 2,
 *   });
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxAttempts, delayMs = 500, backoff = 1, shouldRetry } = options;

  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;

      if (attempt === maxAttempts) break;

      if (shouldRetry && !shouldRetry(err, attempt)) break;

      const wait = delayMs * Math.pow(backoff, attempt - 1);
      await sleep(wait);
    }
  }

  throw lastErr;
}

// ─── withTimeout ──────────────────────────────────────────────────────────────

/**
 * Race `fn` against a hard deadline.
 *
 * Throws a `TimeoutError` if `fn` does not resolve within `ms` milliseconds.
 *
 * @example
 *   const result = await withTimeout(() => heavyOperation(), 30_000, 'heavyOperation');
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  ms: number,
  label = 'operation'
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`${label} timed out after ${ms}ms`));
    }, ms);

    fn().then(
      value => { clearTimeout(timer); resolve(value); },
      err   => { clearTimeout(timer); reject(err); }
    );
  });
}

// ─── withFallback ─────────────────────────────────────────────────────────────

/**
 * Try each function in sequence, returning the first that succeeds.
 * If all fail, throws the last error.
 *
 * @example
 *   const text = await withFallback([
 *     () => page.textContent('.selector-v2'),
 *     () => page.textContent('.selector-v1'),
 *   ]);
 */
export async function withFallback<T>(fns: Array<() => Promise<T>>): Promise<T> {
  let lastErr: unknown;
  for (const fn of fns) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('withFallback: all alternatives failed');
}

// ─── withRetryOnSelector ──────────────────────────────────────────────────────

/**
 * Retry an operation that fails because a UI element isn't ready yet.
 * Useful when a page slowly renders after a click.
 *
 * Shorthand for `withRetry` with sensible browser-automation defaults.
 */
export async function withRetryOnElement<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; delayMs?: number } = {}
): Promise<T> {
  return withRetry(() => fn(), {
    maxAttempts: options.maxAttempts ?? 3,
    delayMs: options.delayMs ?? 1000,
    backoff: 1.5,
    shouldRetry: err =>
      err instanceof Error && (
        err.message.includes('locator') ||
        err.message.includes('selector') ||
        err.message.includes('waiting for') ||
        err.message.includes('Timeout')
      ),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

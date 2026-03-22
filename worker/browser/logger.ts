/**
 * Structured browser automation logger.
 *
 * Writes JSON log lines to stdout and optionally forwards to a sink
 * (e.g. the DB `logs` table via a callback). No third-party dependencies.
 */

import type { LogEntry, LogLevel, LogSink, ServiceName } from './types';

// ─── Global sink registration ─────────────────────────────────────────────────

const sinks: LogSink[] = [];

/** Register a global log sink (e.g. DB writer). Call before any logging. */
export function addLogSink(sink: LogSink): void {
  sinks.push(sink);
}

/** Remove a previously registered sink. */
export function removeLogSink(sink: LogSink): void {
  const idx = sinks.indexOf(sink);
  if (idx !== -1) sinks.splice(idx, 1);
}

// ─── Log level filtering ──────────────────────────────────────────────────────

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function currentMinLevel(): LogLevel {
  const env = process.env.BROWSER_LOG_LEVEL ?? 'info';
  return (env as LogLevel) in LEVEL_RANK ? (env as LogLevel) : 'info';
}

// ─── Core emit ────────────────────────────────────────────────────────────────

function emit(entry: LogEntry): void {
  if (LEVEL_RANK[entry.level] < LEVEL_RANK[currentMinLevel()]) return;

  // Structured JSON to stdout — friendly for log aggregators
  const line = JSON.stringify({
    ts: new Date(entry.ts).toISOString(),
    level: entry.level,
    service: entry.service,
    action: entry.action,
    message: entry.message,
    ...(entry.meta ? { meta: entry.meta } : {}),
  });

  if (entry.level === 'error' || entry.level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }

  for (const sink of sinks) {
    try {
      sink(entry);
    } catch {
      // never let a broken sink crash the browser automation
    }
  }
}

// ─── BrowserLogger class ──────────────────────────────────────────────────────

/**
 * Per-service logger. Create one instance per adapter with `createLogger(service)`.
 *
 * Usage:
 *   const log = createLogger('suno');
 *   log.info('navigate', 'Navigating to create page');
 *   log.error('generate', 'Song card never appeared', { timeout: 300_000 });
 */
export class BrowserLogger {
  constructor(private readonly service: ServiceName) {}

  debug(action: string, message: string, meta?: Record<string, unknown>): void {
    emit({ ts: Date.now(), level: 'debug', service: this.service, action, message, meta });
  }

  info(action: string, message: string, meta?: Record<string, unknown>): void {
    emit({ ts: Date.now(), level: 'info', service: this.service, action, message, meta });
  }

  warn(action: string, message: string, meta?: Record<string, unknown>): void {
    emit({ ts: Date.now(), level: 'warn', service: this.service, action, message, meta });
  }

  error(action: string, message: string, meta?: Record<string, unknown>): void {
    emit({ ts: Date.now(), level: 'error', service: this.service, action, message, meta });
  }

  /** Convenience: log + rethrow */
  rethrow(action: string, err: unknown): never {
    this.error(action, String(err), { stack: err instanceof Error ? err.stack : undefined });
    throw err;
  }
}

/** Factory — preferred over constructing directly. */
export function createLogger(service: ServiceName): BrowserLogger {
  return new BrowserLogger(service);
}

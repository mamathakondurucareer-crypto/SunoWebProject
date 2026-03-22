/**
 * Shared types for the browser automation foundation layer.
 * No provider-specific business logic — pure infrastructure types only.
 */

// ─── Service identity ─────────────────────────────────────────────────────────

export type ServiceName = 'gemini' | 'chatgpt' | 'suno' | 'grok' | 'canva' | 'capcut' | 'local';

// ─── Browser context ──────────────────────────────────────────────────────────

export interface BrowserLaunchOptions {
  headless?: boolean;
  slowMo?: number;
  /** Default action/locator timeout in ms */
  timeout?: number;
  /** Navigation timeout in ms */
  navTimeout?: number;
  viewport?: { width: number; height: number };
  downloadsDir?: string;
  /** Extra Chromium flags */
  extraArgs?: string[];
}

// ─── Profiles ─────────────────────────────────────────────────────────────────

export interface BrowserProfile {
  service: ServiceName;
  profileDir: string;
  /** True when the directory exists and has cookie/storage files */
  hasData: boolean;
  /** Size in bytes, or null if directory doesn't exist */
  sizeBytes: number | null;
  lastModified: Date | null;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/**
 * Ordered list of CSS/XPath/text selectors to try for a given UI element.
 * The first visible match wins.
 */
export type SelectorChain = readonly string[];

/**
 * Map of logical key → SelectorChain for a given service.
 */
export type ServiceSelectorMap = Record<string, SelectorChain>;

/**
 * Flat key → single-selector-string map from the DB (legacy format).
 */
export type SelectorMap = Record<string, string>;

// ─── Failure artifacts ────────────────────────────────────────────────────────

export interface FailureArtifacts {
  screenshot?: string;
  html?: string;
  /** Wall-clock time the capture was taken */
  capturedAt: number;
}

// ─── Downloads ────────────────────────────────────────────────────────────────

export interface DownloadResult {
  savedPath: string;
  suggestedFilename: string;
  mimeType: string | null;
}

// ─── Retry ────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  maxAttempts: number;
  /** Base delay in ms between attempts */
  delayMs?: number;
  /** Multiply delay by this factor each attempt (exponential backoff) */
  backoff?: number;
  /** Return true to retry, false to re-throw immediately */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

// ─── Logger ───────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  service: ServiceName;
  action: string;
  message: string;
  meta?: Record<string, unknown>;
}

/** Optional callback so the worker can bridge logs into the DB */
export type LogSink = (entry: LogEntry) => void;

// ─── Page helpers ─────────────────────────────────────────────────────────────

export interface WaitForStableTextOptions {
  /** Number of consecutive equal-text polls required before resolving */
  stableCount?: number;
  /** Polling interval in ms */
  pollIntervalMs?: number;
  /** Max total wait time in ms */
  timeoutMs?: number;
}

export interface FindFirstOptions {
  /** Total time budget across all selectors in ms */
  timeoutMs?: number;
  /** Per-selector probe timeout in ms (defaults to 3000) */
  probeMs?: number;
  state?: 'visible' | 'attached' | 'detached' | 'hidden';
}

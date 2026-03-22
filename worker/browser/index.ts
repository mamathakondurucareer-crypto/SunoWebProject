/**
 * Browser automation foundation — public API.
 *
 * Import from this barrel rather than individual modules so that
 * internal restructuring doesn't break adapter imports.
 *
 * @example
 *   import {
 *     BrowserContextManager,
 *     createLogger,
 *     captureFailureArtifacts,
 *     waitForStableText,
 *     resolveSelector,
 *   } from '../browser';
 */

// Core types
export type {
  ServiceName,
  BrowserLaunchOptions,
  BrowserProfile,
  SelectorChain,
  SelectorMap,
  ServiceSelectorMap,
  FailureArtifacts,
  DownloadResult,
  RetryOptions,
  LogLevel,
  LogEntry,
  LogSink,
  WaitForStableTextOptions,
  FindFirstOptions,
} from './types';

// Context lifecycle
export { BrowserContextManager } from './context-manager';

// Profile management
export {
  getProfilePath,
  ensureProfileDir,
  getProfileInfo,
  listAllProfiles,
  clearProfile,
  isProfileAuthenticated,
} from './profile-manager';

// Structured logging
export { BrowserLogger, createLogger, addLogSink, removeLogSink } from './logger';

// Page interaction utilities
export {
  waitForNetworkIdle,
  waitForDOMReady,
  findFirstVisible,
  waitForAny,
  clearAndFill,
  typeSlowly,
  pasteText,
  replaceFieldText,
  extractLastText,
  extractAllText,
  extractAttribute,
  waitForStableText,
  waitForStreamingComplete,
  scrollToBottom,
  scrollToTop,
  scrollIntoView,
  isVisible,
  isHidden,
  waitForVisible,
  waitForHidden,
  injectAntiDetection,
  autoDismissDialogs,
  getFrameBySelector,
} from './page-helpers';

// Selector registry
export {
  registerDefaults,
  registerDefault,
  getDefaults,
  resolveSelector,
  resolveSelectors,
  sel,
} from './selector-registry';

// Failure artifact capture
export {
  captureScreenshot,
  captureHTML,
  captureFailureArtifacts,
  captureConsoleErrors,
  captureNetworkErrors,
  captureDiagnosticBundle,
} from './error-capture';
export type {
  ConsoleCapture,
  NetworkCapture,
  DiagnosticBundle,
} from './error-capture';

// Download helpers
export {
  waitForDownload,
  saveDownload,
  waitForMultipleDownloads,
  pollForNewFile,
  snapshotDir,
  downloadViaPageFetch,
  extractVideoSrc,
} from './download-helpers';

// Retry / timeout utilities
export {
  withRetry,
  withTimeout,
  withFallback,
  withRetryOnElement,
  sleep,
  TimeoutError,
} from './retry';

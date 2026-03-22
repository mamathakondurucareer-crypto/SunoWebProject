/**
 * Selector registry abstraction layer.
 *
 * Two-tier resolution:
 *   1. DB override map (from `selectors` table — can be edited via Settings UI)
 *   2. Built-in default chains registered per service
 *
 * Consumers call `resolveSelector(service, key, page?, dbMap?)` and get back the
 * first selector that actually exists on the current page — or the first default
 * if no page is given (for use before navigation).
 */

import type { Page } from 'playwright';
import type { ServiceName, SelectorMap, SelectorChain, ServiceSelectorMap } from './types';

// ─── Registry store ───────────────────────────────────────────────────────────

const registry = new Map<ServiceName, ServiceSelectorMap>();

/**
 * Register default selector chains for a service.
 * Call once at module load time (or from adapter constructors).
 *
 * @example
 *   registerDefaults('suno', {
 *     lyrics_input: ['textarea[placeholder*="lyrics"]', '[data-testid="lyrics-input"]'],
 *     create_button: ['button:has-text("Create")', 'button[type="submit"]'],
 *   });
 */
export function registerDefaults(service: ServiceName, map: ServiceSelectorMap): void {
  const existing = registry.get(service) ?? {};
  registry.set(service, { ...existing, ...map });
}

/**
 * Add a single default chain for a service/key pair.
 */
export function registerDefault(service: ServiceName, key: string, chain: SelectorChain): void {
  const existing = registry.get(service) ?? {};
  registry.set(service, { ...existing, [key]: chain });
}

/**
 * Look up the registered default chain for a key, or an empty array.
 */
export function getDefaults(service: ServiceName, key: string): SelectorChain {
  return registry.get(service)?.[key] ?? [];
}

// ─── Resolution ───────────────────────────────────────────────────────────────

/**
 * Resolve the best selector for a logical key.
 *
 * Resolution order:
 *   1. `dbMap[key]` — DB override (verbatim string, may be comma-separated)
 *   2. Registered default chain — each entry tried in order
 *
 * If `page` is supplied, each candidate is probed for visibility (fast 1 s probe).
 * If no candidate is visible, returns the first candidate anyway as a best-effort.
 *
 * If `page` is not supplied, returns the first DB override or the first default.
 */
export async function resolveSelector(
  service: ServiceName,
  key: string,
  page: Page | null,
  dbMap: SelectorMap = {}
): Promise<string | null> {
  // Build the ordered candidate list
  const candidates: string[] = [];

  if (dbMap[key]) {
    // DB value may be comma-separated (legacy format) — split into individuals
    candidates.push(...dbMap[key].split(',').map(s => s.trim()).filter(Boolean));
  }

  const defaults = getDefaults(service, key);
  candidates.push(...defaults);

  if (candidates.length === 0) return null;

  if (!page) return candidates[0];

  // Probe each candidate for visibility
  for (const sel of candidates) {
    try {
      await page.locator(sel).first().waitFor({ timeout: 1_000, state: 'visible' });
      return sel;
    } catch {
      // not visible yet — try next
    }
  }

  // None visible — return first as best-effort (caller can wait further)
  return candidates[0];
}

/**
 * Resolve multiple keys at once. Returns a map of key → resolved selector.
 * Missing keys map to `null`.
 */
export async function resolveSelectors(
  service: ServiceName,
  keys: readonly string[],
  page: Page | null,
  dbMap: SelectorMap = {}
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  for (const key of keys) {
    result[key] = await resolveSelector(service, key, page, dbMap);
  }
  return result;
}

/**
 * Legacy helper: given a DB SelectorMap and a key, return the DB value or
 * fall back to a caller-supplied default string. Mirrors BaseServiceAdapter.sel().
 */
export function sel(map: SelectorMap, key: string, defaultValue: string): string {
  return map[key] ?? defaultValue;
}

// ─── Built-in defaults ────────────────────────────────────────────────────────

registerDefaults('gemini', {
  input_box: [
    '[contenteditable="true"][aria-label*="message"]',
    '[contenteditable="true"].ql-editor',
    'div[contenteditable="true"]',
    'rich-textarea [contenteditable="true"]',
  ],
  send_button: [
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    'mat-icon[fonticon="send"]',
    'button.send-button',
  ],
  response_container: [
    'model-response .markdown',
    'model-response',
    '[data-message-role="model"] .markdown',
    '.response-content',
  ],
});

registerDefaults('chatgpt', {
  input_box: [
    '#prompt-textarea',
    'div[contenteditable="true"][data-id="root"]',
    'textarea[placeholder*="Message"]',
  ],
  send_button: [
    'button[data-testid="send-button"]',
    'button[aria-label="Send message"]',
    'button.send-button',
  ],
  stop_button: [
    'button[aria-label="Stop streaming"]',
    'button[data-testid="stop-button"]',
    'button:has-text("Stop")',
  ],
  response_container: [
    '[data-message-author-role="assistant"] .markdown',
    '[data-message-author-role="assistant"] .prose',
    '.assistant .message-content',
  ],
});

registerDefaults('suno', {
  custom_mode_toggle: [
    'button:has-text("Custom")',
    '[data-testid="custom-mode-toggle"]',
    'button[aria-label*="Custom"]',
  ],
  lyrics_input: [
    'textarea[placeholder*="lyrics"]',
    'textarea[placeholder*="Lyrics"]',
    '[data-testid="lyrics-input"]',
    'textarea[name="lyrics"]',
  ],
  style_input: [
    'textarea[placeholder*="style"]',
    'input[placeholder*="style"]',
    '[data-testid="style-input"]',
  ],
  title_input: [
    'input[placeholder*="title"]',
    'input[placeholder*="Title"]',
    '[data-testid="title-input"]',
  ],
  create_button: [
    'button:has-text("Create")',
    'button[type="submit"]:has-text("Create")',
    '[data-testid="create-button"]',
  ],
  song_card: [
    '[data-testid="song-card"]',
    '.song-card',
    '[class*="song-item"]',
    '[class*="SongCard"]',
  ],
  download_button: [
    'button[aria-label*="Download"]',
    'button:has-text("Download")',
    '[data-testid="download-button"]',
  ],
});

registerDefaults('grok', {
  prompt_input: [
    'textarea[placeholder*="prompt"]',
    'textarea[placeholder*="Describe"]',
    '[data-testid="prompt-input"]',
    'div[contenteditable="true"]',
  ],
  generate_button: [
    'button:has-text("Generate")',
    'button[type="submit"]',
    '[data-testid="generate-button"]',
  ],
  download_button: [
    'button[aria-label*="Download"]',
    'button:has-text("Download")',
    '[data-testid="download-btn"]',
  ],
  video_result: [
    'video',
    '[data-testid="video-result"]',
    '[class*="video-player"]',
  ],
  generation_spinner: [
    '[aria-label*="generating"]',
    '[class*="spinner"]',
    '[data-testid="loading-indicator"]',
  ],
});

registerDefaults('canva', {
  create_design_button: [
    'button:has-text("Create a design")',
    '[data-testid="create-design-btn"]',
    'a:has-text("Create a design")',
  ],
  custom_size_option: [
    'button:has-text("Custom size")',
    '[data-testid="custom-size-btn"]',
    'li:has-text("Custom size")',
  ],
  width_input: [
    'input[aria-label*="width" i]',
    'input[placeholder*="width" i]',
    '[data-testid="width-input"]',
  ],
  height_input: [
    'input[aria-label*="height" i]',
    'input[placeholder*="height" i]',
    '[data-testid="height-input"]',
  ],
  share_button: [
    'button:has-text("Share")',
    '[data-testid="share-btn"]',
    'button[aria-label*="Share"]',
  ],
  download_button: [
    'button:has-text("Download")',
    '[data-testid="download-btn"]',
    'a:has-text("Download")',
  ],
});

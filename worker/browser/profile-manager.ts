/**
 * Browser profile manager.
 *
 * Responsible for:
 * - Mapping service names to persistent Chromium profile directories
 * - Creating directories on demand
 * - Reporting whether a profile has authentication data
 * - Clearing profiles to force re-authentication
 */

import fs from 'fs';
import path from 'path';
import type { BrowserProfile, ServiceName } from './types';

const DEFAULT_BASE_DIR = path.join(process.cwd(), 'data', 'browser-profiles');

/**
 * Resolve the base directory for all browser profiles.
 * Reads BROWSER_PROFILES_DIR env var, falling back to data/browser-profiles.
 */
function resolveBaseDir(): string {
  return process.env.BROWSER_PROFILES_DIR ?? DEFAULT_BASE_DIR;
}

/**
 * Heuristic: consider a profile "authenticated" if it contains any known
 * Chromium storage files. Does NOT actually verify the session is still valid.
 */
const SESSION_MARKERS = [
  'Default/Cookies',
  'Default/Local Storage',
  'Default/IndexedDB',
  'Default/Session Storage',
];

function hasSessionData(profileDir: string): boolean {
  return SESSION_MARKERS.some(marker =>
    fs.existsSync(path.join(profileDir, marker))
  );
}

function getDirStats(dir: string): { sizeBytes: number; lastModified: Date } | null {
  if (!fs.existsSync(dir)) return null;

  let totalBytes = 0;
  let latestMtime = new Date(0);

  function walk(current: string): void {
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        try {
          if (entry.isDirectory()) {
            walk(fullPath);
          } else {
            const stat = fs.statSync(fullPath);
            totalBytes += stat.size;
            if (stat.mtime > latestMtime) latestMtime = stat.mtime;
          }
        } catch {
          // skip locked / inaccessible files
        }
      }
    } catch {
      // skip unreadable directories
    }
  }

  walk(dir);
  return { sizeBytes: totalBytes, lastModified: latestMtime };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return the absolute path for a service's browser profile directory.
 * Does NOT create it — call `ensureProfileDir` for that.
 */
export function getProfilePath(service: ServiceName): string {
  return path.join(resolveBaseDir(), service);
}

/**
 * Create the profile directory if it doesn't already exist.
 * Returns the resolved path.
 */
export function ensureProfileDir(service: ServiceName): string {
  const profileDir = getProfilePath(service);
  fs.mkdirSync(profileDir, { recursive: true });
  return profileDir;
}

/**
 * Collect metadata about a service's browser profile.
 */
export function getProfileInfo(service: ServiceName): BrowserProfile {
  const profileDir = getProfilePath(service);
  const exists = fs.existsSync(profileDir);
  const hasData = exists && hasSessionData(profileDir);
  const stats = exists ? getDirStats(profileDir) : null;

  return {
    service,
    profileDir,
    hasData,
    sizeBytes: stats?.sizeBytes ?? null,
    lastModified: stats?.lastModified ?? null,
  };
}

/**
 * Return metadata for every known service.
 */
export function listAllProfiles(): BrowserProfile[] {
  const services: ServiceName[] = ['gemini', 'chatgpt', 'suno', 'grok', 'canva', 'capcut'];
  return services.map(getProfileInfo);
}

/**
 * Delete all files in a service's profile directory, forcing a fresh login.
 * Keeps the directory itself so Playwright can still use it.
 */
export function clearProfile(service: ServiceName): void {
  const profileDir = getProfilePath(service);
  if (!fs.existsSync(profileDir)) return;

  for (const entry of fs.readdirSync(profileDir)) {
    const fullPath = path.join(profileDir, entry);
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } catch {
      // ignore locked OS files
    }
  }
}

/**
 * Quick check: has this service's profile ever been used for authentication?
 */
export function isProfileAuthenticated(service: ServiceName): boolean {
  return hasSessionData(getProfilePath(service));
}

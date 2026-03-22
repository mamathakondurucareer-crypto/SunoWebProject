import { getDb } from '../client';
import type { AppSetting } from '@/types';

export const settingsRepo = {
  findAll(): AppSetting[] {
    return getDb().prepare('SELECT * FROM app_settings ORDER BY key ASC').all() as AppSetting[];
  },

  get(key: string): string | null {
    const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  },

  getOrDefault(key: string, defaultValue: string): string {
    return this.get(key) ?? defaultValue;
  },

  set(key: string, value: string, description?: string): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO app_settings (key, value, description, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, description = COALESCE(excluded.description, description), updated_at = excluded.updated_at
    `).run(key, value, description ?? null, Date.now());
  },

  setMany(settings: Record<string, string>): void {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    const tx = db.transaction((items: [string, string][]) => {
      for (const [k, v] of items) {
        stmt.run(k, v, Date.now());
      }
    });
    tx(Object.entries(settings));
  },

  getProjectsDir(): string {
    return this.getOrDefault('projects_dir', process.env.PROJECTS_DIR ?? '/data/projects');
  },

  getDownloadsDir(): string {
    return this.getOrDefault('downloads_dir', process.env.DOWNLOADS_DIR ?? '/data/downloads');
  },

  getBrowserProfilesDir(): string {
    return this.getOrDefault('browser_profiles_dir', process.env.BROWSER_PROFILES_DIR ?? '/data/browser-profiles');
  },
};

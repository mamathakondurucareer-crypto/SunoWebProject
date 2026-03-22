import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../client';
import type { BrowserProfile, ServiceName } from '@/types';
import path from 'path';
import fs from 'fs';

function deserialize(row: Record<string, unknown>): BrowserProfile {
  return {
    ...row,
    is_connected: row.is_connected === 1,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
  } as unknown as BrowserProfile;
}

export const browserProfilesRepo = {
  findAll(): BrowserProfile[] {
    const rows = getDb().prepare('SELECT * FROM browser_profiles ORDER BY service ASC').all() as Record<string, unknown>[];
    return rows.map(deserialize);
  },

  findByService(service: ServiceName): BrowserProfile | null {
    const row = getDb().prepare('SELECT * FROM browser_profiles WHERE service = ?').get(service) as Record<string, unknown> | undefined;
    return row ? deserialize(row) : null;
  },

  findById(id: string): BrowserProfile | null {
    const row = getDb().prepare('SELECT * FROM browser_profiles WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? deserialize(row) : null;
  },

  upsert(service: ServiceName): BrowserProfile {
    const db = getDb();
    const existing = this.findByService(service);
    if (existing) return existing;

    const profilesDir = process.env.BROWSER_PROFILES_DIR ?? path.join(process.cwd(), 'data', 'browser-profiles');
    const profilePath = path.join(profilesDir, service);
    fs.mkdirSync(profilePath, { recursive: true });

    const id = uuidv4();
    const now = Date.now();
    db.prepare(`
      INSERT INTO browser_profiles (id, service, profile_path, is_connected, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).run(id, service, profilePath, now, now);
    return this.findById(id)!;
  },

  markConnected(id: string, connected: boolean): void {
    const db = getDb();
    const now = Date.now();
    db.prepare(`
      UPDATE browser_profiles SET is_connected = ?, last_login_at = CASE WHEN ? = 1 THEN ? ELSE last_login_at END, updated_at = ? WHERE id = ?
    `).run(connected ? 1 : 0, connected ? 1 : 0, now, now, id);
  },

  touchUsed(service: ServiceName): void {
    getDb().prepare('UPDATE browser_profiles SET last_used_at = ?, updated_at = ? WHERE service = ?').run(Date.now(), Date.now(), service);
  },

  markDisconnected(service: ServiceName): void {
    getDb().prepare('UPDATE browser_profiles SET is_connected = 0, updated_at = ? WHERE service = ?').run(Date.now(), service);
  },
};

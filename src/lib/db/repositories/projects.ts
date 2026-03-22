import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../client';
import type { Project, ProjectStatus } from '@/types';

function parseProject(row: Record<string, unknown>): Project {
  return row as unknown as Project;
}

export const projectsRepo = {
  findAll(status?: ProjectStatus): Project[] {
    const db = getDb();
    if (status) {
      return db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC').all(status) as Project[];
    }
    return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Project[];
  },

  findById(id: string): Project | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return row ? parseProject(row as Record<string, unknown>) : null;
  },

  create(data: {
    name: string;
    description?: string;
    devotional_theme: string;
    target_language?: string;
  }): Project {
    const db = getDb();
    const now = Date.now();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO projects (id, name, description, devotional_theme, target_language, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, data.name, data.description ?? null, data.devotional_theme, data.target_language ?? 'English', now, now);
    return this.findById(id)!;
  },

  update(id: string, data: Partial<Pick<Project, 'name' | 'description' | 'devotional_theme' | 'target_language' | 'status'>>): Project | null {
    const db = getDb();
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(data)) {
      fields.push(`${k} = ?`);
      values.push(v);
    }
    if (fields.length === 0) return this.findById(id);
    fields.push('updated_at = ?');
    values.push(Date.now(), id);
    db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.findById(id);
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
  },

  count(): number {
    const row = getDb().prepare('SELECT COUNT(*) as n FROM projects WHERE status = ?').get('active') as { n: number };
    return row.n;
  },
};

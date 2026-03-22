import { getDb } from '../client';
import type { Selector, ServiceName } from '@/types';
import { v4 as uuidv4 } from 'uuid';

function deserialize(row: Record<string, unknown>): Selector {
  return {
    ...row,
    is_active: row.is_active === 1,
  } as unknown as Selector;
}

export const selectorsRepo = {
  findByService(service: ServiceName): Selector[] {
    const rows = getDb()
      .prepare('SELECT * FROM selectors WHERE service = ? AND is_active = 1 ORDER BY selector_key ASC')
      .all(service) as Record<string, unknown>[];
    return rows.map(deserialize);
  },

  findByKey(service: ServiceName, key: string): Selector | null {
    const row = getDb()
      .prepare('SELECT * FROM selectors WHERE service = ? AND selector_key = ? AND is_active = 1')
      .get(service, key) as Record<string, unknown> | undefined;
    return row ? deserialize(row) : null;
  },

  findAll(): Selector[] {
    const rows = getDb().prepare('SELECT * FROM selectors ORDER BY service ASC, selector_key ASC').all() as Record<string, unknown>[];
    return rows.map(deserialize);
  },

  getSelectorMap(service: ServiceName): Record<string, string> {
    const selectors = this.findByService(service);
    return Object.fromEntries(selectors.map(s => [s.selector_key, s.selector_value]));
  },

  upsert(data: {
    service: ServiceName;
    selector_key: string;
    selector_value: string;
    selector_type?: string;
    description?: string;
  }): Selector {
    const db = getDb();
    const now = Date.now();
    db.prepare(`
      INSERT INTO selectors (id, service, selector_key, selector_value, selector_type, description, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(service, selector_key) DO UPDATE SET
        selector_value = excluded.selector_value,
        selector_type = excluded.selector_type,
        description = excluded.description,
        updated_at = excluded.updated_at
    `).run(
      uuidv4(),
      data.service,
      data.selector_key,
      data.selector_value,
      data.selector_type ?? 'css',
      data.description ?? null,
      now,
      now,
    );
    return this.findByKey(data.service, data.selector_key)!;
  },

  setActive(id: string, active: boolean): void {
    getDb().prepare('UPDATE selectors SET is_active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, Date.now(), id);
  },
};

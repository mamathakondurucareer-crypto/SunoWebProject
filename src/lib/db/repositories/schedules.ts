import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../client';
import type { Schedule, ScheduleStatus, ScheduleType } from '@/types';

function deserialize(row: Record<string, unknown>): Schedule {
  return {
    ...row,
    workflow_config: row.workflow_config ? JSON.parse(row.workflow_config as string) : null,
    missed_run_policy: (row.missed_run_policy ?? 'skip') as 'skip' | 'run_once',
    timezone: (row.timezone ?? 'UTC') as string,
    max_run_count: row.max_run_count as number | null,
  } as unknown as Schedule;
}

export const schedulesRepo = {
  findAll(status?: ScheduleStatus): Schedule[] {
    const db = getDb();
    if (status) {
      const rows = db.prepare('SELECT * FROM schedules WHERE status = ? ORDER BY created_at DESC').all(status) as Record<string, unknown>[];
      return rows.map(deserialize);
    }
    const rows = db.prepare('SELECT * FROM schedules ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(deserialize);
  },

  findById(id: string): Schedule | null {
    const row = getDb().prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? deserialize(row) : null;
  },

  findDue(): Schedule[] {
    const now = Date.now();
    const rows = getDb().prepare(`
      SELECT * FROM schedules
      WHERE status = 'active'
      AND (
        (schedule_type = 'once' AND run_at <= ? AND run_at IS NOT NULL)
        OR (schedule_type = 'recurring' AND next_run_at <= ? AND next_run_at IS NOT NULL)
      )
    `).all(now, now) as Record<string, unknown>[];
    return rows.map(deserialize);
  },

  create(data: {
    project_id?: string;
    name: string;
    schedule_type: ScheduleType;
    cron_expression?: string;
    run_at?: number;
    workflow_config?: Record<string, unknown>;
    next_run_at?: number;
    missed_run_policy?: string;
    timezone?: string;
    max_run_count?: number;
  }): Schedule {
    const db = getDb();
    const id = uuidv4();
    const now = Date.now();
    db.prepare(`
      INSERT INTO schedules (id, project_id, name, schedule_type, cron_expression, run_at, workflow_config, status, next_run_at, run_count, missed_run_policy, timezone, max_run_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.project_id ?? null,
      data.name,
      data.schedule_type,
      data.cron_expression ?? null,
      data.run_at ?? null,
      data.workflow_config ? JSON.stringify(data.workflow_config) : null,
      data.next_run_at ?? null,
      data.missed_run_policy ?? 'skip',
      data.timezone ?? 'UTC',
      data.max_run_count ?? null,
      now,
      now,
    );
    return this.findById(id)!;
  },

  updateStatus(id: string, status: ScheduleStatus): void {
    getDb().prepare('UPDATE schedules SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
  },

  recordRun(id: string, nextRunAt?: number): void {
    const db = getDb();
    const now = Date.now();
    db.prepare(`
      UPDATE schedules SET last_run_at = ?, next_run_at = ?, run_count = run_count + 1, updated_at = ? WHERE id = ?
    `).run(now, nextRunAt ?? null, now, id);
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM schedules WHERE id = ?').run(id);
  },

  countActive(): number {
    const row = getDb().prepare("SELECT COUNT(*) as n FROM schedules WHERE status = 'active'").get() as { n: number };
    return row.n;
  },

  update(id: string, data: {
    name?: string;
    cron_expression?: string;
    workflow_config?: Record<string, unknown>;
    missed_run_policy?: string;
    max_run_count?: number | null;
  }): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      fields.push('name = ?');
      values.push(data.name);
    }
    if (data.cron_expression !== undefined) {
      fields.push('cron_expression = ?');
      values.push(data.cron_expression);
    }
    if (data.workflow_config !== undefined) {
      fields.push('workflow_config = ?');
      values.push(data.workflow_config ? JSON.stringify(data.workflow_config) : null);
    }
    if (data.missed_run_policy !== undefined) {
      fields.push('missed_run_policy = ?');
      values.push(data.missed_run_policy);
    }
    if (data.max_run_count !== undefined) {
      fields.push('max_run_count = ?');
      values.push(data.max_run_count);
    }

    if (fields.length === 0) return;

    fields.push('updated_at = ?');
    values.push(Date.now(), id);
    getDb().prepare(`UPDATE schedules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },

  findByProject(projectId: string, status?: ScheduleStatus): Schedule[] {
    const db = getDb();
    let query = 'SELECT * FROM schedules WHERE project_id = ?';
    const params: unknown[] = [projectId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';
    const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map(deserialize);
  },
};

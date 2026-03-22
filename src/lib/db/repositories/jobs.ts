import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../client';
import type { Job, JobStatus } from '@/types';

function deserialize(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    type: row.type as string,
    payload: JSON.parse(row.payload as string),
    status: row.status as JobStatus,
    priority: row.priority as number,
    attempt: (row.attempt as number) ?? 0,
    max_attempts: (row.max_attempts as number) ?? 3,
    run_at: row.run_at as number,
    started_at: (row.started_at as number | null) ?? null,
    completed_at: (row.completed_at as number | null) ?? null,
    error: (row.error as string | null) ?? null,
    worker_id: (row.worker_id as string | null) ?? null,
    created_at: row.created_at as number,
  };
}

export const jobsRepo = {
  findById(id: string): Job | null {
    const row = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? deserialize(row) : null;
  },

  findAll(status?: JobStatus): Job[] {
    const db = getDb();
    if (status) {
      const rows = db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY priority DESC, run_at ASC').all(status) as Record<string, unknown>[];
      return rows.map(deserialize);
    }
    const rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100').all() as Record<string, unknown>[];
    return rows.map(deserialize);
  },

  /**
   * Atomically claim the next queued job.
   *
   * The SELECT + UPDATE pattern has a TOCTOU race when multiple worker
   * processes share the same SQLite file (even in WAL mode). Wrapping both
   * statements in a transaction + using `changes === 0` as a lost-race guard
   * eliminates the window.
   */
  dequeue(workerId: string): Job | null {
    const db = getDb();
    const now = Date.now();

    const claim = db.transaction(() => {
      const row = db.prepare(`
        SELECT * FROM jobs
        WHERE status = 'queued' AND run_at <= ?
        ORDER BY priority DESC, run_at ASC
        LIMIT 1
      `).get(now) as Record<string, unknown> | undefined;

      if (!row) return null;

      const result = db.prepare(`
        UPDATE jobs
        SET status = 'running', started_at = ?, worker_id = ?, attempt = attempt + 1
        WHERE id = ? AND status = 'queued'
      `).run(now, workerId, row.id as string);

      if (result.changes === 0) return null; // lost race to another worker

      // Re-fetch so the returned row reflects the updated attempt count
      return db.prepare('SELECT * FROM jobs WHERE id = ?').get(row.id as string) as Record<string, unknown>;
    });

    const claimed = claim();
    return claimed ? deserialize(claimed) : null;
  },

  enqueue(data: {
    type: string;
    payload: Record<string, unknown>;
    priority?: number;
    run_at?: number;
    max_attempts?: number;
  }): Job {
    const db = getDb();
    const id = uuidv4();
    const now = Date.now();
    db.prepare(`
      INSERT INTO jobs (id, type, payload, status, priority, attempt, max_attempts, run_at, created_at)
      VALUES (?, ?, ?, 'queued', ?, 0, ?, ?, ?)
    `).run(
      id,
      data.type,
      JSON.stringify(data.payload),
      data.priority ?? 0,
      data.max_attempts ?? 3,
      data.run_at ?? now,
      now,
    );
    return this.findById(id)!;
  },

  markComplete(id: string): void {
    getDb().prepare("UPDATE jobs SET status = 'completed', completed_at = ? WHERE id = ?").run(Date.now(), id);
  },

  markFailed(id: string, error: string): void {
    getDb().prepare("UPDATE jobs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?").run(error, Date.now(), id);
  },

  cancelByPayload(workflowRunId: string): void {
    getDb().prepare(`
      UPDATE jobs SET status = 'failed', error = 'cancelled'
      WHERE status = 'queued' AND json_extract(payload, '$.workflow_run_id') = ?
    `).run(workflowRunId);
  },

  pruneCompleted(daysAgo = 7): void {
    const cutoff = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
    getDb().prepare("DELETE FROM jobs WHERE status IN ('completed', 'failed') AND completed_at < ?").run(cutoff);
  },
};

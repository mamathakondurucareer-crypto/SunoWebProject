import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../client';
import type { StageRun, StageStatus, StageKey } from '@/types';

type CreateStageRunData = {
  workflow_run_id: string;
  stage_key: StageKey;
  stage_index: number;
  max_attempts?: number;
  input?: Record<string, unknown>;
};

function deserialize(row: Record<string, unknown>): StageRun {
  return {
    ...row,
    input: row.input ? JSON.parse(row.input as string) : null,
    output: row.output ? JSON.parse(row.output as string) : null,
    is_active: row.is_active === 1,
  } as unknown as StageRun;
}

export const stageRunsRepo = {
  findByWorkflowRunId(workflowRunId: string): StageRun[] {
    const rows = getDb()
      .prepare('SELECT * FROM stage_runs WHERE workflow_run_id = ? ORDER BY stage_index ASC')
      .all(workflowRunId) as Record<string, unknown>[];
    return rows.map(deserialize);
  },

  findById(id: string): StageRun | null {
    const row = getDb().prepare('SELECT * FROM stage_runs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? deserialize(row) : null;
  },

  findByKey(workflowRunId: string, stageKey: StageKey): StageRun | null {
    const row = getDb()
      .prepare('SELECT * FROM stage_runs WHERE workflow_run_id = ? AND stage_key = ?')
      .get(workflowRunId, stageKey) as Record<string, unknown> | undefined;
    return row ? deserialize(row) : null;
  },

  create(data: {
    workflow_run_id: string;
    stage_key: StageKey;
    stage_index: number;
    max_attempts?: number;
    input?: Record<string, unknown>;
  }): StageRun {
    const db = getDb();
    const now = Date.now();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO stage_runs (id, workflow_run_id, stage_key, stage_index, status, attempt, max_attempts, input, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)
    `).run(
      id,
      data.workflow_run_id,
      data.stage_key,
      data.stage_index,
      data.max_attempts ?? 3,
      data.input ? JSON.stringify(data.input) : null,
      now,
      now,
    );
    return this.findById(id)!;
  },

  createMany(stages: CreateStageRunData[]): void {
    const db = getDb();
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO stage_runs (id, workflow_run_id, stage_key, stage_index, status, attempt, max_attempts, input, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((items: CreateStageRunData[]) => {
      for (const item of items) {
        stmt.run(uuidv4(), item.workflow_run_id, item.stage_key, item.stage_index, item.max_attempts ?? 3, item.input ? JSON.stringify(item.input) : null, now, now);
      }
    });
    insertMany(stages);
  },

  updateStatus(id: string, status: StageStatus): void {
    const db = getDb();
    const now = Date.now();
    const updates: string[] = ['status = ?', 'updated_at = ?'];
    const values: unknown[] = [status, now];

    if (status === 'running') {
      updates.push('started_at = COALESCE(started_at, ?)');
      values.push(now);
    }
    if (status === 'success' || status === 'failed' || status === 'skipped' || status === 'awaiting_input') {
      updates.push('completed_at = ?');
      values.push(now);
    }

    values.push(id);
    db.prepare(`UPDATE stage_runs SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  },

  markSuccess(id: string, output: Record<string, unknown>): void {
    const db = getDb();
    const now = Date.now();
    db.prepare(`
      UPDATE stage_runs SET status = 'success', output = ?, completed_at = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(output), now, now, id);
  },

  markFailed(id: string, error: string, screenshotPath?: string, htmlDumpPath?: string): void {
    const db = getDb();
    const now = Date.now();
    db.prepare(`
      UPDATE stage_runs SET status = 'failed', error_message = ?, screenshot_path = ?, html_dump_path = ?, completed_at = ?, updated_at = ? WHERE id = ?
    `).run(error, screenshotPath ?? null, htmlDumpPath ?? null, now, now, id);
  },

  markSkipped(id: string): void {
    const db = getDb();
    const now = Date.now();
    db.prepare(`
      UPDATE stage_runs SET status = 'skipped', completed_at = ?, updated_at = ? WHERE id = ?
    `).run(now, now, id);
  },

  markAwaitingInput(id: string, output: Record<string, unknown>): void {
    const db = getDb();
    const now = Date.now();
    db.prepare(`
      UPDATE stage_runs SET status = 'awaiting_input', output = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(output), now, id);
  },

  incrementAttempt(id: string): void {
    getDb().prepare('UPDATE stage_runs SET attempt = attempt + 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
  },

  resetForRetry(id: string): void {
    const db = getDb();
    const now = Date.now();
    db.prepare(`
      UPDATE stage_runs SET status = 'pending', error_message = NULL, screenshot_path = NULL, html_dump_path = NULL, started_at = NULL, completed_at = NULL, output = NULL, updated_at = ?
      WHERE id = ?
    `).run(now, id);
  },
};

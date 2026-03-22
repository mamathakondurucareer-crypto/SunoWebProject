import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../client';
import { TOTAL_STAGES } from '@/lib/workflow/definition';
import type { WorkflowRun, WorkflowRunStatus, WorkflowRunWithProject } from '@/types';

function deserializeRun(row: Record<string, unknown>): WorkflowRun {
  return {
    ...row,
    config: row.config ? JSON.parse(row.config as string) : null,
  } as unknown as WorkflowRun;
}

export const workflowRunsRepo = {
  findAll(projectId?: string): WorkflowRun[] {
    const db = getDb();
    if (projectId) {
      const rows = db.prepare('SELECT * FROM workflow_runs WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as Record<string, unknown>[];
      return rows.map(deserializeRun);
    }
    const rows = db.prepare('SELECT * FROM workflow_runs ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(deserializeRun);
  },

  findById(id: string): WorkflowRun | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? deserializeRun(row) : null;
  },

  findRecentWithProject(limit = 10): WorkflowRunWithProject[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT wr.*, p.name as project_name, p.devotional_theme as project_theme
      FROM workflow_runs wr
      JOIN projects p ON wr.project_id = p.id
      ORDER BY wr.created_at DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];
    return rows.map(r => ({ ...deserializeRun(r), project_name: r.project_name as string, project_theme: r.project_theme as string }));
  },

  create(data: {
    project_id: string;
    name: string;
    config?: Record<string, unknown>;
  }): WorkflowRun {
    const db = getDb();
    const now = Date.now();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO workflow_runs (id, project_id, name, status, total_stages, completed_stages, config, created_at, updated_at)
      VALUES (?, ?, ?, 'draft', ?, 0, ?, ?, ?)
    `).run(id, data.project_id, data.name, TOTAL_STAGES, data.config ? JSON.stringify(data.config) : null, now, now);
    return this.findById(id)!;
  },

  updateStatus(id: string, status: WorkflowRunStatus, currentStage?: string | null): void {
    const db = getDb();
    const now = Date.now();
    const updates: string[] = ['status = ?', 'updated_at = ?'];
    const values: unknown[] = [status, now];

    if (currentStage !== undefined) {
      updates.push('current_stage = ?');
      values.push(currentStage);
    }
    if (status === 'running') {
      updates.push('started_at = COALESCE(started_at, ?)');
      values.push(now);
    }
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updates.push('completed_at = ?');
      values.push(now);
    }

    values.push(id);
    db.prepare(`UPDATE workflow_runs SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  },

  incrementCompletedStages(id: string): void {
    getDb().prepare('UPDATE workflow_runs SET completed_stages = completed_stages + 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
  },

  countByStatus(status: WorkflowRunStatus): number {
    const row = getDb().prepare('SELECT COUNT(*) as n FROM workflow_runs WHERE status = ?').get(status) as { n: number };
    return row.n;
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM workflow_runs WHERE id = ?').run(id);
  },
};

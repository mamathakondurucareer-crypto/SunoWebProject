import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../client';
import type { Approval, ApprovalStatus, ApprovalOption } from '@/types';

function deserialize(row: Record<string, unknown>): Approval {
  return {
    ...row,
    options: row.options ? JSON.parse(row.options as string) : null,
  } as unknown as Approval;
}

export const approvalsRepo = {
  findByWorkflowRun(workflowRunId: string): Approval[] {
    const rows = getDb()
      .prepare('SELECT * FROM approvals WHERE workflow_run_id = ? ORDER BY created_at ASC')
      .all(workflowRunId) as Record<string, unknown>[];
    return rows.map(deserialize);
  },

  findPending(): Approval[] {
    const rows = getDb()
      .prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at ASC")
      .all() as Record<string, unknown>[];
    return rows.map(deserialize);
  },

  findById(id: string): Approval | null {
    const row = getDb().prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? deserialize(row) : null;
  },

  create(data: {
    workflow_run_id: string;
    stage_run_id?: string;
    approval_type: string;
    options?: ApprovalOption[];
  }): Approval {
    const db = getDb();
    const id = uuidv4();
    const now = Date.now();
    db.prepare(`
      INSERT INTO approvals (id, workflow_run_id, stage_run_id, approval_type, status, options, requested_at, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      id,
      data.workflow_run_id,
      data.stage_run_id ?? null,
      data.approval_type,
      data.options ? JSON.stringify(data.options) : null,
      now,
      now,
    );
    return this.findById(id)!;
  },

  resolve(id: string, status: ApprovalStatus, selectedOption?: string, notes?: string): Approval | null {
    const db = getDb();
    const now = Date.now();
    db.prepare(`
      UPDATE approvals SET status = ?, selected_option = ?, notes = ?, resolved_at = ? WHERE id = ?
    `).run(status, selectedOption ?? null, notes ?? null, now, id);
    return this.findById(id);
  },

  countPending(): number {
    const row = getDb().prepare("SELECT COUNT(*) as n FROM approvals WHERE status = 'pending'").get() as { n: number };
    return row.n;
  },
};

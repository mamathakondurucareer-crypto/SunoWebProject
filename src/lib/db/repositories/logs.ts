import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../client';
import type { Log, LogLevel } from '@/types';

function deserialize(row: Record<string, unknown>): Log {
  return {
    ...row,
    context: row.context ? JSON.parse(row.context as string) : null,
  } as unknown as Log;
}

export const logsRepo = {
  findByWorkflowRun(workflowRunId: string, limit = 500): Log[] {
    const rows = getDb()
      .prepare('SELECT * FROM logs WHERE workflow_run_id = ? ORDER BY created_at ASC LIMIT ?')
      .all(workflowRunId, limit) as Record<string, unknown>[];
    return rows.map(deserialize);
  },

  findByStageRun(stageRunId: string): Log[] {
    const rows = getDb()
      .prepare('SELECT * FROM logs WHERE stage_run_id = ? ORDER BY created_at ASC')
      .all(stageRunId) as Record<string, unknown>[];
    return rows.map(deserialize);
  },

  findRecent(limit = 100): Log[] {
    const rows = getDb()
      .prepare('SELECT * FROM logs ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map(deserialize);
  },

  append(data: {
    level: LogLevel;
    message: string;
    workflow_run_id?: string;
    stage_run_id?: string;
    context?: Record<string, unknown>;
  }): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO logs (id, workflow_run_id, stage_run_id, level, message, context, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      data.workflow_run_id ?? null,
      data.stage_run_id ?? null,
      data.level,
      data.message,
      data.context ? JSON.stringify(data.context) : null,
      Date.now(),
    );
  },

  pruneOlderThan(daysAgo: number): number {
    const cutoff = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
    const result = getDb().prepare('DELETE FROM logs WHERE created_at < ? AND workflow_run_id IS NULL AND stage_run_id IS NULL').run(cutoff);
    return result.changes;
  },
};

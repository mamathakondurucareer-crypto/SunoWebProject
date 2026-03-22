import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../client';
import type { Asset, AssetType } from '@/types';
import fs from 'fs';

function deserialize(row: Record<string, unknown>): Asset {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
  } as unknown as Asset;
}

export const assetsRepo = {
  findAll(filters?: { project_id?: string; workflow_run_id?: string; asset_type?: AssetType }): Asset[] {
    const db = getDb();
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters?.project_id) {
      conditions.push('project_id = ?');
      values.push(filters.project_id);
    }
    if (filters?.workflow_run_id) {
      conditions.push('workflow_run_id = ?');
      values.push(filters.workflow_run_id);
    }
    if (filters?.asset_type) {
      conditions.push('asset_type = ?');
      values.push(filters.asset_type);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM assets ${where} ORDER BY created_at DESC`).all(...values) as Record<string, unknown>[];
    return rows.map(deserialize);
  },

  findById(id: string): Asset | null {
    const row = getDb().prepare('SELECT * FROM assets WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? deserialize(row) : null;
  },

  findByWorkflowRun(workflowRunId: string): Asset[] {
    const rows = getDb().prepare('SELECT * FROM assets WHERE workflow_run_id = ? ORDER BY created_at ASC').all(workflowRunId) as Record<string, unknown>[];
    return rows.map(deserialize);
  },

  create(data: {
    workflow_run_id?: string;
    stage_run_id?: string;
    project_id?: string;
    name: string;
    asset_type: AssetType;
    service?: string;
    file_path: string;
    mime_type?: string;
    metadata?: Record<string, unknown>;
  }): Asset {
    const db = getDb();
    const id = uuidv4();
    const now = Date.now();
    let fileSize: number | null = null;
    try {
      const stat = fs.statSync(data.file_path);
      fileSize = stat.size;
    } catch {
      // file may not exist yet
    }

    db.prepare(`
      INSERT INTO assets (id, workflow_run_id, stage_run_id, project_id, name, asset_type, service, file_path, file_size, mime_type, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.workflow_run_id ?? null,
      data.stage_run_id ?? null,
      data.project_id ?? null,
      data.name,
      data.asset_type,
      data.service ?? null,
      data.file_path,
      fileSize,
      data.mime_type ?? null,
      data.metadata ? JSON.stringify(data.metadata) : null,
      now,
    );
    return this.findById(id)!;
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM assets WHERE id = ?').run(id);
  },

  countByWorkflowRun(workflowRunId: string): number {
    const row = getDb().prepare('SELECT COUNT(*) as n FROM assets WHERE workflow_run_id = ?').get(workflowRunId) as { n: number };
    return row.n;
  },
};

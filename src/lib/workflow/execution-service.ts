/**
 * ExecutionService — coordinates a single stage job end-to-end.
 *
 * Responsibilities:
 *  1. Load all required entities from the DB.
 *  2. Build the merged `inputs` map from completed upstream stages.
 *  3. Create and configure the AbortController for timeout/cancellation.
 *  4. Call the appropriate IStageRunner.
 *  5. Register returned artifacts in the assets table.
 *  6. Call the WorkflowEngine hooks based on the result.
 */

import path from 'path';
import fs from 'fs';
import { WorkflowEngine } from './engine';
import { STAGE_MAP } from './definition';
import { stageRunsRepo } from '../db/repositories/stage-runs';
import { workflowRunsRepo } from '../db/repositories/workflow-runs';
import { projectsRepo } from '../db/repositories/projects';
import { assetsRepo } from '../db/repositories/assets';
import { logsRepo } from '../db/repositories/logs';
import { settingsRepo } from '../db/repositories/settings';
import type { Job, StageKey, StageRun } from '@/types';
import type {
  ExecutionContext,
  ExecutionDirs,
  StageRunnerRegistry,
  StageRunResult,
  ArtifactDescriptor,
} from './types';

export class ExecutionService {
  constructor(private readonly runners: StageRunnerRegistry) {}

  async executeJob(job: Job): Promise<void> {
    const { stage_run_id, workflow_run_id, project_id } = job.payload as {
      stage_run_id: string;
      workflow_run_id: string;
      project_id: string;
    };

    // ── Load entities ────────────────────────────────────────────────────────
    const stageRun = stageRunsRepo.findById(stage_run_id);
    if (!stageRun) {
      logsRepo.append({ level: 'error', message: `ExecutionService: stage_run not found ${stage_run_id}` });
      return;
    }

    const workflowRun = workflowRunsRepo.findById(workflow_run_id);
    if (!workflowRun) {
      logsRepo.append({ level: 'error', message: `ExecutionService: workflow_run not found ${workflow_run_id}` });
      return;
    }

    const project = projectsRepo.findById(project_id as string);
    if (!project) {
      logsRepo.append({ level: 'error', message: `ExecutionService: project not found ${project_id}` });
      return;
    }

    const stageDef = STAGE_MAP[stageRun.stage_key as StageKey];
    if (!stageDef) {
      logsRepo.append({ level: 'error', message: `ExecutionService: unknown stage key ${stageRun.stage_key}` });
      return;
    }

    const runner = this.runners.get(stageRun.stage_key as StageKey);
    if (!runner) {
      logsRepo.append({ level: 'error', message: `ExecutionService: no runner registered for ${stageRun.stage_key}` });
      return;
    }

    // ── Transition to running ────────────────────────────────────────────────
    stageRunsRepo.updateStatus(stage_run_id, 'running');
    stageRunsRepo.incrementAttempt(stage_run_id);
    WorkflowEngine.markRunning(workflow_run_id, stageRun.stage_key as StageKey);

    logsRepo.append({
      level: 'info',
      message: `Starting stage: ${stageDef.name} (attempt ${stageRun.attempt + 1}/${stageRun.max_attempts})`,
      workflow_run_id,
      stage_run_id,
    });

    // ── Build dirs ───────────────────────────────────────────────────────────
    const projectsDir = settingsRepo.getProjectsDir();
    const projectSlug = WorkflowEngine.slugify(project.name);
    const dirs: ExecutionDirs = {
      project: path.join(projectsDir, projectSlug),
      run: path.join(projectsDir, projectSlug, workflow_run_id),
      downloads: settingsRepo.getDownloadsDir(),
    };
    fs.mkdirSync(dirs.run, { recursive: true });

    // ── Build inputs ─────────────────────────────────────────────────────────
    const inputs = this.buildInputs(workflow_run_id);

    // ── Set up abort signal ──────────────────────────────────────────────────
    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (stageDef.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => controller.abort(), stageDef.timeoutMs);
    }

    const ctx: ExecutionContext = {
      job,
      run: workflowRun,
      stage: { ...stageRun, attempt: stageRun.attempt + 1 } as StageRun,
      project,
      dirs,
      inputs,
      signal: controller.signal,
    };

    // ── Execute ──────────────────────────────────────────────────────────────
    let result: StageRunResult;
    try {
      result = await runner.run(ctx);
    } catch (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const errMsg = controller.signal.aborted ? `Stage timed out after ${stageDef.timeoutMs}ms` : String(err);
      logsRepo.append({ level: 'error', message: `Stage exception: ${stageDef.name} — ${errMsg}`, workflow_run_id, stage_run_id });
      stageRunsRepo.markFailed(stage_run_id, errMsg);
      WorkflowEngine.onStageFailed(stage_run_id, errMsg);
      return;
    }
    if (timeoutHandle) clearTimeout(timeoutHandle);

    // ── Register artifacts ───────────────────────────────────────────────────
    if (result.artifacts) {
      this.registerArtifacts(result.artifacts, workflow_run_id, stage_run_id, project_id as string, stageDef.service);
    }

    // ── Dispatch to engine ───────────────────────────────────────────────────
    if (result.status === 'success') {
      stageRunsRepo.markSuccess(stage_run_id, result.output);
      WorkflowEngine.onStageSuccess(stage_run_id, result.output);
    } else if (result.status === 'awaiting_input') {
      stageRunsRepo.markAwaitingInput(stage_run_id, result.output);
      WorkflowEngine.onStageAwaitingInput(stage_run_id, result.inputRequest);
    } else {
      stageRunsRepo.markFailed(stage_run_id, result.error);
      WorkflowEngine.onStageFailed(stage_run_id, result.error);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private buildInputs(workflowRunId: string): ExecutionContext['inputs'] {
    const allStages = stageRunsRepo.findByWorkflowRunId(workflowRunId);
    const inputs: ExecutionContext['inputs'] = {};
    for (const stage of allStages) {
      if ((stage.status === 'success' || stage.status === 'awaiting_input') && stage.output) {
        inputs[stage.stage_key as StageKey] = stage.output;
      }
    }
    return inputs;
  }

  private registerArtifacts(
    artifacts: ArtifactDescriptor[],
    workflowRunId: string,
    stageRunId: string,
    projectId: string,
    service: import('@/types').ServiceName,
  ): void {
    for (const artifact of artifacts) {
      if (!fs.existsSync(artifact.path)) continue;
      assetsRepo.create({
        workflow_run_id: workflowRunId,
        stage_run_id: stageRunId,
        project_id: projectId,
        name: artifact.name,
        asset_type: artifact.type,
        service,
        file_path: artifact.path,
        mime_type: artifact.mimeType,
      });
    }
  }
}

import { STAGE_DEFINITIONS, STAGE_MAP, TOTAL_STAGES } from './definition';
import { workflowRunsRepo } from '../db/repositories/workflow-runs';
import { stageRunsRepo } from '../db/repositories/stage-runs';
import { approvalsRepo } from '../db/repositories/approvals';
import { jobsRepo } from '../db/repositories/jobs';
import { logsRepo } from '../db/repositories/logs';
import { projectsRepo } from '../db/repositories/projects';
import { settingsRepo } from '../db/repositories/settings';
import type { WorkflowRun, StageRun, StageKey, ApprovalOption } from '@/types';
import type { InputRequest } from './types';
import path from 'path';
import fs from 'fs';

export class WorkflowEngine {
  /**
   * Create a new workflow run (status: 'draft') with all stage_runs pre-seeded as 'pending'.
   * Call queueRun() to start execution.
   */
  static createRun(projectId: string, name: string, config?: Record<string, unknown>): WorkflowRun {
    const run = workflowRunsRepo.create({ project_id: projectId, name, config });

    stageRunsRepo.createMany(
      STAGE_DEFINITIONS.map(def => ({
        workflow_run_id: run.id,
        stage_key: def.key,
        stage_index: def.index,
        max_attempts: def.maxAttempts,
      }))
    );

    const projectsDir = settingsRepo.getProjectsDir();
    const project = projectsRepo.findById(projectId);
    const slug = project ? this.slugify(project.name) : projectId;
    const runDir = path.join(projectsDir, slug, run.id);
    fs.mkdirSync(runDir, { recursive: true });

    logsRepo.append({ level: 'info', message: `Workflow run created: ${name}`, workflow_run_id: run.id });
    return run;
  }

  /**
   * Transition a draft run to queued and enqueue the first eligible stage jobs.
   */
  static queueRun(runId: string): void {
    const run = workflowRunsRepo.findById(runId);
    if (!run) throw new Error(`Workflow run not found: ${runId}`);
    if (run.status !== 'draft') throw new Error(`Run must be in draft state to queue (current: ${run.status})`);

    workflowRunsRepo.updateStatus(runId, 'queued');
    this.queueEligibleStages(runId);

    logsRepo.append({ level: 'info', message: 'Workflow run queued', workflow_run_id: runId });
  }

  /**
   * Called by the execution service when the first job is picked up.
   * Transitions the run from 'queued' to 'running'.
   */
  static markRunning(runId: string, currentStage: StageKey): void {
    workflowRunsRepo.updateStatus(runId, 'running', currentStage);
  }

  /**
   * Called by the execution service after a stage succeeds.
   */
  static onStageSuccess(stageRunId: string, output: Record<string, unknown>): void {
    const stageRun = stageRunsRepo.findById(stageRunId);
    if (!stageRun) return;

    workflowRunsRepo.incrementCompletedStages(stageRun.workflow_run_id);

    const stageDef = STAGE_MAP[stageRun.stage_key as StageKey];
    logsRepo.append({
      level: 'info',
      message: `Stage succeeded: ${stageDef.name}`,
      workflow_run_id: stageRun.workflow_run_id,
      stage_run_id: stageRunId,
    });

    this.queueEligibleStages(stageRun.workflow_run_id);
    this.checkCompletion(stageRun.workflow_run_id);
  }

  /**
   * Called by the execution service after a stage fails.
   */
  static onStageFailed(stageRunId: string, error: string): void {
    const stageRun = stageRunsRepo.findById(stageRunId);
    if (!stageRun) return;

    const stageDef = STAGE_MAP[stageRun.stage_key as StageKey];
    logsRepo.append({
      level: 'error',
      message: `Stage failed: ${stageDef.name} — ${error}`,
      workflow_run_id: stageRun.workflow_run_id,
      stage_run_id: stageRunId,
    });

    if (stageRun.attempt < stageRun.max_attempts) {
      workflowRunsRepo.updateStatus(stageRun.workflow_run_id, 'retrying');
    } else {
      workflowRunsRepo.updateStatus(stageRun.workflow_run_id, 'failed');
      logsRepo.append({
        level: 'error',
        message: `Workflow run failed: ${stageDef.name} exhausted all ${stageRun.max_attempts} attempts`,
        workflow_run_id: stageRun.workflow_run_id,
      });
    }
  }

  /**
   * Called by the execution service when a stage returns 'awaiting_input'.
   * Creates an approval record and pauses the run.
   */
  static onStageAwaitingInput(stageRunId: string, inputRequest: InputRequest): void {
    const stageRun = stageRunsRepo.findById(stageRunId);
    if (!stageRun) return;

    workflowRunsRepo.updateStatus(stageRun.workflow_run_id, 'waiting_for_approval');

    const stageDef = STAGE_MAP[stageRun.stage_key as StageKey];
    approvalsRepo.create({
      workflow_run_id: stageRun.workflow_run_id,
      stage_run_id: stageRunId,
      approval_type: inputRequest.type,
      options: inputRequest.options,
    });

    logsRepo.append({
      level: 'info',
      message: `Awaiting human input: ${inputRequest.type}`,
      workflow_run_id: stageRun.workflow_run_id,
      stage_run_id: stageRunId,
    });
  }

  /**
   * Resolve an approval from the UI. Resumes the workflow.
   */
  static resolveApproval(approvalId: string, selectedOption: string, notes?: string): void {
    const approval = approvalsRepo.findById(approvalId);
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);
    if (approval.status !== 'pending') throw new Error(`Approval already resolved`);

    approvalsRepo.resolve(approvalId, 'approved', selectedOption, notes);

    if (approval.stage_run_id) {
      const output: Record<string, unknown> = {
        selected_option: selectedOption,
        notes: notes ?? null,
        resolved_at: Date.now(),
      };
      stageRunsRepo.markSuccess(approval.stage_run_id, output);
      workflowRunsRepo.incrementCompletedStages(approval.workflow_run_id);
    }

    workflowRunsRepo.updateStatus(approval.workflow_run_id, 'running');
    this.queueEligibleStages(approval.workflow_run_id);

    logsRepo.append({
      level: 'info',
      message: `Approval resolved: ${approval.approval_type} → ${selectedOption}`,
      workflow_run_id: approval.workflow_run_id,
      stage_run_id: approval.stage_run_id ?? undefined,
    });
  }

  /**
   * Retry a failed stage. Resets it to pending and re-enqueues.
   */
  static retryStage(stageRunId: string): void {
    const stageRun = stageRunsRepo.findById(stageRunId);
    if (!stageRun) throw new Error(`Stage run not found: ${stageRunId}`);
    if (stageRun.status !== 'failed') throw new Error(`Stage is not in failed state: ${stageRun.status}`);

    stageRunsRepo.resetForRetry(stageRunId);
    workflowRunsRepo.updateStatus(stageRun.workflow_run_id, 'running');
    this.enqueueStageJob(stageRun);

    logsRepo.append({
      level: 'info',
      message: `Stage retry queued: ${stageRun.stage_key}`,
      workflow_run_id: stageRun.workflow_run_id,
      stage_run_id: stageRunId,
    });
  }

  /**
   * Skip a stage (mark as skipped) and advance the workflow.
   */
  static skipStage(stageRunId: string): void {
    const stageRun = stageRunsRepo.findById(stageRunId);
    if (!stageRun) throw new Error(`Stage run not found: ${stageRunId}`);

    stageRunsRepo.markSkipped(stageRunId);
    workflowRunsRepo.incrementCompletedStages(stageRun.workflow_run_id);
    workflowRunsRepo.updateStatus(stageRun.workflow_run_id, 'running');
    this.queueEligibleStages(stageRun.workflow_run_id);
  }

  /**
   * Cancel a workflow run. Cancels pending jobs and marks the run cancelled.
   */
  static cancelRun(runId: string): void {
    jobsRepo.cancelByPayload(runId);
    workflowRunsRepo.updateStatus(runId, 'cancelled');
    logsRepo.append({ level: 'info', message: 'Workflow run cancelled', workflow_run_id: runId });
  }

  // ──────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────

  /**
   * Find all pending stages whose dependencies are satisfied and enqueue them.
   * Approval-gate stages are handled via awaiting_input — they are NOT auto-enqueued
   * but are listed so the engine can report on them. Their runner returns the
   * awaiting_input result which drives the approval flow.
   */
  private static queueEligibleStages(runId: string): void {
    const allStages = stageRunsRepo.findByWorkflowRunId(runId);
    const byKey = Object.fromEntries(allStages.map((s: StageRun) => [s.stage_key, s]));

    for (const def of STAGE_DEFINITIONS) {
      const stageRun = byKey[def.key];
      if (!stageRun || stageRun.status !== 'pending') continue;

      const depsMetStatuses = ['success', 'skipped'] as const;
      const depsComplete = def.dependsOn.every(dep =>
        depsMetStatuses.includes(byKey[dep]?.status as typeof depsMetStatuses[number])
      );
      if (!depsComplete) continue;

      this.enqueueStageJob(stageRun);
    }
  }

  private static enqueueStageJob(stageRun: StageRun): void {
    const run = workflowRunsRepo.findById(stageRun.workflow_run_id);
    if (!run) return;

    jobsRepo.enqueue({
      type: 'STAGE_RUN',
      payload: {
        stage_run_id: stageRun.id,
        workflow_run_id: stageRun.workflow_run_id,
        project_id: run.project_id,
        stage_key: stageRun.stage_key,
      },
      priority: 0,
      run_at: Date.now(),
    });
  }

  private static checkCompletion(runId: string): void {
    const stages = stageRunsRepo.findByWorkflowRunId(runId);
    const allDone = stages.every((s: StageRun) => ['success', 'skipped'].includes(s.status));
    if (allDone) {
      workflowRunsRepo.updateStatus(runId, 'completed');
      logsRepo.append({ level: 'info', message: 'Workflow run completed successfully', workflow_run_id: runId });
    }
  }

  static getRunDir(projectId: string, runId: string): string {
    const projectsDir = settingsRepo.getProjectsDir();
    const project = projectsRepo.findById(projectId);
    const slug = project ? this.slugify(project.name) : projectId;
    return path.join(projectsDir, slug, runId);
  }

  static slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
}

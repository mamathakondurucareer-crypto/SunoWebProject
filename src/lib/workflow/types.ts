/**
 * Workflow engine — internal types.
 *
 * Lives in src/lib/workflow so it is importable from both the Next.js server
 * and the worker process without pulling in browser or Playwright deps.
 */

import type {
  Job,
  WorkflowRun,
  StageRun,
  Project,
  AssetType,
  ApprovalOption,
  StageKey,
} from '@/types';

// ─── Execution Context ────────────────────────────────────────────────────────
// Passed to every IStageRunner. Contains everything a runner needs to do its
// work without reaching into the DB directly.

export interface ExecutionDirs {
  /** Project-level directory: <projects_root>/<project-slug> */
  project: string;
  /** Run-level directory: <project_dir>/<run_id> */
  run: string;
  /** Shared downloads scratch dir */
  downloads: string;
}

export interface ExecutionContext {
  job: Job;
  run: WorkflowRun;
  stage: StageRun;
  project: Project;
  dirs: ExecutionDirs;
  /**
   * Merged outputs from all upstream dependency stages.
   * Keyed by stage key so runners can pull exactly what they need.
   */
  inputs: Partial<Record<StageKey, Record<string, unknown>>>;
  /** Fires when the stage timeout expires or the run is cancelled. */
  signal: AbortSignal;
}

// ─── Artifact Descriptor ──────────────────────────────────────────────────────
// Returned by a runner to register files in the assets table.

export interface ArtifactDescriptor {
  path: string;
  type: AssetType;
  name: string;
  mimeType?: string;
}

// ─── Input Request ────────────────────────────────────────────────────────────
// Returned when a stage requires human input before it can succeed.
// The engine transitions the stage to awaiting_input and the run to
// waiting_for_approval when this is present.

export interface InputRequest {
  /** Discriminates the approval type (e.g. 'winner_selection') */
  type: string;
  options: ApprovalOption[];
  /** Any structured context the UI should display alongside the options */
  context?: Record<string, unknown>;
}

// ─── Stage Run Result ─────────────────────────────────────────────────────────
// The value every IStageRunner returns to the execution service.

export type StageRunResult =
  | { status: 'success'; output: Record<string, unknown>; artifacts?: ArtifactDescriptor[] }
  | { status: 'failed'; error: string; artifacts?: ArtifactDescriptor[] }
  | { status: 'awaiting_input'; output: Record<string, unknown>; inputRequest: InputRequest; artifacts?: ArtifactDescriptor[] };

// ─── Stage Runner Interface ───────────────────────────────────────────────────
// Every adapter (Gemini, ChatGPT, Suno, …) implements this.
// Implementations live in worker/adapters/ which may pull in Playwright.

export interface IStageRunner {
  run(ctx: ExecutionContext): Promise<StageRunResult>;
}

// ─── Stage Runner Registry ────────────────────────────────────────────────────
// Maps stage keys to their runners. Built in worker/index.ts and passed to
// the ExecutionService constructor, which lets tests inject mock runners.

export type StageRunnerRegistry = Map<StageKey, IStageRunner>;

// ─── Workflow Events ──────────────────────────────────────────────────────────
// Structured events emitted by the engine and written to the logs table.

export type WorkflowEventType =
  | 'run.created'
  | 'run.queued'
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'run.waiting_for_approval'
  | 'run.retrying'
  | 'stage.queued'
  | 'stage.started'
  | 'stage.success'
  | 'stage.failed'
  | 'stage.skipped'
  | 'stage.awaiting_input'
  | 'stage.retry_queued'
  | 'approval.requested'
  | 'approval.resolved';

export interface WorkflowEvent {
  type: WorkflowEventType;
  workflowRunId: string;
  stageRunId?: string;
  payload?: Record<string, unknown>;
  timestamp: number;
}

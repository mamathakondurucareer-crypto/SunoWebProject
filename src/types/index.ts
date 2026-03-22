// ─── Status Enums ────────────────────────────────────────────────────────────

export type StageStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'awaiting_input';

export type WorkflowRunStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'waiting_for_approval'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ProjectStatus = 'active' | 'archived';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ScheduleType = 'once' | 'recurring';
export type ScheduleStatus = 'active' | 'paused' | 'completed' | 'cancelled';
export type MissedRunPolicy = 'skip' | 'run_once';
export type AssetType =
  | 'lyrics'
  | 'audio'
  | 'video'
  | 'image'
  | 'document'
  | 'thumbnail'
  | 'package'
  | 'screenshot'
  | 'html_dump'
  | 'scene_plan'
  | 'evaluation';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type ServiceName =
  | 'gemini'
  | 'chatgpt'
  | 'suno'
  | 'grok'
  | 'canva'
  | 'capcut'
  | 'local';

// ─── Stage Keys ──────────────────────────────────────────────────────────────

export type StageKey =
  | 'gemini_generate'
  | 'gemini_capture_parse'
  | 'chatgpt_lyrics_correct'
  | 'suno_generate'
  | 'chatgpt_evaluate_candidate_a'
  | 'chatgpt_evaluate_candidate_b'
  | 'chatgpt_auto_compare'
  | 'compare_candidates'
  | 'build_scene_plan'
  | 'refine_grok_prompts'
  | 'grok_generate_scene_clips'
  | 'canva_prepare_thumbnails'
  | 'capcut_handoff_package'
  | 'final_package';

// ─── Database Models ─────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description: string | null;
  devotional_theme: string;
  target_language: string;
  status: ProjectStatus;
  created_at: number;
  updated_at: number;
}

export interface WorkflowRun {
  id: string;
  project_id: string;
  name: string;
  status: WorkflowRunStatus;
  current_stage: StageKey | null;
  total_stages: number;
  completed_stages: number;
  config: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

export interface StageRun {
  id: string;
  workflow_run_id: string;
  stage_key: StageKey;
  stage_index: number;
  status: StageStatus;
  attempt: number;
  max_attempts: number;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error_message: string | null;
  screenshot_path: string | null;
  html_dump_path: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface Asset {
  id: string;
  workflow_run_id: string | null;
  stage_run_id: string | null;
  project_id: string | null;
  name: string;
  asset_type: AssetType;
  service: ServiceName | null;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  metadata: Record<string, unknown> | null;
  created_at: number;
}

export interface Approval {
  id: string;
  workflow_run_id: string;
  stage_run_id: string | null;
  approval_type: string;
  status: ApprovalStatus;
  options: ApprovalOption[] | null;
  selected_option: string | null;
  notes: string | null;
  requested_at: number;
  resolved_at: number | null;
  created_at: number;
}

export interface ApprovalOption {
  id: string;
  label: string;
  description?: string;
  asset_id?: string;
  metadata?: Record<string, unknown>;
}

export interface Schedule {
  id: string;
  project_id: string | null;
  name: string;
  schedule_type: ScheduleType;
  cron_expression: string | null;
  run_at: number | null;
  workflow_config: Record<string, unknown> | null;
  status: ScheduleStatus;
  last_run_at: number | null;
  next_run_at: number | null;
  run_count: number;
  created_at: number;
  updated_at: number;
  missed_run_policy: MissedRunPolicy;
  timezone: string;
  max_run_count: number | null;
}

export interface BrowserProfile {
  id: string;
  service: ServiceName;
  profile_path: string;
  is_connected: boolean;
  last_login_at: number | null;
  last_used_at: number | null;
  metadata: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
}

export interface Selector {
  id: string;
  service: ServiceName;
  selector_key: string;
  selector_value: string;
  selector_type: 'css' | 'xpath' | 'text';
  description: string | null;
  version: number;
  fallback_value: string | null;
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface AppSetting {
  key: string;
  value: string;
  description: string | null;
  updated_at: number;
}

export interface Log {
  id: string;
  workflow_run_id: string | null;
  stage_run_id: string | null;
  level: LogLevel;
  message: string;
  context: Record<string, unknown> | null;
  created_at: number;
}

export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  attempt: number;
  max_attempts: number;
  run_at: number;
  started_at: number | null;
  completed_at: number | null;
  error: string | null;
  worker_id: string | null;
  created_at: number;
}

// ─── API Response Types ───────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Workflow Definition Types ────────────────────────────────────────────────

export interface StageDefinition {
  key: StageKey;
  name: string;
  description: string;
  service: ServiceName;
  index: number;
  isApprovalGate: boolean;
  maxAttempts: number;
  timeoutMs: number;
  dependsOn: StageKey[];
  approvalType?: string;
}

// ─── Worker Types ─────────────────────────────────────────────────────────────

export interface StageContext {
  stageRun: StageRun;
  workflowRun: WorkflowRun;
  project: Project;
  projectDir: string;
  runDir: string;
  downloadsDir: string;
}

export interface StageResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
  assetPaths?: { path: string; type: AssetType; name: string; mimeType?: string }[];
}

// ─── Dashboard Types ──────────────────────────────────────────────────────────

export interface DashboardStats {
  totalProjects: number;
  activeRuns: number;
  completedRuns: number;
  failedRuns: number;
  pendingApprovals: number;
  scheduledJobs: number;
}

export interface WorkflowRunWithProject extends WorkflowRun {
  project_name: string;
  project_theme: string;
}

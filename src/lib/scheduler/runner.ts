import { schedulesRepo } from '@/lib/db/repositories/schedules';
import { projectsRepo } from '@/lib/db/repositories/projects';
import { logsRepo } from '@/lib/db/repositories/logs';
import { WorkflowEngine } from '@/lib/workflow/engine';
import { computeNextCronDate, computeMissedRuns } from './cron';
import type { Schedule } from '@/types';

/**
 * Process all schedules that are currently due.
 * Called every minute by startScheduler().
 */
export async function processDueSchedules(): Promise<void> {
  const due = schedulesRepo.findDue();

  for (const schedule of due) {
    try {
      // Check for missed runs before firing the schedule
      const hasMissedRun = handleMissedRuns(schedule);

      // Fire the schedule
      await fireSchedule(schedule);
    } catch (err) {
      logsRepo.append({
        level: 'error',
        message: `Scheduler error for ${schedule.id}: ${String(err)}`,
      });
    }
  }
}

/**
 * Fire a single schedule: create a workflow run and enqueue it.
 * Handles post-fire bookkeeping (next_run_at, run_count, completion).
 */
async function fireSchedule(schedule: Schedule): Promise<void> {
  // Validate project exists and is active
  if (schedule.project_id) {
    const project = projectsRepo.findById(schedule.project_id);
    if (!project || project.status !== 'archived') {
      logsRepo.append({
        level: 'warn',
        message: `Skipping schedule ${schedule.id}: project not found or archived`,
      });
      return;
    }
  }

  const config = (schedule.workflow_config ?? {}) as Record<string, unknown>;
  const projectId = schedule.project_id ?? (config.project_id as string);

  if (!projectId) {
    logsRepo.append({
      level: 'warn',
      message: `Skipping schedule ${schedule.id}: no project_id`,
    });
    return;
  }

  const runName = `${schedule.name} — Run ${schedule.run_count + 1}`;
  const run = WorkflowEngine.createRun(projectId, runName, config);
  WorkflowEngine.queueRun(run.id);

  // Compute next run for recurring schedules
  let nextRunAt: number | undefined;
  if (schedule.schedule_type === 'recurring' && schedule.cron_expression) {
    nextRunAt = computeNextCronDate(schedule.cron_expression)?.getTime();
  }

  schedulesRepo.recordRun(schedule.id, nextRunAt);

  // Mark once schedules as completed
  if (schedule.schedule_type === 'once') {
    schedulesRepo.updateStatus(schedule.id, 'completed');
  }

  // Mark recurring as completed if max_run_count reached
  if (schedule.schedule_type === 'recurring' && schedule.max_run_count) {
    if (schedule.run_count + 1 >= schedule.max_run_count) {
      schedulesRepo.updateStatus(schedule.id, 'completed');
    }
  }

  logsRepo.append({
    level: 'info',
    message: `Scheduled run triggered: ${schedule.name}`,
    workflow_run_id: run.id,
  });
}

/**
 * Handle missed runs for a recurring schedule according to its missed_run_policy:
 * - 'skip': just advance next_run_at to future, no run created
 * - 'run_once': fire exactly once for the most recent missed slot
 *
 * Returns true if a run was fired (for logging).
 */
function handleMissedRuns(schedule: Schedule): boolean {
  // Only applies to recurring schedules with last_run_at set
  if (schedule.schedule_type !== 'recurring' || !schedule.last_run_at || !schedule.cron_expression) {
    return false;
  }

  const now = Date.now();
  const missedRuns = computeMissedRuns(
    schedule.cron_expression,
    new Date(schedule.last_run_at),
    new Date(now),
    1, // Only check for 1 missed run
  );

  if (missedRuns.length === 0) {
    return false;
  }

  if (schedule.missed_run_policy === 'skip') {
    // Just advance next_run_at to the future
    const nextRunAt = computeNextCronDate(schedule.cron_expression, new Date(now))?.getTime();
    if (nextRunAt) {
      schedulesRepo.recordRun(schedule.id, nextRunAt);
    }
    return false;
  }

  if (schedule.missed_run_policy === 'run_once') {
    // Fire once for the most recent missed time
    const lastMissedTime = missedRuns[missedRuns.length - 1];

    // Validate project exists and is active
    if (schedule.project_id) {
      const project = projectsRepo.findById(schedule.project_id);
      if (!project || project.status !== 'archived') {
        logsRepo.append({
          level: 'warn',
          message: `Skipping missed run for schedule ${schedule.id}: project not found or archived`,
        });
        return false;
      }
    }

    const config = (schedule.workflow_config ?? {}) as Record<string, unknown>;
    const projectId = schedule.project_id ?? (config.project_id as string);

    if (!projectId) {
      logsRepo.append({
        level: 'warn',
        message: `Skipping missed run for schedule ${schedule.id}: no project_id`,
      });
      return false;
    }

    const runName = `${schedule.name} — Run ${schedule.run_count + 1} (missed)`;
    const run = WorkflowEngine.createRun(projectId, runName, config);
    WorkflowEngine.queueRun(run.id);

    // Update next_run_at to next future time
    const nextRunAt = computeNextCronDate(schedule.cron_expression, new Date(now))?.getTime();
    schedulesRepo.recordRun(schedule.id, nextRunAt);

    logsRepo.append({
      level: 'info',
      message: `Missed run triggered for schedule ${schedule.name}`,
      workflow_run_id: run.id,
    });

    return true;
  }

  return false;
}

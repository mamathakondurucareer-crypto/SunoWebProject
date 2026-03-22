import { schedulesRepo } from '@/lib/db/repositories/schedules';
import { computeNextCronDate } from './cron';
import { CRITICAL_SCHEDULE_RULES, WARN_SCHEDULE_RULES } from './schema';
import type { Schedule, ScheduleStatus } from '@/types';
import type { CreateOnceScheduleInput, CreateRecurringScheduleInput, UpdateScheduleInput } from './schema';

export class SchedulerService {
  /** Create a one-time schedule that fires once at `run_at` (epoch ms). */
  static createOnce(input: CreateOnceScheduleInput): Schedule {
    return schedulesRepo.create({
      project_id: input.project_id,
      name: input.name,
      schedule_type: 'once',
      run_at: input.run_at,
      workflow_config: input.workflow_config,
      missed_run_policy: input.missed_run_policy,
    });
  }

  /** Create a recurring schedule. Computes and stores next_run_at immediately. */
  static createRecurring(input: CreateRecurringScheduleInput): Schedule {
    const nextRunAt = computeNextCronDate(input.cron_expression)?.getTime();
    return schedulesRepo.create({
      project_id: input.project_id,
      name: input.name,
      schedule_type: 'recurring',
      cron_expression: input.cron_expression,
      workflow_config: input.workflow_config,
      next_run_at: nextRunAt,
      missed_run_policy: input.missed_run_policy,
      timezone: input.timezone,
      max_run_count: input.max_run_count,
    });
  }

  /** Update mutable fields on an existing schedule. Re-computes next_run_at if cron changes. */
  static update(id: string, input: UpdateScheduleInput): Schedule {
    const schedule = schedulesRepo.findById(id);
    if (!schedule) throw new Error(`Schedule not found: ${id}`);

    const updateData: {
      name?: string;
      cron_expression?: string;
      workflow_config?: Record<string, unknown>;
      missed_run_policy?: string;
      max_run_count?: number | null;
    } = {};

    if (input.name !== undefined) updateData.name = input.name;
    if (input.cron_expression !== undefined) updateData.cron_expression = input.cron_expression;
    if (input.workflow_config !== undefined) updateData.workflow_config = input.workflow_config;
    if (input.missed_run_policy !== undefined) updateData.missed_run_policy = input.missed_run_policy;
    if (input.max_run_count !== undefined) updateData.max_run_count = input.max_run_count;

    schedulesRepo.update(id, updateData);

    // If cron changed for recurring schedule, re-compute next_run_at
    if (input.cron_expression !== undefined && schedule.schedule_type === 'recurring') {
      const nextRunAt = computeNextCronDate(input.cron_expression)?.getTime();
      if (nextRunAt !== undefined) {
        schedulesRepo.recordRun(id, nextRunAt);
      }
    }

    return schedulesRepo.findById(id)!;
  }

  /** Activate a paused schedule. Re-computes next_run_at for recurring. */
  static enable(id: string): Schedule {
    const schedule = schedulesRepo.findById(id);
    if (!schedule) throw new Error(`Schedule not found: ${id}`);
    if (schedule.status === 'completed' || schedule.status === 'cancelled') {
      throw new Error(`Cannot re-enable a ${schedule.status} schedule`);
    }

    schedulesRepo.updateStatus(id, 'active');

    // For recurring schedules, recompute next_run_at if null or in past
    if (schedule.schedule_type === 'recurring' && schedule.cron_expression) {
      const now = Date.now();
      if (!schedule.next_run_at || schedule.next_run_at < now) {
        const nextRunAt = computeNextCronDate(schedule.cron_expression)?.getTime();
        if (nextRunAt !== undefined) {
          schedulesRepo.recordRun(id, nextRunAt);
        }
      }
    }

    return schedulesRepo.findById(id)!;
  }

  /** Pause an active schedule (preserves next_run_at for resume). */
  static disable(id: string): Schedule {
    const schedule = schedulesRepo.findById(id);
    if (!schedule) throw new Error(`Schedule not found: ${id}`);

    schedulesRepo.updateStatus(id, 'paused');
    return schedulesRepo.findById(id)!;
  }

  /** Cancel a schedule permanently (cannot be re-enabled). */
  static cancel(id: string): Schedule {
    const schedule = schedulesRepo.findById(id);
    if (!schedule) throw new Error(`Schedule not found: ${id}`);

    schedulesRepo.updateStatus(id, 'cancelled');
    return schedulesRepo.findById(id)!;
  }

  /** Delete a schedule record. */
  static delete(id: string): void {
    schedulesRepo.delete(id);
  }

  /** Return the next scheduled fire time for a schedule, or null. */
  static getNextRun(id: string): Date | null {
    const schedule = schedulesRepo.findById(id);
    if (!schedule) return null;

    if (schedule.schedule_type === 'once') {
      if (schedule.run_at && schedule.run_at > Date.now()) {
        return new Date(schedule.run_at);
      }
      return null;
    }

    // Recurring
    if (schedule.next_run_at) {
      return new Date(schedule.next_run_at);
    }

    // Fallback: compute from cron_expression
    if (schedule.cron_expression) {
      return computeNextCronDate(schedule.cron_expression);
    }

    return null;
  }

  /** List schedules, optionally filtered by status. */
  static list(status?: ScheduleStatus): Schedule[] {
    return schedulesRepo.findAll(status);
  }

  /** List schedules for a specific project. */
  static listByProject(projectId: string, status?: ScheduleStatus): Schedule[] {
    return schedulesRepo.findByProject(projectId, status);
  }

  /** Validate a schedule against critical rules. Returns [] if valid, else error strings. */
  static validate(schedule: Schedule): string[] {
    const errors: string[] = [];
    for (const rule of CRITICAL_SCHEDULE_RULES) {
      if (!rule.check(schedule)) {
        errors.push(rule.message(schedule));
      }
    }
    return errors;
  }

  /** Validate a schedule against warn rules. Returns [] if clean, else warning strings. */
  static warnings(schedule: Schedule): string[] {
    const warnings: string[] = [];
    for (const rule of WARN_SCHEDULE_RULES) {
      if (!rule.check(schedule)) {
        warnings.push(rule.message(schedule));
      }
    }
    return warnings;
  }
}

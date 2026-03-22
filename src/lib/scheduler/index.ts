/**
 * Scheduler — entry point.
 *
 * Starts a node-cron task that checks for due schedules every minute.
 * Import { startScheduler, stopScheduler } for the worker.
 * Import { SchedulerService } for API routes / UI code.
 */
import cron from 'node-cron';
import { logsRepo } from '@/lib/db/repositories/logs';
import { processDueSchedules } from './runner';

export { SchedulerService } from './service';
export { validateCronExpression, computeNextCronDate, computeMissedRuns } from './cron';
export { CRITICAL_SCHEDULE_RULES, WARN_SCHEDULE_RULES } from './schema';
export type { CreateOnceScheduleInput, CreateRecurringScheduleInput, UpdateScheduleInput, CriticalScheduleRule, WarnScheduleRule } from './schema';

let schedulerTask: cron.ScheduledTask | null = null;

export function startScheduler(): void {
  if (schedulerTask) return; // already running
  schedulerTask = cron.schedule('* * * * *', async () => {
    try {
      await processDueSchedules();
    } catch (err) {
      logsRepo.append({ level: 'error', message: `Scheduler tick error: ${String(err)}` });
    }
  });
  logsRepo.append({ level: 'info', message: 'Scheduler started — polling every minute' });
}

export function stopScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
  // don't log here — DB may be closed during shutdown
}

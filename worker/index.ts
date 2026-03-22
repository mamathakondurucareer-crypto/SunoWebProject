/**
 * Devotional Workflow Worker
 *
 * A standalone Node.js process that:
 * 1. Polls the SQLite jobs queue every N ms
 * 2. Picks up STAGE_RUN jobs one at a time
 * 3. Executes them via Playwright adapters
 * 4. Updates stage/workflow status in the DB
 * 5. Handles retries and failures gracefully
 * 6. Also runs the cron scheduler for recurring runs
 */

import path from 'path';
import { getDb } from '@/lib/db/client';
import { runMigrations } from '@/lib/db/migrate';
import { jobsRepo } from '@/lib/db/repositories/jobs';
import { logsRepo } from '@/lib/db/repositories/logs';
import { startScheduler, stopScheduler } from '@/lib/scheduler';
import { processJob, closeAllAdapters } from './processor';
import type { Job } from '@/types';

const WORKER_ID = process.env.WORKER_ID ?? `worker-${process.pid}`;
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000);
const MAX_CONCURRENT_JOBS = Number(process.env.WORKER_MAX_CONCURRENT_JOBS ?? 1);

let isRunning = false;
let activeJobs = 0;
let shuttingDown = false;

async function pollAndProcess(): Promise<void> {
  if (shuttingDown) return;
  if (activeJobs >= MAX_CONCURRENT_JOBS) return;

  let job: Job | null = null;

  try {
    job = jobsRepo.dequeue(WORKER_ID);
  } catch (err) {
    logsRepo.append({ level: 'error', message: `Worker dequeue error: ${String(err)}` });
    return;
  }

  if (!job) return;

  activeJobs++;
  logsRepo.append({
    level: 'info',
    message: `Worker picked up job: ${job.id} type=${job.type}`,
    workflow_run_id: (job.payload.workflow_run_id as string) ?? undefined,
  });

  try {
    if (job.type === 'STAGE_RUN') {
      const success = await processJob(job);
      if (success) {
        jobsRepo.markComplete(job.id);
      } else {
        jobsRepo.markFailed(job.id, 'Stage processing failed');
      }
    } else {
      logsRepo.append({ level: 'warn', message: `Unknown job type: ${job.type}` });
      jobsRepo.markFailed(job.id, `Unknown job type: ${job.type}`);
    }
  } catch (err) {
    const errMsg = String(err);
    logsRepo.append({ level: 'error', message: `Worker job exception: ${errMsg}`, workflow_run_id: (job.payload.workflow_run_id as string) ?? undefined });
    jobsRepo.markFailed(job.id, errMsg);
  } finally {
    activeJobs--;
  }
}

function startPolling(): void {
  const loop = async () => {
    if (shuttingDown) return;
    await pollAndProcess().catch(err => {
      logsRepo.append({ level: 'error', message: `Poll loop error: ${String(err)}` });
    });
    if (!shuttingDown) {
      setTimeout(loop, POLL_INTERVAL_MS);
    }
  };

  setTimeout(loop, POLL_INTERVAL_MS);
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('[worker] Shutting down...');
  stopScheduler();

  // Wait for active jobs to finish (max 30s)
  const deadline = Date.now() + 30_000;
  while (activeJobs > 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  await closeAllAdapters();
  getDb().close();
  console.log('[worker] Shutdown complete');
  process.exit(0);
}

async function main(): Promise<void> {
  console.log(`[worker] Starting worker ${WORKER_ID}`);

  // Ensure DB and migrations
  runMigrations();

  // Reclaim any jobs that were stuck as 'running' (worker crashed mid-job)
  const db = getDb();
  const stuck = db.prepare("UPDATE jobs SET status = 'queued', started_at = NULL, worker_id = NULL WHERE status = 'running' AND worker_id = ?").run(WORKER_ID);
  if (stuck.changes > 0) {
    console.log(`[worker] Reclaimed ${stuck.changes} stuck jobs`);
  }

  // Start the cron scheduler
  startScheduler();

  // Start polling
  startPolling();

  isRunning = true;
  console.log(`[worker] Ready. Polling every ${POLL_INTERVAL_MS}ms`);

  logsRepo.append({ level: 'info', message: `Worker started: ${WORKER_ID}` });

  // Prune old jobs daily
  setInterval(() => {
    try {
      jobsRepo.pruneCompleted(7);
      logsRepo.pruneOlderThan(30);
    } catch {
      // ignore
    }
  }, 24 * 60 * 60 * 1000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', (err) => {
  console.error('[worker] Uncaught exception:', err);
  logsRepo.append({ level: 'error', message: `Uncaught exception: ${String(err)}` });
});
process.on('unhandledRejection', (reason) => {
  console.error('[worker] Unhandled rejection:', reason);
  logsRepo.append({ level: 'error', message: `Unhandled rejection: ${String(reason)}` });
});

main().catch(err => {
  console.error('[worker] Fatal startup error:', err);
  process.exit(1);
});

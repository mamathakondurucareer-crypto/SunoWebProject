import { NextResponse } from 'next/server';
import { jobsRepo } from '@/lib/db/repositories/jobs';
import { workflowRunsRepo } from '@/lib/db/repositories/workflow-runs';
import { approvalsRepo } from '@/lib/db/repositories/approvals';
import { schedulesRepo } from '@/lib/db/repositories/schedules';
import { projectsRepo } from '@/lib/db/repositories/projects';

export async function GET() {
  const queued = jobsRepo.findAll('queued').length;
  const running = jobsRepo.findAll('running').length;
  const activeRuns = workflowRunsRepo.countByStatus('running');
  const pausedRuns = workflowRunsRepo.countByStatus('waiting_for_approval');
  const pendingApprovals = approvalsRepo.countPending();
  const activeSchedules = schedulesRepo.countActive();
  const totalProjects = projectsRepo.count();

  return NextResponse.json({
    data: {
      queued_jobs: queued,
      running_jobs: running,
      active_runs: activeRuns,
      paused_runs: pausedRuns,
      pending_approvals: pendingApprovals,
      active_schedules: activeSchedules,
      total_projects: totalProjects,
      completed_runs: workflowRunsRepo.countByStatus('completed'),
      failed_runs: workflowRunsRepo.countByStatus('failed'),
    },
  });
}

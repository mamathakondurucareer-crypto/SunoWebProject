import { NextRequest, NextResponse } from 'next/server';
import { workflowRunsRepo } from '@/lib/db/repositories/workflow-runs';
import { WorkflowEngine } from '@/lib/workflow/engine';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const run = workflowRunsRepo.findById(params.id);
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: run });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const run = workflowRunsRepo.findById(params.id);
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (['running', 'queued', 'waiting_for_approval', 'retrying'].includes(run.status)) {
    WorkflowEngine.cancelRun(params.id);
  }

  workflowRunsRepo.delete(params.id);
  return new NextResponse(null, { status: 204 });
}

import { NextRequest, NextResponse } from 'next/server';
import { stageRunsRepo } from '@/lib/db/repositories/stage-runs';
import { workflowRunsRepo } from '@/lib/db/repositories/workflow-runs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const run = workflowRunsRepo.findById(params.id);
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const stages = stageRunsRepo.findByWorkflowRunId(params.id);
  return NextResponse.json({ data: stages });
}

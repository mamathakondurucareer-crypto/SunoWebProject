import { NextRequest, NextResponse } from 'next/server';
import { workflowRunsRepo } from '@/lib/db/repositories/workflow-runs';
import { WorkflowEngine } from '@/lib/workflow/engine';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const run = workflowRunsRepo.findById(params.id);
    if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (run.status !== 'draft') {
      return NextResponse.json({ error: `Run is not in draft state (current: ${run.status})` }, { status: 400 });
    }
    WorkflowEngine.queueRun(params.id);
    const updated = workflowRunsRepo.findById(params.id);
    return NextResponse.json({ data: updated });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

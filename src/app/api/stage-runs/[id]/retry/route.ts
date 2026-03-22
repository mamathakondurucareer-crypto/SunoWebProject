import { NextRequest, NextResponse } from 'next/server';
import { WorkflowEngine } from '@/lib/workflow/engine';
import { stageRunsRepo } from '@/lib/db/repositories/stage-runs';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const stageRun = stageRunsRepo.findById(params.id);
    if (!stageRun) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (stageRun.status !== 'failed') {
      return NextResponse.json({ error: `Stage is not in failed state (current: ${stageRun.status})` }, { status: 400 });
    }

    if (stageRun.attempt >= stageRun.max_attempts) {
      return NextResponse.json({ error: `Max attempts (${stageRun.max_attempts}) reached. Reset max_attempts first.` }, { status: 400 });
    }

    WorkflowEngine.retryStage(params.id);
    const updated = stageRunsRepo.findById(params.id);
    return NextResponse.json({ data: updated });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

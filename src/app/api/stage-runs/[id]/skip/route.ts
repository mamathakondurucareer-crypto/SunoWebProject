import { NextRequest, NextResponse } from 'next/server';
import { WorkflowEngine } from '@/lib/workflow/engine';
import { stageRunsRepo } from '@/lib/db/repositories/stage-runs';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const stageRun = stageRunsRepo.findById(params.id);
    if (!stageRun) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    WorkflowEngine.skipStage(params.id);
    const updated = stageRunsRepo.findById(params.id);
    return NextResponse.json({ data: updated });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

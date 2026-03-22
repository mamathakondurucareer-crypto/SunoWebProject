import { NextRequest, NextResponse } from 'next/server';
import { logsRepo } from '@/lib/db/repositories/logs';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const workflow_run_id = searchParams.get('workflow_run_id');
  const stage_run_id = searchParams.get('stage_run_id');
  const limit = Number(searchParams.get('limit') ?? 200);

  if (workflow_run_id) {
    return NextResponse.json({ data: logsRepo.findByWorkflowRun(workflow_run_id, limit) });
  }
  if (stage_run_id) {
    return NextResponse.json({ data: logsRepo.findByStageRun(stage_run_id) });
  }
  return NextResponse.json({ data: logsRepo.findRecent(limit) });
}

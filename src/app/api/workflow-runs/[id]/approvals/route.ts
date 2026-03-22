import { NextRequest, NextResponse } from 'next/server';
import { approvalsRepo } from '@/lib/db/repositories/approvals';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const approvals = approvalsRepo.findByWorkflowRun(params.id);
  return NextResponse.json({ data: approvals });
}

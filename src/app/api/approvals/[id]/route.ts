import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { approvalsRepo } from '@/lib/db/repositories/approvals';
import { WorkflowEngine } from '@/lib/workflow/engine';

const ResolveSchema = z.object({
  selected_option: z.string().min(1),
  notes: z.string().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const approval = approvalsRepo.findById(params.id);
  if (!approval) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: approval });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const parsed = ResolveSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const approval = approvalsRepo.findById(params.id);
    if (!approval) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (approval.status !== 'pending') {
      return NextResponse.json({ error: 'Approval already resolved' }, { status: 400 });
    }

    WorkflowEngine.resolveApproval(params.id, parsed.data.selected_option, parsed.data.notes);
    const updated = approvalsRepo.findById(params.id);
    return NextResponse.json({ data: updated });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

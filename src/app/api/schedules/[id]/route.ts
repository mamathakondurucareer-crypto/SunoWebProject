import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { schedulesRepo } from '@/lib/db/repositories/schedules';

const UpdateSchema = z.object({
  status: z.enum(['active', 'paused', 'cancelled']).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const s = schedulesRepo.findById(params.id);
  if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: s });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    if (parsed.data.status) schedulesRepo.updateStatus(params.id, parsed.data.status);
    return NextResponse.json({ data: schedulesRepo.findById(params.id) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  schedulesRepo.delete(params.id);
  return new NextResponse(null, { status: 204 });
}

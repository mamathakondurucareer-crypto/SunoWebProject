import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { browserProfilesRepo } from '@/lib/db/repositories/browser-profiles';

const UpdateSchema = z.object({
  is_connected: z.boolean().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = browserProfilesRepo.findById(params.id);
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: profile });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    if (parsed.data.is_connected !== undefined) {
      browserProfilesRepo.markConnected(params.id, parsed.data.is_connected);
    }
    return NextResponse.json({ data: browserProfilesRepo.findById(params.id) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

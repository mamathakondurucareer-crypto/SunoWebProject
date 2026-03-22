import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { projectsRepo } from '@/lib/db/repositories/projects';

const UpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  devotional_theme: z.string().min(1).max(500).optional(),
  target_language: z.string().optional(),
  status: z.enum(['active', 'archived']).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const project = projectsRepo.findById(params.id);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: project });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const project = projectsRepo.update(params.id, parsed.data);
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: project });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const project = projectsRepo.findById(params.id);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  projectsRepo.delete(params.id);
  return new NextResponse(null, { status: 204 });
}

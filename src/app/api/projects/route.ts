import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runMigrations } from '@/lib/db/migrate';
import { projectsRepo } from '@/lib/db/repositories/projects';

runMigrations();

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  devotional_theme: z.string().min(1).max(500),
  target_language: z.string().default('English'),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const status = searchParams.get('status') as 'active' | 'archived' | undefined;
    const projects = projectsRepo.findAll(status);
    return NextResponse.json({ data: projects });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateProjectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const project = projectsRepo.create(parsed.data);
    return NextResponse.json({ data: project }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

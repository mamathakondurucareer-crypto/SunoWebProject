import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { workflowRunsRepo } from '@/lib/db/repositories/workflow-runs';
import { projectsRepo } from '@/lib/db/repositories/projects';
import { WorkflowEngine } from '@/lib/workflow/engine';

const CreateRunSchema = z.object({
  name: z.string().min(1).max(200),
  config: z.record(z.unknown()).optional(),
  start_immediately: z.boolean().default(false),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const runs = workflowRunsRepo.findAll(params.id);
  return NextResponse.json({ data: runs });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const project = projectsRepo.findById(params.id);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const body = await req.json();
    const parsed = CreateRunSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const run = WorkflowEngine.createRun(params.id, parsed.data.name, parsed.data.config);

    if (parsed.data.start_immediately) {
      WorkflowEngine.queueRun(run.id);
    }

    return NextResponse.json({ data: run }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

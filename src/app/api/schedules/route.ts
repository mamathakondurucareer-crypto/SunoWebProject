import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { schedulesRepo } from '@/lib/db/repositories/schedules';

const CreateScheduleSchema = z.object({
  name: z.string().min(1).max(200),
  project_id: z.string().optional(),
  schedule_type: z.enum(['once', 'recurring']),
  cron_expression: z.string().optional(),
  run_at: z.number().optional(),
  workflow_config: z.record(z.unknown()).optional(),
});

export async function GET(_req: NextRequest) {
  const schedules = schedulesRepo.findAll();
  return NextResponse.json({ data: schedules });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateScheduleSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const { schedule_type, cron_expression, run_at } = parsed.data;
    if (schedule_type === 'once' && !run_at) {
      return NextResponse.json({ error: 'run_at is required for one-time schedules' }, { status: 400 });
    }
    if (schedule_type === 'recurring' && !cron_expression) {
      return NextResponse.json({ error: 'cron_expression is required for recurring schedules' }, { status: 400 });
    }

    const schedule = schedulesRepo.create({
      ...parsed.data,
      next_run_at: schedule_type === 'once' ? run_at : Date.now() + 60_000,
    });
    return NextResponse.json({ data: schedule }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

import { z } from 'zod';
import type { Schedule } from '@/types';
import { validateCronExpression } from './cron';

// Input schemas
export const CreateOnceScheduleSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  run_at: z.number().int().positive(),  // epoch ms
  workflow_config: z.record(z.unknown()).optional(),
  missed_run_policy: z.enum(['skip', 'run_once']).default('skip'),
});

export const CreateRecurringScheduleSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  cron_expression: z.string().refine(validateCronExpression, { message: 'Invalid cron expression (5 fields required)' }),
  workflow_config: z.record(z.unknown()).optional(),
  missed_run_policy: z.enum(['skip', 'run_once']).default('skip'),
  timezone: z.string().default('UTC'),
  max_run_count: z.number().int().positive().optional(),
});

export const UpdateScheduleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  cron_expression: z.string().refine(validateCronExpression, { message: 'Invalid cron expression' }).optional(),
  workflow_config: z.record(z.unknown()).optional(),
  missed_run_policy: z.enum(['skip', 'run_once']).optional(),
  max_run_count: z.number().int().positive().nullable().optional(),
});

// Inferred types
export type CreateOnceScheduleInput = z.infer<typeof CreateOnceScheduleSchema>;
export type CreateRecurringScheduleInput = z.infer<typeof CreateRecurringScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleSchema>;

// Validation rule interfaces
export interface CriticalScheduleRule { field: string; check: (s: Schedule) => boolean; message: (s: Schedule) => string; }
export interface WarnScheduleRule { field: string; check: (s: Schedule) => boolean; message: (s: Schedule) => string; }

export const CRITICAL_SCHEDULE_RULES: CriticalScheduleRule[] = [
  { field: 'has_project', check: (s) => s.project_id !== null, message: () => 'Schedule has no project_id — cannot create workflow run' },
  { field: 'recurring_has_cron', check: (s) => s.schedule_type !== 'recurring' || (s.cron_expression !== null && s.cron_expression.length > 0), message: () => 'Recurring schedule is missing cron_expression' },
  { field: 'once_has_run_at', check: (s) => s.schedule_type !== 'once' || s.run_at !== null, message: () => 'One-time schedule is missing run_at timestamp' },
];

export const WARN_SCHEDULE_RULES: WarnScheduleRule[] = [
  { field: 'not_past_due', check: (s) => s.schedule_type !== 'once' || (s.run_at ?? 0) > Date.now(), message: (s) => `One-time schedule run_at is in the past: ${new Date(s.run_at ?? 0).toISOString()}` },
  { field: 'has_next_run', check: (s) => s.schedule_type !== 'recurring' || s.next_run_at !== null, message: () => 'Recurring schedule has no next_run_at — will not trigger until computed' },
  { field: 'active_status', check: (s) => s.status === 'active', message: (s) => `Schedule is not active (status: ${s.status})` },
];

import * as React from 'react';
import { cn, getStatusBg } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: string;
}

export function Badge({ className, status, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
        status ? getStatusBg(status) : 'bg-primary/20 text-primary',
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    // stage statuses
    pending: 'Pending',
    running: 'Running',
    success: 'Success',
    failed: 'Failed',
    skipped: 'Skipped',
    awaiting_input: 'Needs Input',
    // run statuses
    draft: 'Draft',
    queued: 'Queued',
    waiting_for_approval: 'Awaiting Approval',
    retrying: 'Retrying',
    completed: 'Completed',
    cancelled: 'Cancelled',
    // project / schedule statuses
    active: 'Active',
    paused: 'Paused',
    archived: 'Archived',
    // schedule types
    once: 'One-time',
    recurring: 'Recurring',
  };

  return <Badge status={status}>{labels[status] ?? status}</Badge>;
}

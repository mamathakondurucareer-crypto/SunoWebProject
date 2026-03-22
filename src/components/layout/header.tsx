'use client';

import { Bell } from 'lucide-react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function Header({ title }: { title?: string }) {
  const { data } = useSWR('/api/worker/status', fetcher, { refreshInterval: 5000 });
  const stats = data?.data;
  const pendingApprovals = stats?.pending_approvals ?? 0;

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6">
      <h1 className="text-sm font-semibold text-foreground">{title ?? 'Devotional Workflow'}</h1>

      <div className="flex items-center gap-4">
        {/* Worker status */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`inline-block h-2 w-2 rounded-full ${(stats?.running_jobs ?? 0) > 0 ? 'bg-yellow-400 animate-pulse' : 'bg-zinc-600'}`} />
          <span>{(stats?.running_jobs ?? 0) > 0 ? `${stats.running_jobs} running` : 'Worker idle'}</span>
          {(stats?.queued_jobs ?? 0) > 0 && (
            <span className="text-blue-400">{stats.queued_jobs} queued</span>
          )}
        </div>

        {/* Approvals bell */}
        <button className="relative p-2 rounded-md hover:bg-accent transition-colors">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {pendingApprovals > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
              {pendingApprovals}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}

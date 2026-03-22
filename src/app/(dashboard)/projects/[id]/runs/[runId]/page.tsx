'use client';

import { useParams } from 'next/navigation';
import useSWR from 'swr';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { StageTimeline } from '@/components/workflow/stage-timeline';
import { formatDate, formatRelative } from '@/lib/utils';
import { ArrowLeft, Play, XCircle, RefreshCw } from 'lucide-react';
import type { WorkflowRun, StageRun, Approval, Asset, Log } from '@/types';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function RunDetailPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();

  const { data: runData, mutate: mutateRun } = useSWR(`/api/workflow-runs/${runId}`, fetcher, { refreshInterval: 3000 });
  const { data: stagesData, mutate: mutateStages } = useSWR(`/api/workflow-runs/${runId}/stages`, fetcher, { refreshInterval: 3000 });
  const { data: assetsData } = useSWR(`/api/assets?workflow_run_id=${runId}`, fetcher, { refreshInterval: 5000 });
  const { data: logsData } = useSWR(`/api/logs?workflow_run_id=${runId}&limit=100`, fetcher, { refreshInterval: 3000 });

  const run: WorkflowRun | undefined = runData?.data;
  const stages: StageRun[] = stagesData?.data ?? [];
  const assets: Asset[] = assetsData?.data ?? [];
  const logs: Log[] = logsData?.data ?? [];

  const { data: approvalsData, mutate: mutateApprovals } = useSWR(`/api/workflow-runs/${runId}/approvals`, fetcher, { refreshInterval: 3000 });
  const approvals: Approval[] = approvalsData ?? [];

  const handleStart = async () => {
    await fetch(`/api/workflow-runs/${runId}/start`, { method: 'POST' });
    mutateRun();
  };

  const handleCancel = async () => {
    if (!confirm('Cancel this workflow run?')) return;
    await fetch(`/api/workflow-runs/${runId}`, { method: 'DELETE' });
    window.location.href = `/projects/${id}`;
  };

  const handleRetry = async (stageRunId: string) => {
    await fetch(`/api/stage-runs/${stageRunId}/retry`, { method: 'POST' });
    mutateStages();
    mutateRun();
  };

  const handleSkip = async (stageRunId: string) => {
    if (!confirm('Skip this stage?')) return;
    await fetch(`/api/stage-runs/${stageRunId}/skip`, { method: 'POST' });
    mutateStages();
    mutateRun();
  };

  const handleApprove = async (approvalId: string, selectedOption: string, notes?: string) => {
    await fetch(`/api/approvals/${approvalId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected_option: selectedOption, notes }),
    });
    mutateStages();
    mutateRun();
    mutateApprovals();
  };

  if (!run) return <div className="text-muted-foreground p-4">Loading...</div>;

  const progress = Math.round((run.completed_stages / run.total_stages) * 100);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href={`/projects/${id}`}>
          <Button variant="ghost" size="icon" className="mt-1">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold">{run.name}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">{formatRelative(run.created_at)}</p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={run.status} />
              {run.status === 'draft' && (
                <Button size="sm" onClick={handleStart}>
                  <Play className="h-3 w-3 mr-1" />
                  Start
                </Button>
              )}
              {['running', 'waiting_for_approval', 'queued', 'retrying', 'draft'].includes(run.status) && (
                <Button size="sm" variant="destructive" onClick={handleCancel}>
                  <XCircle className="h-3 w-3 mr-1" />
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2 text-sm">
            <span className="font-medium">{run.completed_stages} / {run.total_stages} stages</span>
            <span className="text-muted-foreground">{progress}%</span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          {run.current_stage && (
            <p className="text-xs text-muted-foreground mt-2">
              Current: {run.current_stage.replace(/_/g, ' ')}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stage timeline */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-base font-semibold">Pipeline Stages</h2>
          <StageTimeline
            stages={stages}
            approvals={approvals}
            onRetry={handleRetry}
            onSkip={handleSkip}
            onApprove={handleApprove}
          />
        </div>

        {/* Sidebar: assets + logs */}
        <div className="space-y-4">
          {/* Assets */}
          {assets.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Assets ({assets.length})</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="space-y-2">
                  {assets.slice(0, 10).map(asset => (
                    <div key={asset.id} className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground capitalize">{asset.asset_type}</span>
                      <span className="flex-1 truncate text-foreground" title={asset.name}>{asset.name}</span>
                    </div>
                  ))}
                  {assets.length > 10 && (
                    <Link href={`/assets?workflow_run_id=${runId}`} className="text-xs text-primary hover:underline">
                      +{assets.length - 10} more
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Logs */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Activity Log</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {logs.length === 0 && (
                  <p className="text-xs text-muted-foreground">No logs yet</p>
                )}
                {[...logs].reverse().map(log => (
                  <div key={log.id} className="text-xs">
                    <span className={`font-mono ${
                      log.level === 'error' ? 'text-red-400' :
                      log.level === 'warn' ? 'text-yellow-400' :
                      log.level === 'info' ? 'text-blue-400' : 'text-zinc-500'
                    }`}>
                      [{log.level.toUpperCase()}]
                    </span>
                    <span className="ml-2 text-zinc-300">{log.message}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}


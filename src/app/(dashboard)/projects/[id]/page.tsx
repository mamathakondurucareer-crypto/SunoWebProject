'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate, formatRelative } from '@/lib/utils';
import { ArrowLeft, Plus, Play, Trash2 } from 'lucide-react';
import type { Project, WorkflowRun } from '@/types';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [showNewRun, setShowNewRun] = useState(false);
  const [runName, setRunName] = useState('');
  const [startNow, setStartNow] = useState(true);
  const [creating, setCreating] = useState(false);

  const { data: projectData } = useSWR(`/api/projects/${id}`, fetcher);
  const { data: runsData, mutate: mutateRuns } = useSWR(`/api/projects/${id}/runs`, fetcher, { refreshInterval: 5000 });

  const project: Project | undefined = projectData?.data;
  const runs: WorkflowRun[] = runsData?.data ?? [];

  const handleCreateRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch(`/api/projects/${id}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: runName || `Run ${new Date().toLocaleDateString()}`, start_immediately: startNow }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error));
      setShowNewRun(false);
      setRunName('');
      mutateRuns();
      if (startNow) router.push(`/projects/${id}/runs/${data.data.id}`);
    } catch (err) {
      alert(String(err));
    } finally {
      setCreating(false);
    }
  };

  if (!project) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  const activeRuns = runs.filter(r => ['running', 'paused'].includes(r.status));
  const completedRuns = runs.filter(r => r.status === 'completed');
  const failedRuns = runs.filter(r => r.status === 'failed');

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start gap-3">
        <Link href="/projects">
          <Button variant="ghost" size="icon" className="mt-1">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">{project.name}</h1>
              {project.description && <p className="text-muted-foreground mt-1">{project.description}</p>}
            </div>
            <StatusBadge status={project.status} />
          </div>
        </div>
      </div>

      {/* Project info */}
      <Card>
        <CardContent className="p-5">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Theme</p>
              <p className="text-foreground">{project.devotional_theme}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Language</p>
              <p>{project.target_language}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Created</p>
              <p>{formatDate(project.created_at)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Runs</p>
              <p>{activeRuns.length} active · {completedRuns.length} completed · {failedRuns.length} failed</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Workflow Runs */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Workflow Runs</h2>
          <Button onClick={() => setShowNewRun(true)}>
            <Plus className="h-4 w-4" />
            New Run
          </Button>
        </div>

        {runs.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center">
              <Play className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground mb-4">No workflow runs yet. Start the 13-stage production pipeline.</p>
              <Button onClick={() => setShowNewRun(true)}>
                <Plus className="h-4 w-4" />
                Start First Run
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {runs.map(run => (
              <Link key={run.id} href={`/projects/${id}/runs/${run.id}`}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <p className="font-medium truncate">{run.name}</p>
                          <StatusBadge status={run.status} />
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>Stage {run.completed_stages}/{run.total_stages}</span>
                          {run.current_stage && <span>→ {run.current_stage.replace(/_/g, ' ')}</span>}
                          <span>{formatRelative(run.created_at)}</span>
                        </div>
                      </div>
                      {/* Progress bar */}
                      <div className="w-24 hidden sm:block">
                        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${(run.completed_stages / run.total_stages) * 100}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground text-right mt-1">
                          {Math.round((run.completed_stages / run.total_stages) * 100)}%
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* New Run Dialog */}
      <Dialog open={showNewRun} onClose={() => setShowNewRun(false)} title="New Workflow Run">
        <form onSubmit={handleCreateRun} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="run-name">Run Name</Label>
            <Input
              id="run-name"
              value={runName}
              onChange={e => setRunName(e.target.value)}
              placeholder={`Run ${new Date().toLocaleDateString()}`}
            />
          </div>
          <div className="flex items-center gap-3">
            <input
              id="start-now"
              type="checkbox"
              checked={startNow}
              onChange={e => setStartNow(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="start-now" className="cursor-pointer">Start immediately</Label>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="submit" loading={creating}>Create Run</Button>
            <Button type="button" variant="outline" onClick={() => setShowNewRun(false)}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

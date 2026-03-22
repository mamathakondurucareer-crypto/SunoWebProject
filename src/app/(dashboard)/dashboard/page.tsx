'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatRelative } from '@/lib/utils';
import {
  FolderKanban, PlayCircle, CheckCircle2, XCircle,
  Clock, AlertTriangle, Plus, ArrowRight
} from 'lucide-react';

const fetcher = (url: string) => fetch(url).then(r => r.json());

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: number | string; color: string }) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center gap-4">
          <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${color}`}>
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data: statsData } = useSWR('/api/worker/status', fetcher, { refreshInterval: 5000 });
  const { data: projectsData } = useSWR('/api/projects', fetcher, { refreshInterval: 10000 });

  const stats = statsData?.data ?? {};
  const projects = projectsData?.data ?? [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Devotional Music-Video Workflow Orchestrator</p>
        </div>
        <Link href="/projects/new">
          <Button>
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </Link>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard icon={FolderKanban} label="Projects" value={stats.total_projects ?? 0} color="bg-blue-900/30 text-blue-400" />
        <StatCard icon={PlayCircle} label="Active Runs" value={stats.active_runs ?? 0} color="bg-yellow-900/30 text-yellow-400" />
        <StatCard icon={CheckCircle2} label="Completed" value={stats.completed_runs ?? 0} color="bg-green-900/30 text-green-400" />
        <StatCard icon={XCircle} label="Failed" value={stats.failed_runs ?? 0} color="bg-red-900/30 text-red-400" />
        <StatCard icon={AlertTriangle} label="Approvals" value={stats.pending_approvals ?? 0} color="bg-orange-900/30 text-orange-400" />
        <StatCard icon={Clock} label="Scheduled" value={stats.active_schedules ?? 0} color="bg-purple-900/30 text-purple-400" />
      </div>

      {/* Worker status bar */}
      {(stats.queued_jobs > 0 || stats.running_jobs > 0) && (
        <Card className="border-yellow-900/50 bg-yellow-950/20">
          <CardContent className="p-4 flex items-center gap-3">
            <span className="inline-block h-3 w-3 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-sm text-yellow-300">
              Worker active: {stats.running_jobs ?? 0} running job{stats.running_jobs !== 1 ? 's' : ''}, {stats.queued_jobs ?? 0} queued
            </span>
          </CardContent>
        </Card>
      )}

      {/* Pending approvals alert */}
      {(stats.pending_approvals ?? 0) > 0 && (
        <Card className="border-orange-900/50 bg-orange-950/20">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-400" />
              <span className="text-sm text-orange-300">
                {stats.pending_approvals} workflow{stats.pending_approvals > 1 ? 's' : ''} waiting for approval
              </span>
            </div>
            <Link href="/projects">
              <Button variant="outline" size="sm" className="border-orange-800 text-orange-300 hover:bg-orange-900/30">
                Review <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Projects list */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Projects</h2>
          <Link href="/projects" className="text-sm text-primary hover:underline flex items-center gap-1">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {projects.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <FolderKanban className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">No projects yet. Create your first devotional project.</p>
              <Link href="/projects/new">
                <Button>
                  <Plus className="h-4 w-4" />
                  Create Project
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {projects.slice(0, 6).map((project: { id: string; name: string; devotional_theme: string; status: string; created_at: number }) => (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-tight">{project.name}</CardTitle>
                      <StatusBadge status={project.status} />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-2">{project.devotional_theme}</p>
                    <p className="text-xs text-muted-foreground mt-2">{formatRelative(project.created_at)}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

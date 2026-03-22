'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { formatDate } from '@/lib/utils';
import { Plus, Pause, Play, Trash2, Calendar } from 'lucide-react';
import type { Schedule, Project } from '@/types';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function SchedulerPage() {
  const { data: schedulesData, mutate } = useSWR('/api/schedules', fetcher, { refreshInterval: 10000 });
  const { data: projectsData } = useSWR('/api/projects', fetcher);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    project_id: '',
    schedule_type: 'once' as 'once' | 'recurring',
    cron_expression: '',
    run_at: '',
  });
  const [creating, setCreating] = useState(false);

  const schedules: Schedule[] = schedulesData?.data ?? [];
  const projects: Project[] = projectsData?.data ?? [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        project_id: form.project_id || undefined,
        schedule_type: form.schedule_type,
      };
      if (form.schedule_type === 'once' && form.run_at) {
        body.run_at = new Date(form.run_at).getTime();
      }
      if (form.schedule_type === 'recurring' && form.cron_expression) {
        body.cron_expression = form.cron_expression;
      }
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setShowCreate(false);
      setForm({ name: '', project_id: '', schedule_type: 'once', cron_expression: '', run_at: '' });
      mutate();
    } catch (err) {
      alert(String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = async (schedule: Schedule) => {
    const newStatus = schedule.status === 'active' ? 'paused' : 'active';
    await fetch(`/api/schedules/${schedule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    mutate();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this schedule?')) return;
    await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
    mutate();
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Scheduler</h1>
          <p className="text-muted-foreground mt-1">Automate workflow runs on a schedule</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" />
          New Schedule
        </Button>
      </div>

      {schedules.length === 0 ? (
        <Card>
          <CardContent className="p-16 text-center">
            <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground mb-4">No schedules configured.</p>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />
              Create Schedule
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {schedules.map(schedule => {
            const project = projects.find(p => p.id === schedule.project_id);
            return (
              <Card key={schedule.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium">{schedule.name}</p>
                        <StatusBadge status={schedule.status} />
                        <StatusBadge status={schedule.schedule_type} />
                      </div>
                      {project && (
                        <p className="text-sm text-muted-foreground">Project: {project.name}</p>
                      )}
                      <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                        {schedule.cron_expression && <span>Cron: {schedule.cron_expression}</span>}
                        {schedule.run_at && <span>Run at: {formatDate(schedule.run_at)}</span>}
                        {schedule.next_run_at && <span>Next: {formatDate(schedule.next_run_at)}</span>}
                        <span>Runs: {schedule.run_count}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleToggleStatus(schedule)}
                        title={schedule.status === 'active' ? 'Pause' : 'Resume'}
                      >
                        {schedule.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-400 hover:text-red-300"
                        onClick={() => handleDelete(schedule.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={showCreate} onClose={() => setShowCreate(false)} title="New Schedule">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Weekly Sunday production" required />
          </div>
          <div className="space-y-2">
            <Label>Project (optional)</Label>
            <select
              value={form.project_id}
              onChange={e => setForm({ ...form, project_id: e.target.value })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">— None —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <div className="flex gap-3">
              {(['once', 'recurring'] as const).map(t => (
                <label key={t} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" value={t} checked={form.schedule_type === t} onChange={() => setForm({ ...form, schedule_type: t })} />
                  <span className="text-sm capitalize">{t}</span>
                </label>
              ))}
            </div>
          </div>
          {form.schedule_type === 'once' && (
            <div className="space-y-2">
              <Label>Run At</Label>
              <Input type="datetime-local" value={form.run_at} onChange={e => setForm({ ...form, run_at: e.target.value })} required />
            </div>
          )}
          {form.schedule_type === 'recurring' && (
            <div className="space-y-2">
              <Label>Cron Expression</Label>
              <Input value={form.cron_expression} onChange={e => setForm({ ...form, cron_expression: e.target.value })} placeholder="0 9 * * 0  (every Sunday at 9am)" required />
              <p className="text-xs text-muted-foreground">Format: minute hour day-of-month month day-of-week</p>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <Button type="submit" loading={creating}>Create</Button>
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

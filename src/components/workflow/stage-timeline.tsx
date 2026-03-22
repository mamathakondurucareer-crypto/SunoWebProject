'use client';

import { cn, formatDate, formatDuration } from '@/lib/utils';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { STAGE_DEFINITIONS } from '@/lib/workflow/definition';
import type { StageRun, Approval } from '@/types';
import {
  CheckCircle2, XCircle, Clock, Loader2, AlertTriangle, SkipForward,
  RefreshCw, ChevronDown, ChevronUp, File
} from 'lucide-react';
import { useState } from 'react';

interface StageTimelineProps {
  stages: StageRun[];
  approvals: Approval[];
  onRetry: (stageRunId: string) => void;
  onSkip: (stageRunId: string) => void;
  onApprove: (approvalId: string, selectedOption: string, notes?: string) => void;
}

const SERVICE_COLORS: Record<string, string> = {
  gemini: 'text-blue-400',
  chatgpt: 'text-green-400',
  suno: 'text-pink-400',
  grok: 'text-cyan-400',
  canva: 'text-teal-400',
  capcut: 'text-orange-400',
  local: 'text-zinc-400',
};

function StageIcon({ status }: { status: string }) {
  switch (status) {
    case 'success': return <CheckCircle2 className="h-5 w-5 text-green-400" />;
    case 'failed': return <XCircle className="h-5 w-5 text-red-400" />;
    case 'running': return <Loader2 className="h-5 w-5 text-yellow-400 animate-spin" />;
    case 'pending': return <Clock className="h-5 w-5 text-blue-400" />;
    case 'awaiting_input': return <AlertTriangle className="h-5 w-5 text-orange-400" />;
    case 'skipped': return <SkipForward className="h-5 w-5 text-zinc-500" />;
    default: return <Clock className="h-5 w-5 text-zinc-600" />;
  }
}

function ApprovalGate({
  approval,
  onApprove,
}: {
  approval: Approval;
  onApprove: (id: string, option: string, notes?: string) => void;
}) {
  const [selected, setSelected] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (approval.status !== 'pending') {
    return (
      <div className="ml-8 mt-2 p-3 rounded-lg bg-green-950/20 border border-green-900/30 text-sm">
        <span className="text-green-400">✓ Approved: {approval.selected_option}</span>
        {approval.notes && <span className="text-muted-foreground ml-2">— {approval.notes}</span>}
      </div>
    );
  }

  const options = approval.options ?? [];

  return (
    <div className="ml-8 mt-3 p-4 rounded-lg bg-orange-950/20 border border-orange-900/40 space-y-3">
      <p className="text-sm font-medium text-orange-300">⚠ Approval Required: {approval.approval_type.replace(/_/g, ' ')}</p>
      <div className="space-y-2">
        {options.map((opt) => (
          <label key={opt.id} className="flex items-start gap-3 p-3 rounded-lg bg-card border border-border hover:border-primary/50 cursor-pointer transition-colors">
            <input
              type="radio"
              name={`approval-${approval.id}`}
              value={opt.id}
              checked={selected === opt.id}
              onChange={() => setSelected(opt.id)}
              className="mt-0.5"
            />
            <div>
              <p className="text-sm font-medium">{opt.label}</p>
              {opt.description && <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>}
            </div>
          </label>
        ))}
      </div>
      <input
        type="text"
        placeholder="Optional notes..."
        value={notes}
        onChange={e => setNotes(e.target.value)}
        className="w-full text-sm bg-background border border-input rounded-md px-3 py-2 placeholder:text-muted-foreground"
      />
      <Button
        size="sm"
        disabled={!selected || submitting}
        loading={submitting}
        onClick={async () => {
          setSubmitting(true);
          await onApprove(approval.id, selected, notes);
          setSubmitting(false);
        }}
      >
        Approve Selection
      </Button>
    </div>
  );
}

export function StageTimeline({ stages, approvals, onRetry, onSkip, onApprove }: StageTimelineProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const stageMap = Object.fromEntries(stages.map(s => [s.stage_key, s]));

  return (
    <div className="space-y-1">
      {STAGE_DEFINITIONS.map((def, i) => {
        const stage = stageMap[def.key];
        if (!stage) return null;

        const isExpanded = expanded.has(stage.id);
        const approval = approvals.find(a => a.stage_run_id === stage.id || a.approval_type === def.approvalType);
        const duration = stage.started_at && stage.completed_at
          ? formatDuration(stage.completed_at - stage.started_at)
          : null;

        return (
          <div key={def.key}>
            {/* Connector line */}
            {i > 0 && (
              <div className="ml-[14px] h-3 w-px bg-border" />
            )}

            <div className={cn(
              'rounded-lg border transition-colors',
              stage.status === 'running' ? 'border-yellow-900/50 bg-yellow-950/5' :
              stage.status === 'success' ? 'border-green-900/30 bg-green-950/5' :
              stage.status === 'failed' ? 'border-red-900/50 bg-red-950/5' :
              stage.status === 'awaiting_input' ? 'border-orange-900/50 bg-orange-950/5' :
              'border-border bg-card'
            )}>
              <div
                className="flex items-center gap-3 p-3 cursor-pointer select-none"
                onClick={() => toggleExpand(stage.id)}
              >
                <StageIcon status={stage.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{def.name}</span>
                    <span className={cn('text-xs', SERVICE_COLORS[def.service])}>{def.service}</span>
                    <StatusBadge status={stage.status} />
                  </div>
                  <div className="flex gap-3 mt-0.5 text-xs text-muted-foreground">
                    {stage.attempt > 0 && <span>Attempt {stage.attempt}/{stage.max_attempts}</span>}
                    {duration && <span>{duration}</span>}
                    {stage.started_at && <span>{formatDate(stage.started_at)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {stage.status === 'failed' && stage.attempt < stage.max_attempts && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-red-800 hover:bg-red-900/20"
                      onClick={e => { e.stopPropagation(); onRetry(stage.id); }}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Retry
                    </Button>
                  )}
                  {['pending', 'failed'].includes(stage.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-zinc-500 hover:text-zinc-300"
                      onClick={e => { e.stopPropagation(); onSkip(stage.id); }}
                    >
                      Skip
                    </Button>
                  )}
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="px-3 pb-3 border-t border-border mt-0">
                  <div className="pt-3 space-y-3">
                    <p className="text-xs text-muted-foreground">{def.description}</p>

                    {stage.error_message && (
                      <div className="rounded-md bg-red-950/30 border border-red-900/40 p-3">
                        <p className="text-xs font-medium text-red-400 mb-1">Error</p>
                        <p className="text-xs text-red-300 font-mono">{stage.error_message}</p>
                      </div>
                    )}

                    {stage.output && Object.keys(stage.output).length > 0 && (
                      <div className="rounded-md bg-zinc-900 border border-zinc-800 p-3">
                        <p className="text-xs font-medium text-muted-foreground mb-2">Output</p>
                        <pre className="text-xs text-zinc-300 overflow-auto max-h-48 font-mono">
                          {JSON.stringify(stage.output, null, 2)}
                        </pre>
                      </div>
                    )}

                    {stage.screenshot_path && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <File className="h-3 w-3" />
                        <span>Screenshot: {stage.screenshot_path}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Approval gate */}
            {approval && stage.status === 'awaiting_input' && (
              <ApprovalGate approval={approval} onApprove={onApprove} />
            )}
          </div>
        );
      })}
    </div>
  );
}

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow, format } from 'date-fns';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDate(timestamp: number): string {
  return format(new Date(timestamp), 'MMM d, yyyy HH:mm');
}

export function formatRelative(timestamp: number): string {
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    // Run statuses
    draft: 'text-zinc-500',
    queued: 'text-blue-400',
    running: 'text-yellow-400',
    waiting_for_approval: 'text-orange-400',
    retrying: 'text-amber-400',
    completed: 'text-green-400',
    failed: 'text-red-400',
    cancelled: 'text-zinc-500',
    // Stage statuses
    pending: 'text-zinc-400',
    success: 'text-green-400',
    skipped: 'text-zinc-500',
    awaiting_input: 'text-orange-400',
    // Project / misc
    active: 'text-green-400',
    archived: 'text-zinc-500',
  };
  return map[status] ?? 'text-zinc-400';
}

export function getStatusBg(status: string): string {
  const map: Record<string, string> = {
    // Run statuses
    draft: 'bg-zinc-800 text-zinc-400',
    queued: 'bg-blue-900/40 text-blue-300',
    running: 'bg-yellow-900/40 text-yellow-300',
    waiting_for_approval: 'bg-orange-900/40 text-orange-300',
    retrying: 'bg-amber-900/40 text-amber-300',
    completed: 'bg-green-900/40 text-green-300',
    failed: 'bg-red-900/40 text-red-300',
    cancelled: 'bg-zinc-800 text-zinc-500',
    // Stage statuses
    pending: 'bg-zinc-800 text-zinc-300',
    success: 'bg-green-900/40 text-green-300',
    skipped: 'bg-zinc-800 text-zinc-500',
    awaiting_input: 'bg-orange-900/40 text-orange-300',
    // Project / misc
    active: 'bg-green-900/40 text-green-300',
    archived: 'bg-zinc-800 text-zinc-500',
    once: 'bg-blue-900/40 text-blue-300',
    recurring: 'bg-purple-900/40 text-purple-300',
  };
  return map[status] ?? 'bg-zinc-800 text-zinc-300';
}

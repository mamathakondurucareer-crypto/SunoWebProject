'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatBytes } from '@/lib/utils';
import { HardDrive, FileAudio, FileVideo, FileImage, FileText, Package, Copy, Check } from 'lucide-react';
import type { Asset, AssetType } from '@/types';

const fetcher = (url: string) => fetch(url).then(r => r.json());

function AssetIcon({ type }: { type: AssetType }) {
  switch (type) {
    case 'audio': return <FileAudio className="h-5 w-5 text-pink-400" />;
    case 'video': return <FileVideo className="h-5 w-5 text-cyan-400" />;
    case 'thumbnail':
    case 'image': return <FileImage className="h-5 w-5 text-teal-400" />;
    case 'package': return <Package className="h-5 w-5 text-orange-400" />;
    default: return <FileText className="h-5 w-5 text-zinc-400" />;
  }
}

const ASSET_TYPES: AssetType[] = ['audio', 'video', 'thumbnail', 'lyrics', 'document', 'screenshot', 'evaluation', 'scene_plan', 'package'];

function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="flex-shrink-0 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
      title="Copy path"
    >
      {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function AssetsContent() {
  const searchParams = useSearchParams();
  const workflowRunId = searchParams.get('workflow_run_id') ?? undefined;
  const projectId = searchParams.get('project_id') ?? undefined;

  const query = new URLSearchParams();
  if (workflowRunId) query.set('workflow_run_id', workflowRunId);
  if (projectId) query.set('project_id', projectId);

  const { data } = useSWR(`/api/assets?${query}`, fetcher, { refreshInterval: 10000 });
  const assets: Asset[] = data?.data ?? [];

  const grouped = ASSET_TYPES.reduce((acc, type) => {
    const items = assets.filter(a => a.asset_type === type);
    if (items.length > 0) acc[type] = items;
    return acc;
  }, {} as Record<string, Asset[]>);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Assets</h1>
        <p className="text-muted-foreground mt-1">{assets.length} total asset{assets.length !== 1 ? 's' : ''}</p>
      </div>

      {assets.length === 0 ? (
        <Card>
          <CardContent className="p-16 text-center">
            <HardDrive className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No assets yet. Assets are created as workflow stages complete.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([type, items]) => (
            <div key={type}>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
                <AssetIcon type={type as AssetType} />
                {type.replace(/_/g, ' ')} ({items.length})
              </h2>
              <div className="space-y-2">
                {items.map(asset => (
                  <Card key={asset.id} className="hover:border-primary/30 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <AssetIcon type={asset.asset_type} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{asset.name}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <p className="text-xs text-muted-foreground truncate font-mono flex-1">{asset.file_path}</p>
                            {asset.file_path && <CopyPathButton path={asset.file_path} />}
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            {asset.file_size && <span className="text-xs text-muted-foreground">{formatBytes(asset.file_size)}</span>}
                            {asset.service && <Badge className="text-xs">{asset.service}</Badge>}
                            {asset.mime_type && <span className="text-xs text-muted-foreground">{asset.mime_type}</span>}
                            <span className="text-xs text-muted-foreground">{formatDate(asset.created_at)}</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AssetsPage() {
  return (
    <Suspense fallback={<div className="text-muted-foreground p-4">Loading...</div>}>
      <AssetsContent />
    </Suspense>
  );
}

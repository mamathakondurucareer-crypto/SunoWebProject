'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';
import { CheckCircle2, XCircle, ExternalLink, RefreshCw, Save } from 'lucide-react';
import type { BrowserProfile, AppSetting } from '@/types';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const SERVICE_URLS: Record<string, string> = {
  gemini: 'https://gemini.google.com/app',
  chatgpt: 'https://chat.openai.com',
  suno: 'https://suno.com',
  grok: 'https://grok.com',
  canva: 'https://www.canva.com',
  capcut: 'https://www.capcut.com',
};

const SERVICE_INSTRUCTIONS: Record<string, string> = {
  gemini: 'Sign in with your Google account at gemini.google.com',
  chatgpt: 'Sign in at chat.openai.com (ChatGPT account required)',
  suno: 'Sign in at suno.com (free or pro account)',
  grok: 'Sign in at grok.com (xAI account required)',
  canva: 'Sign in at canva.com (free account supported)',
  capcut: 'CapCut handoff is local-only — no login required',
};

export default function SettingsPage() {
  const { data: profilesData, mutate: mutateProfiles } = useSWR('/api/browser-profiles', fetcher, { refreshInterval: 10000 });
  const { data: settingsData, mutate: mutateSettings } = useSWR('/api/settings', fetcher);
  const [settingValues, setSettingValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const profiles: BrowserProfile[] = profilesData?.data ?? [];
  const settings: AppSetting[] = settingsData?.data ?? [];

  useEffect(() => {
    if (settings.length > 0) {
      setSettingValues(Object.fromEntries(settings.map(s => [s.key, s.value])));
    }
  }, [settings]);

  const handleMarkConnected = async (profileId: string, connected: boolean) => {
    await fetch(`/api/browser-profiles/${profileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_connected: connected }),
    });
    mutateProfiles();
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingValues),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      mutateSettings();
    } finally {
      setSaving(false);
    }
  };

  const editableKeys = [
    'projects_dir',
    'downloads_dir',
    'logs_dir',
    'browser_profiles_dir',
    'worker_poll_interval_ms',
    'playwright_headless',
    'playwright_slow_mo',
    'playwright_timeout_ms',
    'playwright_nav_timeout_ms',
  ];

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">Browser profiles, paths, and worker configuration</p>
      </div>

      {/* Browser Connections */}
      <Card>
        <CardHeader>
          <CardTitle>Service Connections</CardTitle>
          <CardDescription>
            Each service needs a logged-in browser profile. The worker uses persistent browser contexts
            stored in the browser profiles directory. To connect a service:
            launch the worker with <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded">PLAYWRIGHT_HEADLESS=false</code>,
            navigate to the service, log in, then mark it as connected here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {profiles.map(profile => (
            <div key={profile.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background">
              <div className="flex items-center gap-3">
                <div className={`h-2.5 w-2.5 rounded-full ${profile.is_connected ? 'bg-green-400' : 'bg-zinc-600'}`} />
                <div>
                  <p className="text-sm font-medium capitalize">{profile.service}</p>
                  <p className="text-xs text-muted-foreground">{SERVICE_INSTRUCTIONS[profile.service]}</p>
                  {profile.last_login_at && (
                    <p className="text-xs text-muted-foreground">Last login: {formatDate(profile.last_login_at)}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={SERVICE_URLS[profile.service]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  Open <ExternalLink className="h-3 w-3" />
                </a>
                <Button
                  size="sm"
                  variant={profile.is_connected ? 'destructive' : 'outline'}
                  className="h-7 text-xs"
                  onClick={() => handleMarkConnected(profile.id, !profile.is_connected)}
                >
                  {profile.is_connected ? (
                    <><XCircle className="h-3 w-3 mr-1" />Disconnect</>
                  ) : (
                    <><CheckCircle2 className="h-3 w-3 mr-1" />Mark Connected</>
                  )}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* App Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Application Settings</CardTitle>
          <CardDescription>Configure file paths and worker behavior.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {editableKeys.map(key => {
            const setting = settings.find(s => s.key === key);
            return (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={key} className="flex items-center gap-2">
                  <code className="text-xs text-primary">{key}</code>
                </Label>
                {setting?.description && (
                  <p className="text-xs text-muted-foreground">{setting.description}</p>
                )}
                <Input
                  id={key}
                  value={settingValues[key] ?? ''}
                  onChange={e => setSettingValues(prev => ({ ...prev, [key]: e.target.value }))}
                />
              </div>
            );
          })}
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSaveSettings} loading={saving}>
              <Save className="h-4 w-4" />
              {saved ? 'Saved!' : 'Save Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Profile paths */}
      <Card>
        <CardHeader>
          <CardTitle>Browser Profile Paths</CardTitle>
          <CardDescription>These paths are managed automatically. Each service has its own persistent browser context.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {profiles.map(profile => (
              <div key={profile.id} className="flex items-center justify-between text-sm p-2 rounded-lg bg-zinc-900">
                <span className="capitalize text-muted-foreground w-20">{profile.service}</span>
                <code className="text-xs text-zinc-400 font-mono flex-1 ml-4 truncate">{profile.profile_path}</code>
                <Badge className="ml-2 text-xs">{profile.is_connected ? 'connected' : 'disconnected'}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

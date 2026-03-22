'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function NewProjectPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    description: '',
    devotional_theme: '',
    target_language: 'English',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error));
      router.push(`/projects/${data.data.id}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/projects">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">New Project</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Project Name *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Jai Shri Ram — Bhajan"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="devotional_theme">Devotional Theme *</Label>
              <Textarea
                id="devotional_theme"
                value={form.devotional_theme}
                onChange={e => setForm({ ...form, devotional_theme: e.target.value })}
                placeholder="Describe the devotional theme, deity, and emotional tone. e.g. 'Surrender and devotion to Lord Ram — emphasising peace, bhakti, and inner calm; warm and uplifting'"
                rows={4}
                required
              />
              <p className="text-xs text-muted-foreground">This is sent to Gemini to generate the complete song package.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Project Description</Label>
              <Input
                id="description"
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Optional internal notes"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="target_language">Target Language</Label>
              <Input
                id="target_language"
                value={form.target_language}
                onChange={e => setForm({ ...form, target_language: e.target.value })}
                placeholder="English"
              />
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="submit" loading={loading}>
                Create Project
              </Button>
              <Link href="/projects">
                <Button type="button" variant="outline">Cancel</Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

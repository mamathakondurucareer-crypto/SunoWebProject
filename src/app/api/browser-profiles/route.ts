import { NextRequest, NextResponse } from 'next/server';
import { browserProfilesRepo } from '@/lib/db/repositories/browser-profiles';
import type { ServiceName } from '@/types';

const SERVICES: ServiceName[] = ['gemini', 'chatgpt', 'suno', 'grok', 'canva', 'capcut'];

export async function GET() {
  // Ensure all profiles exist
  for (const service of SERVICES) {
    browserProfilesRepo.upsert(service);
  }
  const profiles = browserProfilesRepo.findAll();
  return NextResponse.json({ data: profiles });
}

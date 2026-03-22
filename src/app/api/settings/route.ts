import { NextRequest, NextResponse } from 'next/server';
import { settingsRepo } from '@/lib/db/repositories/settings';

export async function GET() {
  const settings = settingsRepo.findAll();
  return NextResponse.json({ data: settings });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, string>;
    if (typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Body must be a key/value object' }, { status: 400 });
    }
    settingsRepo.setMany(body);
    return NextResponse.json({ data: settingsRepo.findAll() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

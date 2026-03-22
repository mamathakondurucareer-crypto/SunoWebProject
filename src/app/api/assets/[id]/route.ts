import { NextRequest, NextResponse } from 'next/server';
import { assetsRepo } from '@/lib/db/repositories/assets';
import fs from 'fs';
import path from 'path';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const asset = assetsRepo.findById(params.id);
  if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: asset });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const asset = assetsRepo.findById(params.id);
  if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  assetsRepo.delete(params.id);
  return new NextResponse(null, { status: 204 });
}

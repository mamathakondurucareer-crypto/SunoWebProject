import { NextRequest, NextResponse } from 'next/server';
import { assetsRepo } from '@/lib/db/repositories/assets';
import type { AssetType } from '@/types';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const project_id = searchParams.get('project_id') ?? undefined;
  const workflow_run_id = searchParams.get('workflow_run_id') ?? undefined;
  const asset_type = (searchParams.get('asset_type') ?? undefined) as AssetType | undefined;

  const assets = assetsRepo.findAll({ project_id, workflow_run_id, asset_type });
  return NextResponse.json({ data: assets });
}

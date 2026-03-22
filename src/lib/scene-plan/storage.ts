import fs from 'fs';
import path from 'path';
import { SceneManifestSchema } from './schema';
import type { SceneManifest } from './types';

const MANIFEST_FILENAME = 'timed_scene_manifest.json';

export function saveSceneManifest(manifest: SceneManifest, runDir: string): string {
  fs.mkdirSync(runDir, { recursive: true });
  const filePath = path.join(runDir, MANIFEST_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2));
  return filePath;
}

export function loadSceneManifest(filePath: string): SceneManifest | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const result = SceneManifestSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data as SceneManifest;
  } catch {
    return null;
  }
}

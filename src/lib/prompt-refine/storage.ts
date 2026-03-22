import fs from 'fs';
import path from 'path';
import type { RefinedScenePrompt, PromptRefinementRun } from './types';

const SCENE_PROMPTS_DIR = 'grok_prompts';
const MANIFEST_FILENAME = 'prompt_refinement_manifest.json';

/** Zero-pad scene number to 3 digits for consistent sorting */
function sceneFilename(n: number): string {
  return `scene_${String(n).padStart(3, '0')}.json`;
}

export interface PromptRefinementManifest {
  total_scenes: number;
  created_at: string;
  scenes: RefinedScenePrompt[];
}

/**
 * Write one JSON file per scene into `{runDir}/grok_prompts/`
 * and a consolidated `prompt_refinement_manifest.json`.
 *
 * @returns PromptRefinementRun with all artifact paths
 */
export function savePromptRefinementRun(
  scenes: RefinedScenePrompt[],
  runDir: string,
  screenshotPath: string | null = null
): PromptRefinementRun {
  const scenesDir = path.join(runDir, SCENE_PROMPTS_DIR);
  fs.mkdirSync(scenesDir, { recursive: true });

  // Write per-scene JSON files
  const scenePaths: string[] = [];
  for (const scene of scenes) {
    const filePath = path.join(scenesDir, sceneFilename(scene.scene_number));
    fs.writeFileSync(filePath, JSON.stringify(scene, null, 2));
    scenePaths.push(filePath);
  }

  // Write consolidated manifest
  const manifest: PromptRefinementManifest = {
    total_scenes: scenes.length,
    created_at: new Date().toISOString(),
    scenes,
  };
  const manifestPath = path.join(runDir, MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    run_dir: runDir,
    manifest_path: manifestPath,
    scene_prompt_paths: scenePaths,
    total_scenes: scenes.length,
    chatgpt_screenshot: screenshotPath && fs.existsSync(screenshotPath) ? screenshotPath : null,
  };
}

/**
 * Load a previously saved refinement manifest.
 * Returns null on read/parse failure.
 */
export function loadPromptRefinementManifest(runDir: string): PromptRefinementManifest | null {
  try {
    const raw = fs.readFileSync(path.join(runDir, MANIFEST_FILENAME), 'utf-8');
    return JSON.parse(raw) as PromptRefinementManifest;
  } catch {
    return null;
  }
}

/**
 * Load a single per-scene prompt file.
 * Returns null if the file does not exist or cannot be parsed.
 */
export function loadScenePrompt(scenePromptPath: string): RefinedScenePrompt | null {
  try {
    const raw = fs.readFileSync(scenePromptPath, 'utf-8');
    return JSON.parse(raw) as RefinedScenePrompt;
  } catch {
    return null;
  }
}

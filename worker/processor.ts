/**
 * Stage processor — wires the adapter pool and local runners into the
 * ExecutionService, then processes a single job.
 */

import path from 'path';
import fs from 'fs';
import { buildScenePlan, parseDurationString, saveSceneManifest } from '@/lib/scene-plan';
import { stageRunsRepo } from '@/lib/db/repositories/stage-runs';
import { logsRepo } from '@/lib/db/repositories/logs';
import { browserProfilesRepo } from '@/lib/db/repositories/browser-profiles';
import { selectorsRepo } from '@/lib/db/repositories/selectors';
import { assetsRepo } from '@/lib/db/repositories/assets';
import { WorkflowEngine } from '@/lib/workflow/engine';
import { ExecutionService } from '@/lib/workflow/execution-service';
import type { Job, StageKey, ServiceName } from '@/types';
import type {
  ExecutionContext,
  IStageRunner,
  StageRunResult,
  StageRunnerRegistry,
  InputRequest,
} from '@/lib/workflow/types';

import { GeminiAdapter } from './adapters/gemini';
import { ChatGPTAdapter } from './adapters/chatgpt';
import { SunoAdapter } from './adapters/suno';
import { GrokAdapter } from './adapters/grok';
import { CanvaAdapter } from './adapters/canva';
import { CapCutAdapter } from './adapters/capcut';
import type { BaseServiceAdapter } from './adapters/base';
import type { StageContext, StageResult } from '@/types';

// ─── Adapter pool ─────────────────────────────────────────────────────────────
// Reuse browser contexts between jobs to avoid repeated login.

const adapterPool: Map<ServiceName, BaseServiceAdapter> = new Map();

function getOrCreateAdapter(service: ServiceName, profilePath: string): BaseServiceAdapter {
  if (adapterPool.has(service)) return adapterPool.get(service)!;

  let adapter: BaseServiceAdapter;
  switch (service) {
    case 'gemini':  adapter = new GeminiAdapter(profilePath);  break;
    case 'chatgpt': adapter = new ChatGPTAdapter(profilePath); break;
    case 'suno':    adapter = new SunoAdapter(profilePath);    break;
    case 'grok':    adapter = new GrokAdapter(profilePath);    break;
    case 'canva':   adapter = new CanvaAdapter(profilePath);   break;
    case 'capcut':  adapter = new CapCutAdapter(profilePath);  break;
    default:        throw new Error(`Unknown service: ${service}`);
  }

  adapterPool.set(service, adapter);
  return adapter;
}

// ─── AdapterRunner bridge ─────────────────────────────────────────────────────
// Wraps a legacy BaseServiceAdapter (StageContext → StageResult) into the new
// IStageRunner (ExecutionContext → StageRunResult) interface.

class AdapterRunner implements IStageRunner {
  constructor(private readonly service: ServiceName) {}

  async run(ctx: ExecutionContext): Promise<StageRunResult> {
    const profile = browserProfilesRepo.upsert(this.service);
    const selectorMap = selectorsRepo.getSelectorMap(this.service);

    // Merge all upstream inputs into the stage's input field so legacy adapters
    // can access them via ctx.stageRun.input without DB reads.
    const mergedInput = Object.assign({}, ctx.stage.input ?? {}, ...Object.values(ctx.inputs));

    const legacyCtx: StageContext = {
      stageRun: { ...ctx.stage, input: mergedInput },
      workflowRun: ctx.run,
      project: ctx.project,
      projectDir: ctx.dirs.project,
      runDir: ctx.dirs.run,
      downloadsDir: ctx.dirs.downloads,
    };

    const adapter = getOrCreateAdapter(this.service, profile.profile_path);
    let result: StageResult;
    try {
      result = await adapter.execute(legacyCtx, selectorMap);
    } catch (err) {
      return { status: 'failed', error: String(err) };
    }

    browserProfilesRepo.touchUsed(this.service);

    if (result.success) {
      return {
        status: 'success',
        output: result.output ?? {},
        artifacts: result.assetPaths?.map(a => ({
          path: a.path,
          type: a.type,
          name: a.name,
          mimeType: a.mimeType,
        })),
      };
    }
    return { status: 'failed', error: result.error ?? 'Unknown error' };
  }
}

// ─── Local runners ────────────────────────────────────────────────────────────

class GeminiCaptureParseRunner implements IStageRunner {
  async run(ctx: ExecutionContext): Promise<StageRunResult> {
    const geminiOutput = ctx.inputs['gemini_generate'];
    if (!geminiOutput) {
      return { status: 'failed', error: 'gemini_generate output not found' };
    }

    const rawResponse = (geminiOutput.raw_response as string) ?? '';
    const sections: Record<string, string> = {};
    const sectionRegex = /=== ([A-Z ]+) ===([\s\S]*?)(?====|$)/g;
    let match: RegExpExecArray | null;
    while ((match = sectionRegex.exec(rawResponse)) !== null) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
      sections[key] = match[2].trim();
    }

    const output = {
      title: sections['song_title'] ?? 'Untitled',
      lyrics: sections['lyrics'] ?? rawResponse,
      style_notes: sections['style_notes'] ?? '',
      vocal_guidance: sections['vocal_guidance'] ?? '',
      suno_style_prompt: sections['suno_style_prompt'] ?? 'devotional bhajan, harmonium, tabla, 80 BPM',
      background: sections['background'] ?? '',
      raw_sections: sections,
    };

    const parsedFile = path.join(ctx.dirs.run, 'parsed_gemini_output.json');
    fs.writeFileSync(parsedFile, JSON.stringify(output, null, 2));

    return { status: 'success', output };
  }
}

class CompareCandidatesRunner implements IStageRunner {
  async run(ctx: ExecutionContext): Promise<StageRunResult> {
    const sunoOutput = ctx.inputs['suno_generate'] ?? {};
    const evalA = ctx.inputs['chatgpt_evaluate_candidate_a'] ?? {};
    const evalB = ctx.inputs['chatgpt_evaluate_candidate_b'] ?? {};

    const options = [
      {
        id: 'A',
        label: `Candidate A: ${(sunoOutput.candidate_a as Record<string, unknown>)?.title ?? 'Audio A'}`,
        description: `Duration: ${(sunoOutput.candidate_a as Record<string, unknown>)?.duration ?? 'unknown'}`,
        metadata: { candidate: sunoOutput.candidate_a, evaluation: evalA },
      },
      {
        id: 'B',
        label: `Candidate B: ${(sunoOutput.candidate_b as Record<string, unknown>)?.title ?? 'Audio B'}`,
        description: `Duration: ${(sunoOutput.candidate_b as Record<string, unknown>)?.duration ?? 'unknown'}`,
        metadata: { candidate: sunoOutput.candidate_b, evaluation: evalB },
      },
    ];

    const inputRequest: InputRequest = {
      type: 'winner_selection',
      options,
      context: { suno_output: sunoOutput, eval_a: evalA, eval_b: evalB },
    };

    return {
      status: 'awaiting_input',
      output: { candidates: [sunoOutput.candidate_a, sunoOutput.candidate_b] },
      inputRequest,
    };
  }
}

class BuildScenePlanRunner implements IStageRunner {
  async run(ctx: ExecutionContext): Promise<StageRunResult> {
    // Resolve winner from human approval gate
    const approvalOutput = ctx.inputs['compare_candidates'] ?? {};
    const selectedWinner = ((approvalOutput.selected_option as string) ?? 'A').toUpperCase() as 'A' | 'B';

    // Resolve winner audio metadata from Suno output
    const sunoOutput = ctx.inputs['suno_generate'] ?? {};
    const winnerAudio = selectedWinner === 'A'
      ? (sunoOutput.candidate_a as Record<string, unknown> | undefined)
      : (sunoOutput.candidate_b as Record<string, unknown> | undefined);

    const rawDuration = winnerAudio?.duration ?? winnerAudio?.duration_seconds ?? null;
    const audioDurationSeconds = parseDurationString(rawDuration as string | number | null) ?? 180;

    // Lyrics and style from Gemini parse
    const parsedOutput = ctx.inputs['gemini_capture_parse'] ?? {};
    const lyrics = (parsedOutput.lyrics as string) ?? '';
    const stylePrompt = (parsedOutput.suno_style_prompt as string) ?? '';

    // Optional: winner evaluation scores for energy hints
    const evalKey = selectedWinner === 'A' ? 'chatgpt_evaluate_candidate_a' : 'chatgpt_evaluate_candidate_b';
    const evalOutput = ctx.inputs[evalKey] ?? {};
    const winnerAnalysis = (evalOutput.overall_score !== undefined) ? {
      hook_strength_score:  Number((evalOutput.hook_strength as Record<string, unknown> | undefined)?.score  ?? evalOutput.hook_strength_score  ?? 7),
      chorus_impact_score:  Number((evalOutput.chorus_impact as Record<string, unknown> | undefined)?.score  ?? evalOutput.chorus_impact_score  ?? 7),
      viral_proxy_score:    Number((evalOutput.viral_proxy_score as Record<string, unknown> | undefined)?.score ?? evalOutput.viral_proxy ?? 7),
    } : undefined;

    const manifest = buildScenePlan({
      audio_duration_seconds: audioDurationSeconds,
      song_title: (winnerAudio?.title as string) ?? (parsedOutput.title as string) ?? 'Devotional Song',
      lyrics,
      style_prompt: stylePrompt,
      devotional_theme: ctx.project.devotional_theme ?? '',
      winner_label: selectedWinner,
      winner_audio_path: (winnerAudio?.audio_path as string) ?? null,
      winner_analysis: winnerAnalysis,
    });

    const manifestPath = saveSceneManifest(manifest, ctx.dirs.run);

    const output = {
      total_duration: audioDurationSeconds,
      total_scenes: manifest.total_scenes,
      winner: selectedWinner,
      winner_audio_path: manifest.winner_audio_path,
      winner_title: manifest.song_title,
      manifest_path: manifestPath,
    };

    return {
      status: 'success',
      output,
      artifacts: [{ path: manifestPath, type: 'scene_plan', name: 'timed_scene_manifest.json' }],
    };
  }
}

class FinalPackageRunner implements IStageRunner {
  async run(ctx: ExecutionContext): Promise<StageRunResult> {
    const packagePath = path.join(ctx.dirs.run, 'final_package');
    fs.mkdirSync(packagePath, { recursive: true });

    const stages = stageRunsRepo.findByWorkflowRunId(ctx.run.id);
    const stageSummary = stages.map(s => ({
      stage: s.stage_key,
      status: s.status,
      completed_at: s.completed_at,
    }));

    type SR = import('@/types').StageRun;
    const checklist = [
      { item: 'Lyrics corrected', done: stages.find((s: SR) => s.stage_key === 'chatgpt_lyrics_correct')?.status === 'success' },
      { item: 'Suno audio generated', done: stages.find((s: SR) => s.stage_key === 'suno_generate')?.status === 'success' },
      { item: 'Winning audio selected', done: stages.find((s: SR) => s.stage_key === 'compare_candidates')?.status === 'success' },
      { item: 'Scene plan built', done: stages.find((s: SR) => s.stage_key === 'build_scene_plan')?.status === 'success' },
      { item: 'Grok prompts refined', done: stages.find((s: SR) => s.stage_key === 'refine_grok_prompts')?.status === 'success' },
      { item: 'Grok videos generated', done: stages.find((s: SR) => s.stage_key === 'grok_generate_scene_clips')?.status === 'success' },
      { item: 'Thumbnails prepared', done: stages.find((s: SR) => s.stage_key === 'canva_prepare_thumbnails')?.status === 'success' },
      { item: 'CapCut package assembled', done: stages.find((s: SR) => s.stage_key === 'capcut_handoff_package')?.status === 'success' },
    ];

    const completedItems = checklist.filter(c => c.done).length;

    const summary = {
      project_name: ctx.project.name,
      devotional_theme: ctx.project.devotional_theme,
      workflow_run_id: ctx.run.id,
      completed_at: new Date().toISOString(),
      stage_summary: stageSummary,
      checklist,
      completion_percentage: Math.round((completedItems / checklist.length) * 100),
      delivery_package: path.join(ctx.dirs.run, 'capcut_package'),
    };

    const summaryPath = path.join(packagePath, 'workflow_summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

    const report = `# Final Package: ${ctx.project.name}
Theme: ${ctx.project.devotional_theme}
Completed: ${summary.completed_at}
Completion: ${summary.completion_percentage}%

## Checklist
${checklist.map(c => `- [${c.done ? 'x' : ' '}] ${c.item}`).join('\n')}

## Delivery Location
${summary.delivery_package}

## Workflow Stages
${stageSummary.map(s => `- ${s.stage}: ${s.status}`).join('\n')}
`;
    fs.writeFileSync(path.join(packagePath, 'FINAL_REPORT.md'), report);

    return {
      status: 'success',
      output: summary,
      artifacts: [{ path: summaryPath, type: 'package', name: 'workflow_summary.json' }],
    };
  }
}

// ─── Registry builder ─────────────────────────────────────────────────────────

function buildRegistry(): StageRunnerRegistry {
  const registry: StageRunnerRegistry = new Map();

  registry.set('gemini_generate',              new AdapterRunner('gemini'));
  registry.set('gemini_capture_parse',         new GeminiCaptureParseRunner());
  registry.set('chatgpt_lyrics_correct',       new AdapterRunner('chatgpt'));
  registry.set('suno_generate',                new AdapterRunner('suno'));
  registry.set('chatgpt_evaluate_candidate_a', new AdapterRunner('chatgpt'));
  registry.set('chatgpt_evaluate_candidate_b', new AdapterRunner('chatgpt'));
  registry.set('chatgpt_auto_compare',         new AdapterRunner('chatgpt'));
  registry.set('compare_candidates',           new CompareCandidatesRunner());
  registry.set('build_scene_plan',             new BuildScenePlanRunner());
  registry.set('refine_grok_prompts',           new AdapterRunner('chatgpt'));
  registry.set('grok_generate_scene_clips',    new AdapterRunner('grok'));
  registry.set('canva_prepare_thumbnails',     new AdapterRunner('canva'));
  registry.set('capcut_handoff_package',       new AdapterRunner('capcut'));
  registry.set('final_package',                new FinalPackageRunner());

  return registry;
}

const executionService = new ExecutionService(buildRegistry());

// ─── Public API ───────────────────────────────────────────────────────────────

export async function processJob(job: Job): Promise<boolean> {
  try {
    await executionService.executeJob(job);
    return true;
  } catch (err) {
    logsRepo.append({ level: 'error', message: `processJob unhandled error: ${String(err)}` });
    return false;
  }
}

export async function closeAllAdapters(): Promise<void> {
  for (const [service, adapter] of adapterPool.entries()) {
    try {
      await adapter.closeContext();
    } catch {
      // ignore
    }
    adapterPool.delete(service);
  }
}

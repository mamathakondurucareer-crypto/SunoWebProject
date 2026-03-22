/**
 * Development seed data.
 * Run: npx ts-node src/lib/db/seed.ts
 *
 * Idempotent — uses INSERT OR IGNORE / findByX checks so it is safe to re-run.
 */

import { runMigrations } from './migrate';
import { projectsRepo } from './repositories/projects';
import { workflowRunsRepo } from './repositories/workflow-runs';
import { stageRunsRepo } from './repositories/stage-runs';
import { schedulesRepo } from './repositories/schedules';
import { browserProfilesRepo } from './repositories/browser-profiles';
import { STAGE_DEFINITIONS } from '../workflow/definition';
import type { StageKey } from '@/types';

function seed() {
  // Ensure schema is current before seeding
  runMigrations();

  // ── 1. Sample project ──────────────────────────────────────────────────
  const projects = projectsRepo.findAll();
  let project = projects.find(p => p.name === 'Grace in the Valley');

  if (!project) {
    project = projectsRepo.create({
      name: 'Ram Ki Mahima',
      description: 'A devotional bhajan video celebrating Lord Ram\'s glory',
      devotional_theme: 'Bhakti and devotion to Lord Ram',
      target_language: 'Hindi',
    });
    console.log(`[seed] Created project: ${project.id}`);
  } else {
    console.log(`[seed] Project already exists: ${project.id}`);
  }

  // ── 2. Sample workflow run with first stage completed ──────────────────
  const existingRuns = workflowRunsRepo.findAll(project.id);
  if (existingRuns.length === 0) {
    const run = workflowRunsRepo.create({
      project_id: project.id,
      name: `Demo run — ${new Date().toISOString().slice(0, 10)}`,
    });

    stageRunsRepo.createMany(
      STAGE_DEFINITIONS.map(def => ({
        workflow_run_id: run.id,
        stage_key: def.key as StageKey,
        stage_index: def.index,
        max_attempts: def.maxAttempts,
      }))
    );

    // Simulate gemini_generate completing successfully
    const allStages = stageRunsRepo.findByWorkflowRunId(run.id);
    const geminiStage = allStages.find(s => s.stage_key === 'gemini_generate');
    if (geminiStage) {
      stageRunsRepo.markSuccess(geminiStage.id, {
        song_title: 'Jai Shri Ram',
        verse_1: 'Raghupati Raghava Raja Ram, Patita Pavana Sita Ram',
        chorus: 'Ram naam ki mahima nirali, har dil mein basi hai',
        bridge: 'Siya Ram Siya Ram, Siya Ram jay jay Ram',
        genre: 'Hindu Devotional / Bhajan',
        mood: 'Devotional, peaceful, triumphant',
      });
      workflowRunsRepo.incrementCompletedStages(run.id);
    }

    console.log(`[seed] Created workflow run: ${run.id}`);
  } else {
    console.log(`[seed] Workflow run already exists (${existingRuns.length} runs)`);
  }

  // ── 3. Sample recurring schedule ──────────────────────────────────────
  const schedules = schedulesRepo.findAll();
  if (schedules.length === 0) {
    schedulesRepo.create({
      project_id: project.id,
      name: 'Weekly devotional production',
      schedule_type: 'recurring',
      cron_expression: '0 8 * * 1', // every Monday at 08:00
      workflow_config: { auto_approve: false },
    });
    console.log('[seed] Created sample schedule');
  }

  // ── 4. Browser profile placeholders ───────────────────────────────────
  const services = ['gemini', 'chatgpt', 'suno', 'grok', 'canva'] as const;
  for (const service of services) {
    const existing = browserProfilesRepo.findByService(service);
    if (!existing) {
      browserProfilesRepo.upsert(service);
      console.log(`[seed] Created browser profile placeholder: ${service}`);
    }
  }

  console.log('[seed] Done');
}

seed();

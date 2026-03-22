/**
 * Tests for src/lib/scene-plan/planner.ts
 *
 * Uses node:test + node:assert/strict (no external test framework).
 * Run with: npm run test:scene
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLyricSections,
  buildScenePlan,
  parseDurationString,
} from '../planner';
import type { ScenePlanInput } from '../types';
import { CRITICAL_MANIFEST_RULES } from '../schema';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FULL_LYRICS = `[Intro]
Jai Shri Ram, Jai Shri Ram

[Verse 1]
Raghupati Raghava Raja Ram
Patita Pavana Sita Ram
Bolo bolo sab mil bolo
Ram naam satya hai

[Pre-Chorus]
Antar ke andhiyaare mein
Jyoti jalaao Ram

[Chorus]
Ram naam ki mahima nirali
Har dil mein basi hai
Ek hi naama ek hi dham
Sita Ram Sita Ram

[Bridge]
Dohe ke sangam mein
Tere naam ka jaap hai

[Final Chorus]
Ram naam ki mahima nirali
Har dil mein basi hai
Ek hi naama ek hi dham
Sita Ram Sita Ram

[Outro]
Shanti shanti shanti`;

const BASE_INPUT: ScenePlanInput = {
  audio_duration_seconds: 180,
  song_title: 'Raghupati Raghava',
  lyrics: FULL_LYRICS,
  style_prompt: 'devotional gospel, warm piano, 80 BPM',
  devotional_theme: 'Lord Ram devotion',
  winner_label: 'A',
  winner_audio_path: '/runs/r1/audio/candidate_a.mp3',
};

// ─── parseLyricSections ───────────────────────────────────────────────────────

describe('parseLyricSections — section detection', () => {
  it('detects all 7 sections', () => {
    const sections = parseLyricSections(FULL_LYRICS);
    const types = sections.map(s => s.section);
    assert.ok(types.includes('intro'), 'missing intro');
    assert.ok(types.includes('verse'), 'missing verse');
    assert.ok(types.includes('pre_chorus'), 'missing pre_chorus');
    assert.ok(types.includes('chorus'), 'missing chorus');
    assert.ok(types.includes('bridge'), 'missing bridge');
    assert.ok(types.includes('final_chorus'), 'missing final_chorus');
    assert.ok(types.includes('outro'), 'missing outro');
  });

  it('assigns lines to sections', () => {
    const sections = parseLyricSections(FULL_LYRICS);
    const verse = sections.find(s => s.section === 'verse');
    assert.ok(verse !== undefined);
    assert.ok(verse.lines.length >= 2);
  });

  it('excludes bracketed headers from lines', () => {
    const sections = parseLyricSections(FULL_LYRICS);
    for (const s of sections) {
      for (const line of s.lines) {
        assert.ok(!line.startsWith('['), `Line starts with '[': "${line}"`);
      }
    }
  });

  it('handles lyrics with no section markers', () => {
    const bare = 'Line one\nLine two\nLine three';
    const sections = parseLyricSections(bare);
    assert.equal(sections.length, 1);
    assert.equal(sections[0]!.lines.length, 3);
  });

  it('handles empty lyrics', () => {
    const sections = parseLyricSections('');
    assert.equal(sections.length, 1);
    assert.equal(sections[0]!.section, 'unknown');
  });

  it('normalises "Pre-Chorus" to pre_chorus', () => {
    const sections = parseLyricSections('[Pre-Chorus]\nLine');
    assert.equal(sections[0]!.section, 'pre_chorus');
  });

  it('normalises "Final Chorus" to final_chorus', () => {
    const sections = parseLyricSections('[Final Chorus]\nLine');
    assert.equal(sections[0]!.section, 'final_chorus');
  });

  it('normalises numbered verse like "Verse 1" to verse', () => {
    const sections = parseLyricSections('[Verse 1]\nLine');
    assert.equal(sections[0]!.section, 'verse');
  });

  it('normalises "CHORUS" (all caps) to chorus', () => {
    const sections = parseLyricSections('[CHORUS]\nLine');
    assert.equal(sections[0]!.section, 'chorus');
  });
});

// ─── buildScenePlan — basic structure ────────────────────────────────────────

describe('buildScenePlan — manifest structure', () => {
  it('returns a non-null manifest', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    assert.ok(manifest !== null);
  });

  it('sets song_title correctly', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    assert.equal(manifest.song_title, 'Raghupati Raghava');
  });

  it('sets winner_label correctly', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    assert.equal(manifest.winner_label, 'A');
  });

  it('sets audio_duration_seconds correctly', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    assert.equal(manifest.audio_duration_seconds, 180);
  });

  it('total_scenes matches scenes array length', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    assert.equal(manifest.total_scenes, manifest.scenes.length);
  });

  it('produces at least one scene', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    assert.ok(manifest.scenes.length >= 1);
  });

  it('scene count scales with duration — 180s produces ~18 scenes', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    assert.ok(manifest.scenes.length >= 10, `expected >=10 scenes, got ${manifest.scenes.length}`);
    assert.ok(manifest.scenes.length <= 30, `expected <=30 scenes, got ${manifest.scenes.length}`);
  });

  it('shorter 60s track produces fewer scenes than 180s track', () => {
    const short = buildScenePlan({ ...BASE_INPUT, audio_duration_seconds: 60 });
    const long  = buildScenePlan({ ...BASE_INPUT, audio_duration_seconds: 180 });
    assert.ok(short.scenes.length < long.scenes.length);
  });
});

// ─── buildScenePlan — time continuity rules ───────────────────────────────────

describe('buildScenePlan — time continuity', () => {
  it('first scene starts at 0', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    assert.equal(manifest.scenes[0]!.start_sec, 0);
  });

  it('last scene ends at audio_duration_seconds', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    const last = manifest.scenes[manifest.scenes.length - 1]!;
    assert.ok(Math.abs(last.end_sec - BASE_INPUT.audio_duration_seconds) < 0.1,
      `last end_sec ${last.end_sec} ≠ ${BASE_INPUT.audio_duration_seconds}`);
  });

  it('each scene starts where the previous ended (no gaps)', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    for (let i = 1; i < manifest.scenes.length; i++) {
      const prev = manifest.scenes[i - 1]!;
      const curr = manifest.scenes[i]!;
      assert.ok(
        Math.abs(curr.start_sec - prev.end_sec) < 0.1,
        `Gap between scene ${i} and ${i + 1}: ${prev.end_sec} → ${curr.start_sec}`
      );
    }
  });

  it('end_sec > start_sec for every scene', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    for (const s of manifest.scenes) {
      assert.ok(s.end_sec > s.start_sec,
        `Scene ${s.scene_number}: end_sec (${s.end_sec}) <= start_sec (${s.start_sec})`);
    }
  });

  it('scene_numbers are sequential starting at 1', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    manifest.scenes.forEach((s, i) => {
      assert.equal(s.scene_number, i + 1);
    });
  });
});

// ─── buildScenePlan — CRITICAL_MANIFEST_RULES ────────────────────────────────

describe('buildScenePlan — CRITICAL_MANIFEST_RULES', () => {
  it('passes has_scenes rule', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    assert.ok(CRITICAL_MANIFEST_RULES.has_scenes(manifest));
  });

  it('passes total_matches_count rule', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    assert.ok(CRITICAL_MANIFEST_RULES.total_matches_count(manifest));
  });

  it('passes no_time_gaps rule', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    assert.ok(CRITICAL_MANIFEST_RULES.no_time_gaps(manifest));
  });

  it('passes last_scene_ends_at_duration rule', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    assert.ok(CRITICAL_MANIFEST_RULES.last_scene_ends_at_duration(manifest));
  });
});

// ─── buildScenePlan — section fields ─────────────────────────────────────────

describe('buildScenePlan — scene field quality', () => {
  it('every scene has non-empty visual_goal', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    for (const s of manifest.scenes) {
      assert.ok(s.visual_goal.length > 5, `Scene ${s.scene_number} missing visual_goal`);
    }
  });

  it('every scene has non-empty grok_text_to_video_prompt_seed', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    for (const s of manifest.scenes) {
      assert.ok(s.grok_text_to_video_prompt_seed.length > 5, `Scene ${s.scene_number} missing grok_text_to_video_prompt_seed`);
    }
  });

  it('every scene has non-empty capcut_motion', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    for (const s of manifest.scenes) {
      assert.ok(s.capcut_motion.length > 2, `Scene ${s.scene_number} missing capcut_motion`);
    }
  });

  it('every scene energy is low | medium | high', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    const valid = new Set(['low', 'medium', 'high']);
    for (const s of manifest.scenes) {
      assert.ok(valid.has(s.energy), `Scene ${s.scene_number} invalid energy: ${s.energy}`);
    }
  });

  it('grok_text_to_video_prompt_seed includes the devotional theme', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    for (const s of manifest.scenes) {
      assert.ok(s.grok_text_to_video_prompt_seed.includes('Lord Ram devotion'),
        `Scene ${s.scene_number} grok_text_to_video_prompt_seed missing theme`);
    }
  });

  it('chorus sections have high energy', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    const chorusScenes = manifest.scenes.filter(
      s => s.section === 'chorus' || s.section === 'final_chorus'
    );
    assert.ok(chorusScenes.length > 0, 'No chorus scenes found');
    for (const s of chorusScenes) {
      assert.equal(s.energy, 'high',
        `Chorus scene ${s.scene_number} should be high energy, got ${s.energy}`);
    }
  });

  it('intro and outro sections have low energy', () => {
    const manifest = buildScenePlan(BASE_INPUT);
    const edgeScenes = manifest.scenes.filter(s => s.section === 'intro' || s.section === 'outro');
    assert.ok(edgeScenes.length > 0);
    for (const s of edgeScenes) {
      assert.equal(s.energy, 'low',
        `${s.section} scene ${s.scene_number} should be low energy, got ${s.energy}`);
    }
  });
});

// ─── buildScenePlan — winner_analysis energy override ────────────────────────

describe('buildScenePlan — chorus energy override via winner_analysis', () => {
  it('keeps high energy for chorus when chorus_impact_score is 8+', () => {
    const manifest = buildScenePlan({
      ...BASE_INPUT,
      winner_analysis: { hook_strength_score: 9, chorus_impact_score: 9, viral_proxy_score: 8 },
    });
    const chorus = manifest.scenes.find(s => s.section === 'chorus');
    assert.ok(chorus !== undefined);
    assert.equal(chorus.energy, 'high');
  });

  it('downgrades chorus to medium energy when chorus_impact_score is 5', () => {
    const manifest = buildScenePlan({
      ...BASE_INPUT,
      winner_analysis: { hook_strength_score: 6, chorus_impact_score: 5, viral_proxy_score: 5 },
    });
    const chorus = manifest.scenes.find(s => s.section === 'chorus');
    assert.ok(chorus !== undefined);
    assert.equal(chorus.energy, 'medium');
  });
});

// ─── buildScenePlan — edge cases ─────────────────────────────────────────────

describe('buildScenePlan — edge cases', () => {
  it('handles very short 30s track', () => {
    const manifest = buildScenePlan({ ...BASE_INPUT, audio_duration_seconds: 30 });
    assert.ok(manifest.scenes.length >= 1);
    assert.ok(CRITICAL_MANIFEST_RULES.last_scene_ends_at_duration(manifest));
  });

  it('handles lyrics with no section markers', () => {
    const manifest = buildScenePlan({
      ...BASE_INPUT,
      lyrics: 'Jai Shri Ram\nRaghupati Raghava\nSita Ram Sita Ram',
    });
    assert.ok(manifest.scenes.length >= 1);
    assert.ok(CRITICAL_MANIFEST_RULES.no_time_gaps(manifest));
  });

  it('handles winner_label B', () => {
    const manifest = buildScenePlan({ ...BASE_INPUT, winner_label: 'B', winner_audio_path: '/runs/r1/audio/candidate_b.mp3' });
    assert.equal(manifest.winner_label, 'B');
  });

  it('handles null winner_audio_path', () => {
    const manifest = buildScenePlan({ ...BASE_INPUT, winner_audio_path: null });
    assert.equal(manifest.winner_audio_path, null);
  });
});

// ─── parseDurationString ──────────────────────────────────────────────────────

describe('parseDurationString', () => {
  it('parses "3:42" as 222 seconds', () => {
    assert.equal(parseDurationString('3:42'), 222);
  });

  it('parses "0:30" as 30 seconds', () => {
    assert.equal(parseDurationString('0:30'), 30);
  });

  it('parses "180" as 180 seconds', () => {
    assert.equal(parseDurationString('180'), 180);
  });

  it('parses number 200 as 200', () => {
    assert.equal(parseDurationString(200), 200);
  });

  it('returns null for null', () => {
    assert.equal(parseDurationString(null), null);
  });

  it('returns null for undefined', () => {
    assert.equal(parseDurationString(undefined), null);
  });

  it('returns null for non-numeric string', () => {
    assert.equal(parseDurationString('unknown'), null);
  });

  it('returns null for malformed mm:ss with letters', () => {
    assert.equal(parseDurationString('3:xx'), null);
  });
});

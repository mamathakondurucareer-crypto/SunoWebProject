/**
 * Tests for src/lib/prompt-refine/parser.ts
 *
 * Uses node:test + node:assert/strict (no external test framework).
 * Run with: npm run test:prompts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { parseRefinedPrompts } from '../parser';
import type { SceneSourceRow } from '../parser';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'refinement-response-3scenes.txt');
const FIXTURE_RAW = fs.readFileSync(FIXTURE_PATH, 'utf-8');

/** Minimal source rows matching the 3-scene fixture */
const SOURCE_SCENES: SceneSourceRow[] = [
  { scene_number: 1, section: 'intro',      start_sec: 0,  end_sec: 10 },
  { scene_number: 2, section: 'verse',      start_sec: 10, end_sec: 22 },
  { scene_number: 3, section: 'pre_chorus', start_sec: 22, end_sec: 30 },
];

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('parseRefinedPrompts — happy path', () => {
  it('returns non-null for valid 3-scene fixture', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES);
    assert.ok(result !== null, 'Expected non-null result');
  });

  it('returns exactly 3 scenes', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    assert.equal(result.length, 3);
  });

  it('scene numbers are sequential 1, 2, 3', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    assert.deepEqual(
      result.map(s => s.scene_number),
      [1, 2, 3]
    );
  });
});

// ─── GROK_PROMPT field ────────────────────────────────────────────────────────

describe('parseRefinedPrompts — grok_prompt', () => {
  it('all scenes have non-empty grok_prompt', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    for (const scene of result) {
      assert.ok(scene.grok_prompt.length > 0, `Scene ${scene.scene_number} grok_prompt is empty`);
    }
  });

  it('SCENE_01 grok_prompt mentions temple', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    const s01 = result.find(s => s.scene_number === 1)!;
    assert.ok(
      s01.grok_prompt.toLowerCase().includes('temple'),
      'SCENE_01 grok_prompt should mention temple'
    );
  });

  it('SCENE_02 grok_prompt mentions diya or hands', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    const s02 = result.find(s => s.scene_number === 2)!;
    const lower = s02.grok_prompt.toLowerCase();
    assert.ok(
      lower.includes('diya') || lower.includes('hands'),
      'SCENE_02 grok_prompt should mention diya or hands'
    );
  });

  it('SCENE_03 grok_prompt mentions shrine or altar', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    const s03 = result.find(s => s.scene_number === 3)!;
    const lower = s03.grok_prompt.toLowerCase();
    assert.ok(
      lower.includes('shrine') || lower.includes('altar'),
      'SCENE_03 grok_prompt should mention shrine or altar'
    );
  });
});

// ─── DURATION_TARGET field ────────────────────────────────────────────────────

describe('parseRefinedPrompts — duration_target', () => {
  it('SCENE_01 duration_target is 10', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    assert.equal(result.find(s => s.scene_number === 1)!.duration_target, 10);
  });

  it('SCENE_02 duration_target is 12', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    assert.equal(result.find(s => s.scene_number === 2)!.duration_target, 12);
  });

  it('SCENE_03 duration_target is 8', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    assert.equal(result.find(s => s.scene_number === 3)!.duration_target, 8);
  });
});

// ─── ASPECT_RATIO field ───────────────────────────────────────────────────────

describe('parseRefinedPrompts — aspect_ratio', () => {
  it('all scenes have aspect_ratio 9:16', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    for (const scene of result) {
      assert.equal(scene.aspect_ratio, '9:16', `Scene ${scene.scene_number} aspect_ratio mismatch`);
    }
  });
});

// ─── Back-fill from sourceScenes ──────────────────────────────────────────────

describe('parseRefinedPrompts — source back-fill', () => {
  it('SCENE_01 section is back-filled as "intro"', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    assert.equal(result.find(s => s.scene_number === 1)!.section, 'intro');
  });

  it('SCENE_02 section is back-filled as "verse"', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    assert.equal(result.find(s => s.scene_number === 2)!.section, 'verse');
  });

  it('SCENE_03 section is back-filled as "pre_chorus"', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    assert.equal(result.find(s => s.scene_number === 3)!.section, 'pre_chorus');
  });

  it('SCENE_01 start_sec is 0 from source', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    assert.equal(result.find(s => s.scene_number === 1)!.start_sec, 0);
  });

  it('SCENE_02 start_sec is 10 from source', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    assert.equal(result.find(s => s.scene_number === 2)!.start_sec, 10);
  });

  it('SCENE_03 end_sec is 30 from source', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    assert.equal(result.find(s => s.scene_number === 3)!.end_sec, 30);
  });

  it('scene with no source row falls back to section "unknown"', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, [])!;
    // With no source rows, all sections should be "unknown"
    for (const scene of result) {
      assert.equal(scene.section, 'unknown', `Scene ${scene.scene_number} should fall back to "unknown"`);
    }
  });
});

// ─── NEGATIVE_CONSTRAINTS field ───────────────────────────────────────────────

describe('parseRefinedPrompts — negative_constraints', () => {
  it('negative_constraints is an array (not a string)', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    for (const scene of result) {
      assert.ok(
        Array.isArray(scene.negative_constraints),
        `Scene ${scene.scene_number} negative_constraints should be an array`
      );
    }
  });

  it('SCENE_01 negative_constraints has multiple items', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    const s01 = result.find(s => s.scene_number === 1)!;
    assert.ok(
      s01.negative_constraints.length >= 3,
      `Expected >= 3 items, got ${s01.negative_constraints.length}`
    );
  });

  it('SCENE_01 negative_constraints includes "commercial logos"', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    const s01 = result.find(s => s.scene_number === 1)!;
    const found = s01.negative_constraints.some(c =>
      c.toLowerCase().includes('commercial logos')
    );
    assert.ok(found, 'Expected "commercial logos" in SCENE_01 negative_constraints');
  });
});

// ─── PUBLIC_SAFE_WORDING field ────────────────────────────────────────────────

describe('parseRefinedPrompts — public_safe_wording', () => {
  it('all scenes have non-empty public_safe_wording', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    for (const scene of result) {
      assert.ok(
        scene.public_safe_wording.length > 0,
        `Scene ${scene.scene_number} public_safe_wording is empty`
      );
    }
  });

  it('all public_safe_wording values mention "confirmed" or "safe"', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    for (const scene of result) {
      const lower = scene.public_safe_wording.toLowerCase();
      assert.ok(
        lower.includes('confirmed') || lower.includes('safe'),
        `Scene ${scene.scene_number} public_safe_wording should mention "confirmed" or "safe"`
      );
    }
  });
});

// ─── CONTINUITY_NOTE and VISUAL_EMPHASIS ─────────────────────────────────────

describe('parseRefinedPrompts — continuity_note and visual_emphasis', () => {
  it('all scenes have non-empty continuity_note', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    for (const scene of result) {
      assert.ok(
        scene.continuity_note.length > 0,
        `Scene ${scene.scene_number} continuity_note is empty`
      );
    }
  });

  it('all scenes have non-empty visual_emphasis', () => {
    const result = parseRefinedPrompts(FIXTURE_RAW, SOURCE_SCENES)!;
    for (const scene of result) {
      assert.ok(
        scene.visual_emphasis.length > 0,
        `Scene ${scene.scene_number} visual_emphasis is empty`
      );
    }
  });
});

// ─── Null / error cases ───────────────────────────────────────────────────────

describe('parseRefinedPrompts — null and error cases', () => {
  it('returns null for empty string', () => {
    const result = parseRefinedPrompts('', SOURCE_SCENES);
    assert.equal(result, null);
  });

  it('returns null for whitespace-only input', () => {
    const result = parseRefinedPrompts('   \n\t  ', SOURCE_SCENES);
    assert.equal(result, null);
  });

  it('returns null when no SCENE_NN_ sections found', () => {
    const result = parseRefinedPrompts('Some random text without any section markers.', SOURCE_SCENES);
    assert.equal(result, null);
  });

  it('skips scene block when grok_prompt is missing or too short', () => {
    const noPrompt = `=== SECTION === SCENE_01_GROK_PROMPT
short
=== SECTION === SCENE_01_DURATION_TARGET
10
=== SECTION === SCENE_01_ASPECT_RATIO
9:16
=== SECTION === SCENE_01_CONTINUITY_NOTE
Test
=== SECTION === SCENE_01_VISUAL_EMPHASIS
Test
=== SECTION === SCENE_01_NEGATIVE_CONSTRAINTS
none
=== SECTION === SCENE_01_PUBLIC_SAFE_WORDING
Safe.
`;
    const result = parseRefinedPrompts(noPrompt, SOURCE_SCENES);
    assert.equal(result, null, 'Should return null when only malformed scenes exist');
  });

  it('returns null for empty source scenes but still requires valid grok_prompt', () => {
    const result = parseRefinedPrompts('', []);
    assert.equal(result, null);
  });
});

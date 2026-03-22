/**
 * Tests for src/lib/suno/storage.ts
 *
 * Uses node:test + node:assert/strict (no external test framework).
 * Run with: npm run test:suno
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  saveSunoRun,
  loadSunoRun,
  deriveSunoStoredRun,
  parseDurationSeconds,
  validateStoredRun,
} from '../storage';
import { CRITICAL_RULES, WARN_RULES } from '../schema';
import type { SunoGenerationResult, SunoCandidate } from '../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeCandidateA(overrides: Partial<SunoCandidate> = {}): SunoCandidate {
  return {
    label: 'A',
    song_title: 'Jai Shri Ram — Candidate A',
    duration_raw: '3:42',
    duration_seconds: 222,
    style_prompt: 'devotional bhajan, harmonium, tabla, 80 BPM',
    song_id: 'abc123',
    audio_path: null,
    thumbnail_path: null,
    downloaded: false,
    ...overrides,
  };
}

function makeCandidateB(overrides: Partial<SunoCandidate> = {}): SunoCandidate {
  return {
    label: 'B',
    song_title: 'Jai Shri Ram — Candidate B',
    duration_raw: '3:38',
    duration_seconds: 218,
    style_prompt: 'devotional bhajan, harmonium, tabla, 80 BPM',
    song_id: 'def456',
    audio_path: null,
    thumbnail_path: null,
    downloaded: false,
    ...overrides,
  };
}

function makeResult(overrides: Partial<SunoGenerationResult> = {}): SunoGenerationResult {
  return {
    candidate_a: makeCandidateA({ downloaded: true }),
    candidate_b: makeCandidateB({ downloaded: true }),
    request_payload: {
      lyrics: '[Verse 1]\nRaghupati Raghava Raja Ram\nPatita Pavana Sita Ram',
      style_prompt: 'devotional bhajan, harmonium, tabla, 80 BPM, soulful female vocals',
      title: 'Jai Shri Ram',
      submitted_at: 1700000000000,
    },
    generated_at: 1700001000000,
    page_url: 'https://suno.com/create',
    warnings: [],
    ...overrides,
  };
}

// ─── Temp directory management ────────────────────────────────────────────────

let tmpDir: string;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-test-'));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeTmpSubdir(name: string): string {
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── parseDurationSeconds ─────────────────────────────────────────────────────

describe('parseDurationSeconds', () => {
  it('parses MM:SS format', () => {
    assert.equal(parseDurationSeconds('3:42'), 222);
  });

  it('parses single-digit minutes', () => {
    assert.equal(parseDurationSeconds('1:05'), 65);
  });

  it('parses HH:MM:SS format', () => {
    assert.equal(parseDurationSeconds('1:02:03'), 3723);
  });

  it('returns null for empty string', () => {
    assert.equal(parseDurationSeconds(''), null);
  });

  it('returns null for null input', () => {
    assert.equal(parseDurationSeconds(null), null);
  });

  it('returns null for non-numeric input', () => {
    assert.equal(parseDurationSeconds('abc'), null);
  });

  it('returns null for partial garbage like "3:zz"', () => {
    assert.equal(parseDurationSeconds('3:zz'), null);
  });

  it('returns null for single segment (no colon)', () => {
    assert.equal(parseDurationSeconds('180'), null);
  });

  it('trims whitespace before parsing', () => {
    assert.equal(parseDurationSeconds('  2:30  '), 150);
  });
});

// ─── saveSunoRun ──────────────────────────────────────────────────────────────

describe('saveSunoRun', () => {
  it('creates run directory and writes metadata JSON', () => {
    const dir = makeTmpSubdir('save-basic');
    const result = makeResult();
    const stored = saveSunoRun(result, dir);

    assert.ok(fs.existsSync(stored.metadata_path));
    assert.equal(stored.run_dir, dir);
  });

  it('writes request payload as a separate JSON file', () => {
    const dir = makeTmpSubdir('save-payload');
    const result = makeResult();
    const stored = saveSunoRun(result, dir);

    assert.ok(fs.existsSync(stored.request_payload_path));

    const raw = JSON.parse(fs.readFileSync(stored.request_payload_path, 'utf-8')) as {
      lyrics: string;
      title: string;
    };
    assert.equal(raw.lyrics, result.request_payload.lyrics);
    assert.equal(raw.title, result.request_payload.title);
  });

  it('metadata JSON round-trips to identical object', () => {
    const dir = makeTmpSubdir('save-roundtrip');
    const result = makeResult({ warnings: ['test warning'] });
    saveSunoRun(result, dir);

    const loaded = JSON.parse(
      fs.readFileSync(path.join(dir, 'suno_metadata.json'), 'utf-8')
    ) as SunoGenerationResult;

    assert.equal(loaded.candidate_a.song_title, result.candidate_a.song_title);
    assert.equal(loaded.candidate_b.song_title, result.candidate_b.song_title);
    assert.equal(loaded.generated_at, result.generated_at);
    assert.deepEqual(loaded.warnings, ['test warning']);
  });

  it('marks audio paths as null when files do not exist on disk', () => {
    const dir = makeTmpSubdir('save-no-audio');
    const result = makeResult();
    const stored = saveSunoRun(result, dir);

    assert.equal(stored.candidate_a_audio, null);
    assert.equal(stored.candidate_b_audio, null);
  });

  it('marks audio paths as present when the file exists on disk', () => {
    const dir = makeTmpSubdir('save-with-audio');
    const audioDir = path.join(dir, 'audio');
    fs.mkdirSync(audioDir, { recursive: true });

    // Create dummy audio files
    const audioA = path.join(audioDir, 'suno_candidate_a.mp3');
    const audioB = path.join(audioDir, 'suno_candidate_b.mp3');
    fs.writeFileSync(audioA, Buffer.from('FAKE_MP3_A'));
    fs.writeFileSync(audioB, Buffer.from('FAKE_MP3_B'));

    const result = makeResult({
      candidate_a: makeCandidateA({ downloaded: true, audio_path: audioA }),
      candidate_b: makeCandidateB({ downloaded: true, audio_path: audioB }),
    });

    const stored = saveSunoRun(result, dir);
    assert.equal(stored.candidate_a_audio, audioA);
    assert.equal(stored.candidate_b_audio, audioB);
  });

  it('marks screenshot path as present when the file exists on disk', () => {
    const dir = makeTmpSubdir('save-with-screenshot');
    const screenshotPath = path.join(dir, 'suno_candidates.png');
    fs.writeFileSync(screenshotPath, Buffer.from('FAKE_PNG'));

    const result = makeResult();
    const stored = saveSunoRun(result, dir);

    assert.equal(stored.candidates_screenshot, screenshotPath);
  });

  it('creates runDir if it does not exist yet', () => {
    const dir = path.join(tmpDir, 'new', 'nested', 'dir');
    const result = makeResult();
    saveSunoRun(result, dir);
    assert.ok(fs.existsSync(dir));
  });
});

// ─── loadSunoRun ──────────────────────────────────────────────────────────────

describe('loadSunoRun', () => {
  it('returns null when the run directory does not exist', () => {
    const result = loadSunoRun(path.join(tmpDir, 'does-not-exist'));
    assert.equal(result, null);
  });

  it('returns null when metadata file is missing', () => {
    const dir = makeTmpSubdir('load-no-file');
    const result = loadSunoRun(dir);
    assert.equal(result, null);
  });

  it('returns null when metadata JSON is invalid', () => {
    const dir = makeTmpSubdir('load-invalid-json');
    fs.writeFileSync(path.join(dir, 'suno_metadata.json'), '{ not valid json }', 'utf-8');
    const result = loadSunoRun(dir);
    assert.equal(result, null);
  });

  it('returns null when metadata does not match the schema', () => {
    const dir = makeTmpSubdir('load-bad-schema');
    fs.writeFileSync(
      path.join(dir, 'suno_metadata.json'),
      JSON.stringify({ foo: 'bar' }),
      'utf-8'
    );
    const result = loadSunoRun(dir);
    assert.equal(result, null);
  });

  it('returns the original result after save+load round-trip', () => {
    const dir = makeTmpSubdir('load-roundtrip');
    const original = makeResult({ warnings: ['a warning'] });
    saveSunoRun(original, dir);

    const loaded = loadSunoRun(dir);
    assert.ok(loaded !== null);
    assert.equal(loaded!.candidate_a.song_id, 'abc123');
    assert.equal(loaded!.candidate_b.song_id, 'def456');
    assert.equal(loaded!.generated_at, original.generated_at);
    assert.deepEqual(loaded!.warnings, ['a warning']);
  });
});

// ─── deriveSunoStoredRun ──────────────────────────────────────────────────────

describe('deriveSunoStoredRun', () => {
  it('returns null paths when no files exist', () => {
    const dir = makeTmpSubdir('derive-empty');
    const result = makeResult();
    const stored = deriveSunoStoredRun(result, dir);

    assert.equal(stored.candidate_a_audio, null);
    assert.equal(stored.candidate_b_audio, null);
    assert.equal(stored.candidates_screenshot, null);
  });

  it('returns correct paths when audio files exist', () => {
    const dir = makeTmpSubdir('derive-with-audio');
    const audioDir = path.join(dir, 'audio');
    fs.mkdirSync(audioDir);

    const audioA = path.join(audioDir, 'suno_candidate_a.mp3');
    fs.writeFileSync(audioA, Buffer.from('A'));

    const result = makeResult({
      candidate_a: makeCandidateA({ audio_path: audioA }),
    });
    const stored = deriveSunoStoredRun(result, dir);

    assert.equal(stored.candidate_a_audio, audioA);
    assert.equal(stored.candidate_b_audio, null);
  });
});

// ─── validateStoredRun ────────────────────────────────────────────────────────

describe('validateStoredRun', () => {
  it('returns valid: true for a well-formed stored run', () => {
    const stored = {
      run_dir: '/tmp/test',
      metadata_path: '/tmp/test/suno_metadata.json',
      request_payload_path: '/tmp/test/suno_request_payload.json',
      candidate_a_audio: null,
      candidate_b_audio: null,
      candidate_a_thumbnail: null,
      candidate_b_thumbnail: null,
      candidates_screenshot: null,
    };
    const result = validateStoredRun(stored);
    assert.ok(result.valid);
  });

  it('returns valid: false and errors for missing required fields', () => {
    const result = validateStoredRun({ run_dir: '/tmp/test' });
    assert.ok(!result.valid);
    assert.ok(!result.valid && result.errors.length > 0);
  });

  it('returns valid: false for entirely wrong type', () => {
    const result = validateStoredRun('not an object');
    assert.ok(!result.valid);
  });
});

// ─── CRITICAL_RULES ───────────────────────────────────────────────────────────

describe('CRITICAL_RULES', () => {
  it('passes when both candidates are present and at least one is downloaded', () => {
    const result = makeResult({
      candidate_a: makeCandidateA({ downloaded: true }),
      candidate_b: makeCandidateB({ downloaded: false }),
    });
    for (const rule of CRITICAL_RULES) {
      assert.ok(rule.check(result), `Critical rule "${rule.field}" should pass`);
    }
  });

  it('fails candidates_present when both titles are empty', () => {
    const result = makeResult({
      candidate_a: makeCandidateA({ song_title: '   ' }),
      candidate_b: makeCandidateB({ song_title: '' }),
    });
    const rule = CRITICAL_RULES.find((r) => r.field === 'candidates_present')!;
    assert.ok(!rule.check(result));
  });

  it('fails at_least_one_downloaded when neither candidate downloaded', () => {
    const result = makeResult({
      candidate_a: makeCandidateA({ downloaded: false }),
      candidate_b: makeCandidateB({ downloaded: false }),
    });
    const rule = CRITICAL_RULES.find((r) => r.field === 'at_least_one_downloaded')!;
    assert.ok(!rule.check(result));
  });

  it('produces a descriptive message on failure', () => {
    const result = makeResult({
      candidate_a: makeCandidateA({ downloaded: false }),
      candidate_b: makeCandidateB({ downloaded: false }),
    });
    const rule = CRITICAL_RULES.find((r) => r.field === 'at_least_one_downloaded')!;
    const msg = rule.message(result);
    assert.ok(msg.length > 0);
    assert.ok(msg.toLowerCase().includes('download'));
  });
});

// ─── WARN_RULES ───────────────────────────────────────────────────────────────

describe('WARN_RULES', () => {
  it('warns when only one candidate is downloaded', () => {
    const result = makeResult({
      candidate_a: makeCandidateA({ downloaded: true }),
      candidate_b: makeCandidateB({ downloaded: false }),
    });
    const rule = WARN_RULES.find((r) => r.field === 'both_candidates_downloaded')!;
    assert.ok(!rule.check(result));
    const msg = rule.message(result);
    assert.ok(msg.includes('1/2'));
  });

  it('passes both_candidates_downloaded when both are downloaded', () => {
    const result = makeResult({
      candidate_a: makeCandidateA({ downloaded: true }),
      candidate_b: makeCandidateB({ downloaded: true }),
    });
    const rule = WARN_RULES.find((r) => r.field === 'both_candidates_downloaded')!;
    assert.ok(rule.check(result));
  });

  it('warns when candidate A duration is null', () => {
    const result = makeResult({
      candidate_a: makeCandidateA({ duration_seconds: null }),
    });
    const rule = WARN_RULES.find((r) => r.field === 'candidate_a_duration')!;
    assert.ok(!rule.check(result));
  });

  it('warns when style prompt is too short', () => {
    const result = makeResult({
      request_payload: {
        ...makeResult().request_payload,
        style_prompt: 'pop',
      },
    });
    const rule = WARN_RULES.find((r) => r.field === 'style_prompt_length')!;
    assert.ok(!rule.check(result));
  });

  it('passes style_prompt_length for a sufficiently detailed prompt', () => {
    const result = makeResult();
    const rule = WARN_RULES.find((r) => r.field === 'style_prompt_length')!;
    assert.ok(rule.check(result));
  });

  it('warns when neither candidate has a song_id', () => {
    const result = makeResult({
      candidate_a: makeCandidateA({ song_id: null }),
      candidate_b: makeCandidateB({ song_id: null }),
    });
    const rule = WARN_RULES.find((r) => r.field === 'song_ids_captured')!;
    assert.ok(!rule.check(result));
  });

  it('passes song_ids_captured when at least one has a song_id', () => {
    const result = makeResult({
      candidate_a: makeCandidateA({ song_id: 'abc123' }),
      candidate_b: makeCandidateB({ song_id: null }),
    });
    const rule = WARN_RULES.find((r) => r.field === 'song_ids_captured')!;
    assert.ok(rule.check(result));
  });
});

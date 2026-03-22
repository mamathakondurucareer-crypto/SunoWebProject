/**
 * Tests for src/lib/chatgpt-eval/parser.ts
 *
 * Uses node:test + node:assert/strict (no external test framework).
 * Run with: npm run test:eval
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import { parseCandidateAnalysis, parseComparisonResult } from '../parser';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
}

const ANALYSIS_A_RAW = readFixture('analysis-a-response.txt');
const ANALYSIS_B_RAW = readFixture('analysis-b-response.txt');
const COMPARISON_RAW = readFixture('comparison-response.txt');

// ─── parseCandidateAnalysis — Candidate A ─────────────────────────────────────

describe('parseCandidateAnalysis — Candidate A', () => {
  it('returns a non-null result for valid A fixture', () => {
    const result = parseCandidateAnalysis(ANALYSIS_A_RAW, 'A');
    assert.ok(result !== null);
  });

  it('sets label to A', () => {
    const result = parseCandidateAnalysis(ANALYSIS_A_RAW, 'A')!;
    assert.equal(result.label, 'A');
  });

  it('parses overall_score as 8.2', () => {
    const result = parseCandidateAnalysis(ANALYSIS_A_RAW, 'A')!;
    assert.equal(result.overall_score, 8.2);
  });

  it('parses pronunciation_accuracy score as 8', () => {
    const result = parseCandidateAnalysis(ANALYSIS_A_RAW, 'A')!;
    assert.equal(result.pronunciation_accuracy.score, 8);
  });

  it('parses hook_strength score as 9', () => {
    const result = parseCandidateAnalysis(ANALYSIS_A_RAW, 'A')!;
    assert.equal(result.hook_strength.score, 9);
  });

  it('parses viral_proxy_score score as 7', () => {
    const result = parseCandidateAnalysis(ANALYSIS_A_RAW, 'A')!;
    assert.equal(result.viral_proxy_score.score, 7);
  });

  it('includes non-empty rationale for pronunciation_accuracy', () => {
    const result = parseCandidateAnalysis(ANALYSIS_A_RAW, 'A')!;
    assert.ok(result.pronunciation_accuracy.rationale.length > 10);
  });

  it('includes non-empty notes', () => {
    const result = parseCandidateAnalysis(ANALYSIS_A_RAW, 'A')!;
    assert.ok(result.notes.length > 10);
  });

  it('parses all 7 dimensions with scores in 1–10 range', () => {
    const result = parseCandidateAnalysis(ANALYSIS_A_RAW, 'A')!;
    const dims = [
      result.pronunciation_accuracy.score,
      result.lyric_intelligibility.score,
      result.hook_strength.score,
      result.chorus_impact.score,
      result.musical_quality.score,
      result.viral_proxy_score.score,
      result.visual_sync_potential.score,
    ];
    for (const s of dims) {
      assert.ok(s >= 1 && s <= 10, `score ${s} is outside 1-10 range`);
    }
  });
});

// ─── parseCandidateAnalysis — Candidate B ─────────────────────────────────────

describe('parseCandidateAnalysis — Candidate B', () => {
  it('returns a non-null result for valid B fixture', () => {
    const result = parseCandidateAnalysis(ANALYSIS_B_RAW, 'B');
    assert.ok(result !== null);
  });

  it('sets label to B', () => {
    const result = parseCandidateAnalysis(ANALYSIS_B_RAW, 'B')!;
    assert.equal(result.label, 'B');
  });

  it('parses overall_score as 7.1', () => {
    const result = parseCandidateAnalysis(ANALYSIS_B_RAW, 'B')!;
    assert.equal(result.overall_score, 7.1);
  });

  it('parses viral_proxy_score as 6', () => {
    const result = parseCandidateAnalysis(ANALYSIS_B_RAW, 'B')!;
    assert.equal(result.viral_proxy_score.score, 6);
  });
});

// ─── parseCandidateAnalysis — Error cases ────────────────────────────────────

describe('parseCandidateAnalysis — error cases', () => {
  it('returns null for empty string', () => {
    assert.equal(parseCandidateAnalysis('', 'A'), null);
  });

  it('returns null when OVERALL_SCORE section is missing', () => {
    const stripped = ANALYSIS_A_RAW.replace(
      /=== SECTION === OVERALL_SCORE[\s\S]*?(?==== SECTION ===|$)/,
      ''
    );
    assert.equal(parseCandidateAnalysis(stripped, 'A'), null);
  });

  it('returns null when a dimension score section is missing', () => {
    const stripped = ANALYSIS_A_RAW.replace(
      /=== SECTION === HOOK_STRENGTH_SCORE[\s\S]*?(?==== SECTION ===|$)/,
      ''
    );
    assert.equal(parseCandidateAnalysis(stripped, 'A'), null);
  });

  it('returns null when score is not numeric', () => {
    const corrupted = ANALYSIS_A_RAW.replace(
      /=== SECTION === OVERALL_SCORE\n8\.2/,
      '=== SECTION === OVERALL_SCORE\nnot-a-number'
    );
    assert.equal(parseCandidateAnalysis(corrupted, 'A'), null);
  });

  it('clamps score above 10 to 10', () => {
    const clamped = ANALYSIS_A_RAW.replace(
      /=== SECTION === OVERALL_SCORE\n8\.2/,
      '=== SECTION === OVERALL_SCORE\n15'
    );
    const result = parseCandidateAnalysis(clamped, 'A');
    assert.ok(result !== null);
    assert.equal(result!.overall_score, 10);
  });

  it('clamps score below 1 to 1', () => {
    const clamped = ANALYSIS_A_RAW.replace(
      /=== SECTION === OVERALL_SCORE\n8\.2/,
      '=== SECTION === OVERALL_SCORE\n0'
    );
    const result = parseCandidateAnalysis(clamped, 'A');
    assert.ok(result !== null);
    assert.equal(result!.overall_score, 1);
  });
});

// ─── parseComparisonResult — Valid fixture ────────────────────────────────────

describe('parseComparisonResult — valid fixture', () => {
  it('returns a non-null result', () => {
    const result = parseComparisonResult(COMPARISON_RAW);
    assert.ok(result !== null);
  });

  it('parses winner as A', () => {
    const result = parseComparisonResult(COMPARISON_RAW)!;
    assert.equal(result.winner, 'A');
  });

  it('parses score_delta as 1.1', () => {
    const result = parseComparisonResult(COMPARISON_RAW)!;
    assert.equal(result.score_delta, 1.1);
  });

  it('parses confidence as high', () => {
    const result = parseComparisonResult(COMPARISON_RAW)!;
    assert.equal(result.confidence, 'high');
  });

  it('includes non-empty decision_rationale', () => {
    const result = parseComparisonResult(COMPARISON_RAW)!;
    assert.ok(result.decision_rationale.length > 10);
  });

  it('parses candidate_a_strengths as a non-empty array', () => {
    const result = parseComparisonResult(COMPARISON_RAW)!;
    assert.ok(result.candidate_a_strengths.length > 0);
  });

  it('parses candidate_b_strengths as a non-empty array', () => {
    const result = parseComparisonResult(COMPARISON_RAW)!;
    assert.ok(result.candidate_b_strengths.length > 0);
  });

  it('strips bullet prefix from strengths items', () => {
    const result = parseComparisonResult(COMPARISON_RAW)!;
    for (const s of [...result.candidate_a_strengths, ...result.candidate_b_strengths]) {
      assert.ok(!s.startsWith('-'), `Strength item should not start with '-': "${s}"`);
    }
  });

  it('parses caveats as "none"', () => {
    const result = parseComparisonResult(COMPARISON_RAW)!;
    assert.equal(result.caveats, 'none');
  });
});

// ─── parseComparisonResult — Special winners ─────────────────────────────────

describe('parseComparisonResult — special winner values', () => {
  function makeComparisonWith(winner: string): string {
    return COMPARISON_RAW.replace(/=== SECTION === WINNER\nA/, `=== SECTION === WINNER\n${winner}`);
  }

  it('accepts "B" as winner', () => {
    const result = parseComparisonResult(makeComparisonWith('B'))!;
    assert.equal(result?.winner, 'B');
  });

  it('accepts "tie" as winner', () => {
    const result = parseComparisonResult(makeComparisonWith('tie'))!;
    assert.equal(result?.winner, 'tie');
  });

  it('accepts "manual_review_required" as winner', () => {
    const result = parseComparisonResult(makeComparisonWith('manual_review_required'))!;
    assert.equal(result?.winner, 'manual_review_required');
  });

  it('returns null for an unknown winner value', () => {
    const result = parseComparisonResult(makeComparisonWith('candidate_c'));
    assert.equal(result, null);
  });
});

// ─── parseComparisonResult — Error cases ─────────────────────────────────────

describe('parseComparisonResult — error cases', () => {
  it('returns null for empty string', () => {
    assert.equal(parseComparisonResult(''), null);
  });

  it('returns null when WINNER section is missing', () => {
    const stripped = COMPARISON_RAW.replace(
      /=== SECTION === WINNER[\s\S]*?(?==== SECTION ===|$)/,
      ''
    );
    assert.equal(parseComparisonResult(stripped), null);
  });

  it('returns null when SCORE_DELTA is not numeric', () => {
    const corrupted = COMPARISON_RAW.replace(
      /=== SECTION === SCORE_DELTA\n1\.1/,
      '=== SECTION === SCORE_DELTA\nnot-a-number'
    );
    assert.equal(parseComparisonResult(corrupted), null);
  });

  it('returns null when CONFIDENCE is invalid', () => {
    const corrupted = COMPARISON_RAW.replace(
      /=== SECTION === CONFIDENCE\nhigh/,
      '=== SECTION === CONFIDENCE\nvery-high'
    );
    assert.equal(parseComparisonResult(corrupted), null);
  });

  it('returns null when DECISION_RATIONALE is missing', () => {
    const stripped = COMPARISON_RAW.replace(
      /=== SECTION === DECISION_RATIONALE[\s\S]*?(?==== SECTION ===|$)/,
      ''
    );
    assert.equal(parseComparisonResult(stripped), null);
  });
});

// ─── score_delta rounding ─────────────────────────────────────────────────────

describe('parseComparisonResult — score_delta rounding', () => {
  it('rounds score_delta to 2 decimal places', () => {
    const raw = COMPARISON_RAW.replace(
      /=== SECTION === SCORE_DELTA\n1\.1/,
      '=== SECTION === SCORE_DELTA\n1.23456'
    );
    const result = parseComparisonResult(raw)!;
    assert.equal(result.score_delta, 1.23);
  });

  it('handles negative score_delta', () => {
    const raw = COMPARISON_RAW.replace(
      /=== SECTION === SCORE_DELTA\n1\.1/,
      '=== SECTION === SCORE_DELTA\n-0.5'
    );
    const result = parseComparisonResult(raw)!;
    assert.equal(result.score_delta, -0.5);
  });
});

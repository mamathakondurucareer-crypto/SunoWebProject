/**
 * Parser unit tests — run with:
 *   node --require tsx/cjs --test src/lib/gemini/__tests__/parser.test.ts
 * or via package.json script:
 *   npm run test:gemini
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseGeminiOutput,
  extractSections,
  parseLyricSections,
  parseScenePlan,
  parseSeoMetadata,
  parseRiskReview,
  parseCtas,
  parseThumbnailConcepts,
  extractJsonBlock,
} from '../parser';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const prose   = fs.readFileSync(path.join(FIXTURE_DIR, 'prose-response.txt'),   'utf-8');
const jsonEmb = fs.readFileSync(path.join(FIXTURE_DIR, 'json-response.txt'),    'utf-8');
const partial = fs.readFileSync(path.join(FIXTURE_DIR, 'partial-response.txt'), 'utf-8');

// ─── extractSections ─────────────────────────────────────────────────────────

describe('extractSections', () => {
  test('extracts all 12 sections from the prose fixture', () => {
    const map = extractSections(prose);
    const expectedKeys = [
      'SONG TITLE',
      'LYRICS',
      'STYLE NOTES',
      'VOCAL GUIDANCE',
      'SUNO STYLE PROMPT',
      'BACKGROUND',
      'SCENE PLAN',
      'THUMBNAIL CONCEPTS',
      'SEO METADATA',
      'SHORTS/REELS CTA',
      'RISK REVIEW',
      'COMPLETENESS AUDIT',
    ];
    for (const key of expectedKeys) {
      assert.ok(map.has(key), `Missing section: ${key}`);
      assert.ok((map.get(key) ?? '').length > 0, `Section is empty: ${key}`);
    }
  });

  test('returns empty map for text with no === delimiters', () => {
    const map = extractSections('No sections here at all');
    assert.equal(map.size, 0);
  });

  test('handles extra whitespace around section names', () => {
    const map = extractSections('===  SONG TITLE  ===\nMy Song');
    assert.ok(map.has('SONG TITLE'));
    assert.equal(map.get('SONG TITLE'), 'My Song');
  });
});

// ─── parseLyricSections ───────────────────────────────────────────────────────

describe('parseLyricSections', () => {
  test('identifies verse, chorus, bridge, outro from bracket-style labels', () => {
    const text = `
[Verse 1]
Line one of verse
Line two of verse

[Chorus]
Chorus line one
Chorus line two

[Bridge]
Bridge line here

[Outro]
Outro line here
`.trim();
    const sections = parseLyricSections(text);
    const types = sections.map(s => s.type);
    assert.ok(types.includes('verse'),  'should have verse');
    assert.ok(types.includes('chorus'), 'should have chorus');
    assert.ok(types.includes('bridge'), 'should have bridge');
    assert.ok(types.includes('outro'),  'should have outro');
  });

  test('parses the prose fixture lyrics into at least 5 sections', () => {
    const map = extractSections(prose);
    const sections = parseLyricSections(map.get('LYRICS') ?? '');
    assert.ok(sections.length >= 5, `Expected ≥ 5 sections, got ${sections.length}`);
  });

  test('each section has at least one non-empty line', () => {
    const map = extractSections(prose);
    const sections = parseLyricSections(map.get('LYRICS') ?? '');
    for (const s of sections) {
      assert.ok(s.lines.length >= 1, `Section "${s.label}" has no lines`);
      for (const line of s.lines) {
        assert.ok(line.trim().length > 0, `Empty line in section "${s.label}"`);
      }
    }
  });

  test('recognises labels with trailing colon: "Chorus:"', () => {
    const text = 'Chorus:\nLine one\nLine two';
    const sections = parseLyricSections(text);
    assert.equal(sections[0]?.type, 'chorus');
  });

  test('recognises labels without brackets: "Verse 1"', () => {
    const text = 'Verse 1\nA line here\nAnother line';
    const sections = parseLyricSections(text);
    assert.equal(sections[0]?.type, 'verse');
  });

  test('identifies pre-chorus', () => {
    const text = '[Pre-Chorus]\nBuilding up now\nReady to fly';
    const sections = parseLyricSections(text);
    assert.equal(sections[0]?.type, 'pre-chorus');
  });
});

// ─── parseScenePlan ───────────────────────────────────────────────────────────

describe('parseScenePlan', () => {
  test('parses 7 scenes with timing from prose fixture', () => {
    const map = extractSections(prose);
    const scenes = parseScenePlan(map.get('SCENE PLAN') ?? '');
    assert.equal(scenes.length, 7);
  });

  test('extracts start and end seconds', () => {
    const text = 'Scene 1 (0-10s): A sunrise over the hills';
    const scenes = parseScenePlan(text);
    assert.equal(scenes[0]?.start_seconds, 0);
    assert.equal(scenes[0]?.end_seconds,   10);
  });

  test('handles em-dash timing: (10–20s)', () => {
    const text = 'Scene 2 (10–20s): Wide shot of the congregation';
    const scenes = parseScenePlan(text);
    assert.equal(scenes[0]?.start_seconds, 10);
    assert.equal(scenes[0]?.end_seconds,   20);
  });

  test('parses bullet-style scenes with auto-numbering', () => {
    const text = '- A figure in prayer\n- Wide aerial shot\n- Hands raised';
    const scenes = parseScenePlan(text);
    assert.equal(scenes.length, 3);
    assert.equal(scenes[0]?.scene_number, 1);
    assert.equal(scenes[1]?.scene_number, 2);
    assert.equal(scenes[0]?.start_seconds, null);
  });

  test('scene numbers are sequential from the prose fixture', () => {
    const map = extractSections(prose);
    const scenes = parseScenePlan(map.get('SCENE PLAN') ?? '');
    for (let i = 0; i < scenes.length; i++) {
      assert.equal(scenes[i]!.scene_number, i + 1);
    }
  });
});

// ─── parseSeoMetadata ─────────────────────────────────────────────────────────

describe('parseSeoMetadata', () => {
  test('extracts title, description, tags and hashtags from prose fixture', () => {
    const map = extractSections(prose);
    const seo = parseSeoMetadata(map.get('SEO METADATA') ?? '');
    assert.ok(seo.title.length > 0,       'title should be non-empty');
    assert.ok(seo.description.length > 0, 'description should be non-empty');
    assert.ok(seo.tags.length >= 5,       `expected ≥5 tags, got ${seo.tags.length}`);
    assert.ok(seo.hashtags.length >= 3,   `expected ≥3 hashtags, got ${seo.hashtags.length}`);
  });

  test('all hashtags start with #', () => {
    const map = extractSections(prose);
    const seo = parseSeoMetadata(map.get('SEO METADATA') ?? '');
    for (const h of seo.hashtags) {
      assert.ok(h.startsWith('#'), `Hashtag "${h}" does not start with #`);
    }
  });

  test('no tags carry a # prefix (they go into hashtags instead)', () => {
    const map = extractSections(prose);
    const seo = parseSeoMetadata(map.get('SEO METADATA') ?? '');
    for (const t of seo.tags) {
      assert.ok(!t.startsWith('#'), `Tag "${t}" should not have # prefix`);
    }
  });
});

// ─── parseRiskReview ─────────────────────────────────────────────────────────

describe('parseRiskReview', () => {
  test('extracts overall_risk as "low" from prose fixture', () => {
    const map = extractSections(prose);
    const risk = parseRiskReview(map.get('RISK REVIEW') ?? '');
    assert.equal(risk.overall_risk, 'low');
  });

  test('extracts doctrinal_accuracy text', () => {
    const map = extractSections(prose);
    const risk = parseRiskReview(map.get('RISK REVIEW') ?? '');
    assert.ok(risk.doctrinal_accuracy.length > 0);
  });

  test('maps "medium" risk text correctly', () => {
    const text = 'Doctrinal Accuracy: Some nuance needed.\nOverall Risk: medium';
    const risk = parseRiskReview(text);
    assert.equal(risk.overall_risk, 'medium');
  });

  test('maps "high" risk text correctly', () => {
    const text = 'Doctrinal Accuracy: Significant concerns.\nOverall Risk: high';
    const risk = parseRiskReview(text);
    assert.equal(risk.overall_risk, 'high');
  });

  test('returns "unknown" when no risk level is present', () => {
    const risk = parseRiskReview('Doctrinal Accuracy: Seems fine.');
    assert.equal(risk.overall_risk, 'unknown');
  });
});

// ─── parseCtas ────────────────────────────────────────────────────────────────

describe('parseCtas', () => {
  test('extracts 3 CTAs from prose fixture', () => {
    const map = extractSections(prose);
    const ctas = parseCtas(map.get('SHORTS/REELS CTA') ?? '');
    assert.equal(ctas.length, 3);
  });

  test('strips leading numbering "1. "', () => {
    const ctas = parseCtas('1. Subscribe today\n2. Share the love');
    assert.equal(ctas[0], 'Subscribe today');
    assert.equal(ctas[1], 'Share the love');
  });

  test('strips bullet markers "- " and "• "', () => {
    const ctas = parseCtas('- First CTA\n• Second CTA');
    assert.equal(ctas[0], 'First CTA');
    assert.equal(ctas[1], 'Second CTA');
  });
});

// ─── parseThumbnailConcepts ───────────────────────────────────────────────────

describe('parseThumbnailConcepts', () => {
  test('extracts 3 concepts from prose fixture', () => {
    const map = extractSections(prose);
    const thumbs = parseThumbnailConcepts(map.get('THUMBNAIL CONCEPTS') ?? '');
    assert.equal(thumbs.length, 3);
  });

  test('concept_number starts at 1', () => {
    const map = extractSections(prose);
    const thumbs = parseThumbnailConcepts(map.get('THUMBNAIL CONCEPTS') ?? '');
    assert.equal(thumbs[0]?.concept_number, 1);
  });

  test('falls back to bullet parsing when no "Thumbnail N:" prefix', () => {
    const text = '- Sunrise silhouette\n- Choir on stage\n- Close-up face';
    const thumbs = parseThumbnailConcepts(text);
    assert.equal(thumbs.length, 3);
  });
});

// ─── extractJsonBlock ─────────────────────────────────────────────────────────

describe('extractJsonBlock', () => {
  test('returns null for plain text with no JSON block', () => {
    assert.equal(extractJsonBlock('No code block here'), null);
  });

  test('extracts and parses a valid JSON block', () => {
    const text = 'Some text\n```json\n{"key": "value"}\n```\nMore text';
    const result = extractJsonBlock(text);
    assert.deepEqual(result, { key: 'value' });
  });

  test('returns the LAST json block when multiple are present', () => {
    const text = '```json\n{"n":1}\n```\n```json\n{"n":2}\n```';
    const result = extractJsonBlock(text);
    assert.deepEqual(result, { n: 2 });
  });

  test('returns null for an invalid JSON block', () => {
    const text = '```json\n{ not valid json }\n```';
    assert.equal(extractJsonBlock(text), null);
  });

  test('extracts structured data from json-embedded fixture', () => {
    const result = extractJsonBlock(jsonEmb);
    assert.ok(result !== null, 'should find JSON block');
    assert.ok(typeof result!['song_title'] === 'string');
    assert.ok(Array.isArray(result!['scene_plan']));
    const scenes = result!['scene_plan'] as unknown[];
    assert.equal(scenes.length, 7);
  });
});

// ─── parseGeminiOutput — full integration ─────────────────────────────────────

describe('parseGeminiOutput — prose fixture', () => {
  test('returns success: true', () => {
    const result = parseGeminiOutput(prose);
    assert.equal(result.success, true, `Errors: ${result.errors.join('; ')}`);
  });

  test('extracts correct song title', () => {
    const { data } = parseGeminiOutput(prose);
    assert.ok(data?.song_title.includes('Amazing Grace'));
  });

  test('lyric_sections has ≥ 5 entries', () => {
    const { data } = parseGeminiOutput(prose);
    assert.ok((data?.lyric_sections.length ?? 0) >= 5);
  });

  test('scene_plan has 7 scenes', () => {
    const { data } = parseGeminiOutput(prose);
    assert.equal(data?.scene_plan.length, 7);
  });

  test('seo.tags has ≥ 5 entries', () => {
    const { data } = parseGeminiOutput(prose);
    assert.ok((data?.seo.tags.length ?? 0) >= 5);
  });

  test('seo.hashtags all begin with #', () => {
    const { data } = parseGeminiOutput(prose);
    for (const h of data?.seo.hashtags ?? []) {
      assert.ok(h.startsWith('#'), `"${h}" missing # prefix`);
    }
  });

  test('risk_review.overall_risk is "low"', () => {
    const { data } = parseGeminiOutput(prose);
    assert.equal(data?.risk_review.overall_risk, 'low');
  });

  test('completeness.score is 100', () => {
    const { data } = parseGeminiOutput(prose);
    assert.equal(data?.completeness.score, 100);
  });

  test('completeness.missing is empty', () => {
    const { data } = parseGeminiOutput(prose);
    assert.deepEqual(data?.completeness.missing, []);
  });

  test('source is "prose"', () => {
    const { data } = parseGeminiOutput(prose);
    assert.equal(data?.source, 'prose');
  });

  test('no parse errors', () => {
    const { errors } = parseGeminiOutput(prose);
    assert.deepEqual(errors, []);
  });

  test('parse_warnings is an array (may be empty)', () => {
    const { data } = parseGeminiOutput(prose);
    assert.ok(Array.isArray(data?.parse_warnings));
  });
});

describe('parseGeminiOutput — JSON-embedded fixture', () => {
  test('returns success: true', () => {
    const result = parseGeminiOutput(jsonEmb);
    assert.equal(result.success, true, `Errors: ${result.errors.join('; ')}`);
  });

  test('source is "json" or "mixed"', () => {
    const { data } = parseGeminiOutput(jsonEmb);
    assert.ok(
      data?.source === 'json' || data?.source === 'mixed',
      `Expected json or mixed, got ${data?.source}`
    );
  });

  test('JSON-sourced lyric sections include verse and chorus', () => {
    const { data } = parseGeminiOutput(jsonEmb);
    const types = data?.lyric_sections.map(s => s.type) ?? [];
    assert.ok(types.includes('verse'),  'should have verse');
    assert.ok(types.includes('chorus'), 'should have chorus');
  });

  test('JSON-sourced scene_plan has 7 scenes', () => {
    const { data } = parseGeminiOutput(jsonEmb);
    assert.equal(data?.scene_plan.length, 7);
  });

  test('JSON-sourced thumbnail_concepts has 3 entries', () => {
    const { data } = parseGeminiOutput(jsonEmb);
    assert.equal(data?.thumbnail_concepts.length, 3);
  });

  test('JSON-sourced seo.tags has ≥ 5 entries', () => {
    const { data } = parseGeminiOutput(jsonEmb);
    assert.ok((data?.seo.tags.length ?? 0) >= 5);
  });

  test('JSON-sourced shorts_reels_cta has 3 entries', () => {
    const { data } = parseGeminiOutput(jsonEmb);
    assert.equal(data?.shorts_reels_cta.length, 3);
  });
});

describe('parseGeminiOutput — partial fixture (missing sections)', () => {
  test('returns success: false due to missing scene plan', () => {
    const result = parseGeminiOutput(partial);
    assert.equal(result.success, false);
  });

  test('errors mention scene_plan', () => {
    const { errors } = parseGeminiOutput(partial);
    const hasSceneError = errors.some(e => e.toLowerCase().includes('scene'));
    assert.ok(hasSceneError, `Expected scene error, got: ${errors.join('; ')}`);
  });

  test('data is still populated on failure (partial parse)', () => {
    const { data } = parseGeminiOutput(partial);
    assert.ok(data !== undefined, 'data should be returned even on failure');
    assert.ok(data!.song_title.length > 0, 'song_title should be extracted');
  });

  test('completeness.missing includes expected sections', () => {
    const { data } = parseGeminiOutput(partial);
    const missing = data?.completeness.missing ?? [];
    assert.ok(missing.includes('Scene Plan'),       `expected "Scene Plan" in missing: ${missing}`);
    assert.ok(missing.includes('Thumbnails'),       `expected "Thumbnails" in missing: ${missing}`);
    assert.ok(missing.includes('SEO Metadata'),     `expected "SEO Metadata" in missing: ${missing}`);
    assert.ok(missing.includes('Shorts/Reels CTA'), `expected "Shorts/Reels CTA" in missing: ${missing}`);
  });

  test('warnings array has entries for missing sections', () => {
    const result = parseGeminiOutput(partial);
    assert.ok(result.warnings.length > 0, 'should have warnings for missing sections');
  });

  test('valid sections are still parsed correctly', () => {
    const { data } = parseGeminiOutput(partial);
    assert.ok(data?.song_title.includes('His Mercy Endures'));
    assert.ok((data?.lyric_sections.length ?? 0) >= 2);
    assert.equal(data?.risk_review.overall_risk, 'unknown');
  });
});

describe('parseGeminiOutput — edge cases', () => {
  test('empty string → success: false', () => {
    const result = parseGeminiOutput('');
    assert.equal(result.success, false);
    assert.ok(result.errors.length > 0);
  });

  test('only a song title → success: false (missing lyrics, scene plan, etc.)', () => {
    const result = parseGeminiOutput('=== SONG TITLE ===\nMy Song');
    assert.equal(result.success, false);
  });

  test('parsed_at is a recent timestamp', () => {
    const before = Date.now();
    const { data } = parseGeminiOutput(prose);
    const after = Date.now();
    assert.ok(data!.parsed_at >= before);
    assert.ok(data!.parsed_at <= after);
  });

  test('lyrics_raw is preserved exactly (no normalisation beyond whitespace)', () => {
    const { data } = parseGeminiOutput(prose);
    // The raw lyrics should contain the original bracket labels
    assert.ok(data?.lyrics_raw.includes('[Verse 1]'));
    assert.ok(data?.lyrics_raw.includes('[Chorus]'));
  });
});

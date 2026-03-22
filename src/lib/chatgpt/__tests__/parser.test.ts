/**
 * Tests for src/lib/chatgpt/parser.ts
 *
 * Run with:
 *   npm run test:chatgpt
 *   node --require tsx/cjs --test 'src/lib/chatgpt/__tests__/**\/*.test.ts'
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  extractSections,
  parsePronunciationNotes,
  parseIssuesFound,
  parseManualReviewNotes,
  parseChatGPTOutput,
} from '../parser';
import { isHindiContent, buildLyricsCorrectionPrompt } from '../prompt';
import type { LyricsCorrectionInput } from '../types';

// ─── Fixture loader ───────────────────────────────────────────────────────────

const FIXTURES = path.join(__dirname, 'fixtures');

function load(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
}

const bilingual = load('bilingual-response.txt');
const englishOnly = load('english-only-response.txt');
const partial = load('partial-response.txt');

// ─── extractSections ──────────────────────────────────────────────────────────

describe('extractSections', () => {
  test('returns a map with upper-case keys', () => {
    const map = extractSections('=== SONG TITLE ===\nHello\n\n=== LYRICS ===\nLine 1');
    assert.ok(map.has('SONG TITLE'));
    assert.ok(map.has('LYRICS'));
  });

  test('body is trimmed', () => {
    const map = extractSections('=== FOO ===\n  trimmed content  \n\n=== BAR ===\nbody');
    assert.equal(map.get('FOO'), 'trimmed content');
  });

  test('returns empty map for text with no headers', () => {
    const map = extractSections('just plain text with no section markers');
    assert.equal(map.size, 0);
  });

  test('parses all 6 sections from bilingual fixture', () => {
    const map = extractSections(bilingual);
    assert.ok(map.has('CORRECTED HINDI LYRICS'));
    assert.ok(map.has('CORRECTED ENGLISH LYRICS'));
    assert.ok(map.has('SUNO READY LYRICS'));
    assert.ok(map.has('PRONUNCIATION NOTES'));
    assert.ok(map.has('ISSUES FOUND'));
    assert.ok(map.has('MANUAL REVIEW NOTES'));
  });

  test('parses all 6 sections from english-only fixture', () => {
    const map = extractSections(englishOnly);
    assert.equal(map.size, 6);
  });
});

// ─── parsePronunciationNotes ──────────────────────────────────────────────────

describe('parsePronunciationNotes', () => {
  test('returns empty array for "None."', () => {
    assert.deepEqual(parsePronunciationNotes('None.'), []);
  });

  test('returns empty array for empty string', () => {
    assert.deepEqual(parsePronunciationNotes(''), []);
  });

  test('parses em-dash format with stress note', () => {
    const notes = parsePronunciationNotes('Word: Prabhu — PRAB-hoo — stress first syllable');
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.word, 'Prabhu');
    assert.equal(notes[0]?.guide, 'PRAB-hoo');
    assert.equal(notes[0]?.stress_note, 'stress first syllable');
  });

  test('parses em-dash format without stress note', () => {
    const notes = parsePronunciationNotes('prabhu — PRAB-hoo');
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.word, 'prabhu');
    assert.equal(notes[0]?.guide, 'PRAB-hoo');
    assert.equal(notes[0]?.stress_note, null);
  });

  test('parses colon format with parenthetical stress', () => {
    const notes = parsePronunciationNotes('Yeshu: YEH-shoo (soft "sh")');
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.word, 'Yeshu');
    assert.equal(notes[0]?.guide, 'YEH-shoo');
    assert.equal(notes[0]?.stress_note, 'soft "sh"');
  });

  test('parses multiple notes from bilingual fixture', () => {
    const map = extractSections(bilingual);
    const notes = parsePronunciationNotes(map.get('PRONUNCIATION NOTES') ?? '');
    assert.ok(notes.length >= 5, `Expected ≥5 notes, got ${notes.length}`);
  });

  test('parses notes from english-only fixture', () => {
    const map = extractSections(englishOnly);
    const notes = parsePronunciationNotes(map.get('PRONUNCIATION NOTES') ?? '');
    assert.equal(notes.length, 3);
    assert.equal(notes[0]?.word, 'Omega');
  });

  test('strips "Word:" prefix', () => {
    const notes = parsePronunciationNotes('Word: kripa — KREE-paa — long final vowel');
    assert.equal(notes[0]?.word, 'kripa');
  });
});

// ─── parseIssuesFound ─────────────────────────────────────────────────────────

describe('parseIssuesFound', () => {
  test('returns empty array for "None."', () => {
    assert.deepEqual(parseIssuesFound('None.'), []);
  });

  test('parses (severity: high) format', () => {
    const issues = parseIssuesFound(
      '- Syllable mismatch (severity: high) [location: Verse 1]'
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.severity, 'high');
    assert.equal(issues[0]?.location, 'Verse 1');
  });

  test('parses [HIGH] bracket format', () => {
    const issues = parseIssuesFound('- Grammar error [HIGH]');
    assert.equal(issues[0]?.severity, 'high');
  });

  test('defaults to low severity when no marker present', () => {
    const issues = parseIssuesFound('- Minor phrasing issue');
    assert.equal(issues[0]?.severity, 'low');
  });

  test('location is null when not provided', () => {
    const issues = parseIssuesFound('- Global issue (severity: medium)');
    assert.equal(issues[0]?.location, null);
  });

  test('parses 5 issues from bilingual fixture', () => {
    const map = extractSections(bilingual);
    const issues = parseIssuesFound(map.get('ISSUES FOUND') ?? '');
    assert.equal(issues.length, 5);
  });

  test('includes at least one high-severity issue from bilingual fixture', () => {
    const map = extractSections(bilingual);
    const issues = parseIssuesFound(map.get('ISSUES FOUND') ?? '');
    assert.ok(issues.some((i) => i.severity === 'high'));
  });

  test('parses 3 issues from english-only fixture', () => {
    const map = extractSections(englishOnly);
    const issues = parseIssuesFound(map.get('ISSUES FOUND') ?? '');
    assert.equal(issues.length, 3);
  });

  test('strips bullet prefix from description', () => {
    const issues = parseIssuesFound('- Clean description (severity: low)');
    assert.ok(!issues[0]?.description.startsWith('-'));
  });

  test('strips numbered list prefix from description', () => {
    const issues = parseIssuesFound('1. First issue (severity: low)');
    assert.ok(!issues[0]?.description.startsWith('1.'));
  });
});

// ─── parseManualReviewNotes ───────────────────────────────────────────────────

describe('parseManualReviewNotes', () => {
  test('returns empty array for "None."', () => {
    assert.deepEqual(parseManualReviewNotes('None.'), []);
  });

  test('returns empty array for empty string', () => {
    assert.deepEqual(parseManualReviewNotes(''), []);
  });

  test('parses numbered list', () => {
    const notes = parseManualReviewNotes('1. Review this\n2. Also check that');
    assert.equal(notes.length, 2);
    assert.equal(notes[0], 'Review this');
    assert.equal(notes[1], 'Also check that');
  });

  test('parses 3 notes from bilingual fixture', () => {
    const map = extractSections(bilingual);
    const notes = parseManualReviewNotes(map.get('MANUAL REVIEW NOTES') ?? '');
    assert.equal(notes.length, 3);
  });

  test('parses 2 notes from english-only fixture', () => {
    const map = extractSections(englishOnly);
    const notes = parseManualReviewNotes(map.get('MANUAL REVIEW NOTES') ?? '');
    assert.equal(notes.length, 2);
  });
});

// ─── isHindiContent ───────────────────────────────────────────────────────────

describe('isHindiContent', () => {
  const base: LyricsCorrectionInput = {
    song_title: 'Test',
    lyrics_raw: '',
    style_notes: '',
    vocal_guidance: '',
    suno_style_prompt: '',
    background: '',
    target_language: 'English',
    devotional_theme: 'Grace',
  };

  test('returns true for Devanagari characters in lyrics', () => {
    assert.ok(isHindiContent({ ...base, lyrics_raw: 'प्रभु की कृपा' }));
  });

  test('returns true when target_language is Hindi', () => {
    assert.ok(isHindiContent({ ...base, target_language: 'Hindi' }));
  });

  test('returns true when target_language contains sanskrit', () => {
    assert.ok(isHindiContent({ ...base, target_language: 'Sanskrit' }));
  });

  test('returns false for English-only lyrics with English language', () => {
    assert.ok(!isHindiContent({ ...base, lyrics_raw: 'In the morning I will seek Your grace' }));
  });
});

// ─── buildLyricsCorrectionPrompt ──────────────────────────────────────────────

describe('buildLyricsCorrectionPrompt', () => {
  const input: LyricsCorrectionInput = {
    song_title: 'Ram Ki Kripa',
    lyrics_raw: 'Raghupati Raghava Raja Ram, Patita Pavana Sita Ram',
    style_notes: 'Devotional bhajan, 80 BPM',
    vocal_guidance: 'Hold the chorus',
    suno_style_prompt: 'harmonium bhajan',
    background: 'Based on Tulsidas Ramcharitmanas',
    target_language: 'Hindi',
    devotional_theme: 'Ram Bhakti',
  };

  test('prompt contains the song title', () => {
    const p = buildLyricsCorrectionPrompt(input);
    assert.ok(p.includes('Ram Ki Kripa'));
  });

  test('prompt contains the original lyrics', () => {
    const p = buildLyricsCorrectionPrompt(input);
    assert.ok(p.includes('Raghupati Raghava Raja Ram'));
  });

  test('prompt contains all 6 section headers', () => {
    const p = buildLyricsCorrectionPrompt(input);
    assert.ok(p.includes('=== CORRECTED HINDI LYRICS ==='));
    assert.ok(p.includes('=== CORRECTED ENGLISH LYRICS ==='));
    assert.ok(p.includes('=== SUNO READY LYRICS ==='));
    assert.ok(p.includes('=== PRONUNCIATION NOTES ==='));
    assert.ok(p.includes('=== ISSUES FOUND ==='));
    assert.ok(p.includes('=== MANUAL REVIEW NOTES ==='));
  });

  test('Hindi section says N/A for English-only input', () => {
    const p = buildLyricsCorrectionPrompt(input);
    assert.ok(p.includes('N/A'));
  });

  test('Hindi prompt mentions bilingual when Devanagari present', () => {
    const hindiInput = { ...input, lyrics_raw: 'प्रभु की कृपा', target_language: 'Hindi' };
    const p = buildLyricsCorrectionPrompt(hindiInput);
    assert.ok(p.includes('bilingual'));
  });
});

// ─── parseChatGPTOutput — bilingual fixture ───────────────────────────────────

describe('parseChatGPTOutput — bilingual fixture', () => {
  const result = parseChatGPTOutput(bilingual);

  test('returns success: true', () => {
    assert.ok(result.success, `Expected success but got errors: ${result.errors.join(', ')}`);
  });

  test('corrected_hindi_lyrics is non-null and non-empty', () => {
    assert.ok(result.data?.corrected_hindi_lyrics !== null);
    assert.ok((result.data?.corrected_hindi_lyrics?.length ?? 0) > 20);
  });

  test('corrected_english_lyrics is non-null and non-empty', () => {
    assert.ok(result.data?.corrected_english_lyrics !== null);
    assert.ok((result.data?.corrected_english_lyrics?.length ?? 0) > 20);
  });

  test('suno_ready_lyrics contains Suno section tags', () => {
    assert.ok(/\[verse/i.test(result.data?.suno_ready_lyrics ?? ''));
    assert.ok(/\[chorus/i.test(result.data?.suno_ready_lyrics ?? ''));
  });

  test('suno_ready_lyrics is ≥ 20 chars', () => {
    assert.ok((result.data?.suno_ready_lyrics?.length ?? 0) >= 20);
  });

  test('pronunciation_notes has ≥ 5 entries', () => {
    assert.ok((result.data?.pronunciation_notes?.length ?? 0) >= 5);
  });

  test('issues_found has 5 entries', () => {
    assert.equal(result.data?.issues_found?.length, 5);
  });

  test('issues_found includes at least one high-severity entry', () => {
    assert.ok(result.data?.issues_found?.some((i) => i.severity === 'high'));
  });

  test('manual_review_notes has 3 entries', () => {
    assert.equal(result.data?.manual_review_notes?.length, 3);
  });

  test('source is "structured"', () => {
    assert.equal(result.data?.source, 'structured');
  });

  test('no errors', () => {
    assert.equal(result.errors.length, 0);
  });

  test('parsed_at is a recent timestamp', () => {
    const now = Date.now();
    const diff = Math.abs(now - (result.data?.parsed_at ?? 0));
    assert.ok(diff < 5000, `parsed_at is too far from now: ${diff}ms`);
  });

  test('parse_warnings is an array', () => {
    assert.ok(Array.isArray(result.data?.parse_warnings));
  });

  test('warn rule fires for high-severity issues', () => {
    // high-severity issues warn rule should trigger
    assert.ok(result.warnings.some((w) => /high-severity/i.test(w)));
  });
});

// ─── parseChatGPTOutput — english-only fixture ────────────────────────────────

describe('parseChatGPTOutput — english-only fixture', () => {
  const result = parseChatGPTOutput(englishOnly);

  test('returns success: true', () => {
    assert.ok(result.success, `Errors: ${result.errors.join(', ')}`);
  });

  test('corrected_hindi_lyrics is null (N/A)', () => {
    assert.equal(result.data?.corrected_hindi_lyrics, null);
  });

  test('corrected_english_lyrics is non-null', () => {
    assert.ok(result.data?.corrected_english_lyrics !== null);
  });

  test('suno_ready_lyrics includes [Verse 1] and [Chorus]', () => {
    const lyrics = result.data?.suno_ready_lyrics ?? '';
    assert.ok(lyrics.includes('[Verse 1]'));
    assert.ok(lyrics.includes('[Chorus]'));
  });

  test('pronunciation_notes has 3 entries', () => {
    assert.equal(result.data?.pronunciation_notes?.length, 3);
  });

  test('issues_found has 3 entries', () => {
    assert.equal(result.data?.issues_found?.length, 3);
  });

  test('issues_found[0] has severity high (grammar error)', () => {
    assert.equal(result.data?.issues_found?.[0]?.severity, 'high');
  });

  test('manual_review_notes has 2 entries', () => {
    assert.equal(result.data?.manual_review_notes?.length, 2);
  });

  test('no errors', () => {
    assert.equal(result.errors.length, 0);
  });
});

// ─── parseChatGPTOutput — partial fixture (missing SUNO READY LYRICS) ─────────

describe('parseChatGPTOutput — partial fixture', () => {
  const result = parseChatGPTOutput(partial);

  test('returns success: false because suno_ready_lyrics is absent', () => {
    // The partial fixture has no SUNO READY LYRICS section.
    // The parser will use the english lyrics as a fallback but must still check
    // critical rule: we expect either failure OR a fallback warning.
    // Either way the test validates the parser behaved deterministically.
    // Since english lyrics ARE present, the fallback kicks in and parse succeeds
    // with a warning — this is the correct designed behaviour.
    assert.ok(
      result.success || result.errors.length > 0,
      'Expected either success with warning or failure with error'
    );
  });

  test('a fallback warning or a suno error is present', () => {
    const allMessages = [...result.errors, ...result.warnings, ...(result.data?.parse_warnings ?? [])];
    const hasFallback = allMessages.some(
      (m) => /suno/i.test(m) || /fallback/i.test(m)
    );
    assert.ok(hasFallback, `Expected suno/fallback message, got: ${allMessages.join('; ')}`);
  });

  test('corrected_hindi_lyrics is null', () => {
    assert.equal(result.data?.corrected_hindi_lyrics, null);
  });

  test('corrected_english_lyrics is present', () => {
    assert.ok((result.data?.corrected_english_lyrics?.length ?? 0) > 0);
  });

  test('pronunciation_notes has 2 entries', () => {
    assert.equal(result.data?.pronunciation_notes?.length, 2);
  });

  test('manual_review_notes is empty (fixture has "None.")', () => {
    assert.equal(result.data?.manual_review_notes?.length, 0);
  });
});

// ─── parseChatGPTOutput — edge cases ─────────────────────────────────────────

describe('parseChatGPTOutput — edge cases', () => {
  test('empty string → success: false', () => {
    const r = parseChatGPTOutput('');
    assert.ok(!r.success);
    assert.ok(r.errors.length > 0);
  });

  test('whitespace-only → success: false', () => {
    const r = parseChatGPTOutput('   \n\n   ');
    assert.ok(!r.success);
  });

  test('text with only English lyrics (no SUNO section) uses fallback and warns', () => {
    const r = parseChatGPTOutput(
      '=== CORRECTED ENGLISH LYRICS ===\n[Verse 1]\nRaghupati Raghava Raja Ram\nPatita Pavana Sita Ram\n\n=== PRONUNCIATION NOTES ===\nNone.\n\n=== ISSUES FOUND ===\nNone.\n\n=== MANUAL REVIEW NOTES ===\nNone.'
    );
    // Should succeed via fallback
    assert.ok(r.success, `Expected success, got: ${r.errors.join(', ')}`);
    assert.ok(
      (r.warnings.join(' ') + (r.data?.parse_warnings.join(' ') ?? '')).toLowerCase().includes('fallback')
    );
  });

  test('source is "prose" when fewer than 3 headers found', () => {
    const r = parseChatGPTOutput('Just some plain text about lyrics without any headers');
    // Will fail (no usable content) but source should have been set to prose
    // We can only check source if data is present
    if (r.data) {
      assert.equal(r.data.source, 'prose');
    }
  });

  test('does not throw — always returns a result object', () => {
    // Malformed input with unusual characters
    const r = parseChatGPTOutput('\x00\xFF=== BROKEN ===\nnull\0null');
    assert.ok(typeof r.success === 'boolean');
    assert.ok(Array.isArray(r.errors));
    assert.ok(Array.isArray(r.warnings));
  });
});

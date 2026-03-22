/**
 * Normalised types for the ChatGPT lyrics-correction output.
 *
 * These types are shared by:
 *   - The Zod validation schemas  (schema.ts)
 *   - The prompt builder           (prompt.ts)
 *   - The prose parser             (parser.ts)
 *   - The workflow engine          (chatgpt_lyrics_correct stage)
 *   - The dashboard UI             (run detail views)
 */

// ─── Prompt input ─────────────────────────────────────────────────────────────

/**
 * All context passed to the prompt builder.
 * Derived primarily from GeminiParsedOutput + Project fields.
 */
export interface LyricsCorrectionInput {
  // Core song content
  song_title: string;
  /** Raw lyrics as returned by Gemini — may be Hindi, English, or bilingual */
  lyrics_raw: string;
  style_notes: string;
  vocal_guidance: string;
  /** Ready-to-paste Suno style descriptor */
  suno_style_prompt: string;
  /** Theological / cultural background from Gemini */
  background: string;

  // Project context
  /** e.g. "Hindi", "English", "Telugu" */
  target_language: string;
  devotional_theme: string;
}

// ─── Pronunciation notes ──────────────────────────────────────────────────────

export interface PronunciationNote {
  /** The word or phrase being annotated */
  word: string;
  /** Phonetic guide — IPA, CAPS-stress, or plain English description */
  guide: string;
  /** Optional extra note on stress, melody, or cultural context */
  stress_note: string | null;
}

// ─── Issues found ─────────────────────────────────────────────────────────────

export type IssueSeverity = 'low' | 'medium' | 'high';

export interface IssueFound {
  /** Description of the issue */
  description: string;
  severity: IssueSeverity;
  /** Where in the lyrics it occurs — e.g. "Verse 1, line 3" — null if global */
  location: string | null;
}

// ─── Corrected output ─────────────────────────────────────────────────────────

export type CorrectionParseSource = 'structured' | 'prose';

export interface ChatGPTCorrectedOutput {
  // ── Corrected lyrics ────────────────────────────────────────────────────────
  /** Corrected Hindi / Sanskrit lyrics — null when input contained no Hindi */
  corrected_hindi_lyrics: string | null;
  /** Corrected English lyrics — null when input contained no English */
  corrected_english_lyrics: string | null;
  /**
   * Full corrected lyrics formatted for direct paste into Suno:
   * section tags on their own lines, no pronunciation annotations.
   */
  suno_ready_lyrics: string;

  // ── Guidance ────────────────────────────────────────────────────────────────
  pronunciation_notes: PronunciationNote[];
  issues_found: IssueFound[];
  /** Items that require human attention before production */
  manual_review_notes: string[];

  // ── Parser metadata ─────────────────────────────────────────────────────────
  parse_warnings: string[];
  parsed_at: number;
  source: CorrectionParseSource;
}

// ─── Parser result ────────────────────────────────────────────────────────────

export interface ChatGPTParseResult {
  success: boolean;
  data?: ChatGPTCorrectedOutput;
  /** Critical failures that prevented a complete parse */
  errors: string[];
  /** Non-critical issues — parse succeeded but some data may be incomplete */
  warnings: string[];
}

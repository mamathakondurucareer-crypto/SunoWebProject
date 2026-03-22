/**
 * Types for the ChatGPT audio evaluation module.
 *
 * Used when ChatGPT compares two Suno audio candidates and selects a winner.
 */

// ─── Input ────────────────────────────────────────────────────────────────────

export interface CandidateEvaluationInput {
  /** Absolute path to the audio file (mp3). Null if not downloaded. */
  audio_path: string | null;
  /** Candidate label: 'A' or 'B' */
  label: 'A' | 'B';
  /** Song title as returned by Suno */
  song_title: string;
  /** Duration in seconds, or null if unknown */
  duration_seconds: number | null;
  /** Style prompt used for generation */
  style_prompt: string;
  /** Intended lyrics (full text submitted to Suno) */
  intended_lyrics: string;
  /** Suno song ID, or null if not captured */
  song_id: string | null;
}

// ─── Score Components ─────────────────────────────────────────────────────────

export interface ScoreDetail {
  /** Numeric score 1–10 */
  score: number;
  /** Human-readable rationale for the score */
  rationale: string;
}

// ─── Per-Candidate Analysis ───────────────────────────────────────────────────

export interface CandidateAnalysis {
  /** Which candidate this analysis covers */
  label: 'A' | 'B';
  /** Overall composite score 1–10 */
  overall_score: number;
  /** Pronunciation accuracy of lyrics */
  pronunciation_accuracy: ScoreDetail;
  /** Lyric intelligibility throughout the track */
  lyric_intelligibility: ScoreDetail;
  /** Hook strength in the first ~10 seconds */
  hook_strength: ScoreDetail;
  /** Chorus emotional impact */
  chorus_impact: ScoreDetail;
  /** Overall musical quality */
  musical_quality: ScoreDetail;
  /**
   * Viral-proxy score 1–10.
   * Based ONLY on measurable audio traits:
   *   hook arrival time, chorus melodic repetition, beat consistency,
   *   lyric clarity in first 10 seconds, emotional peak moments.
   * Does NOT predict or guarantee virality.
   */
  viral_proxy_score: ScoreDetail;
  /** How well the audio would sync with visual cuts */
  visual_sync_potential: ScoreDetail;
  /** Freeform notes from the evaluator */
  notes: string;
}

// ─── Comparison Result ────────────────────────────────────────────────────────

export type WinnerLabel = 'A' | 'B' | 'tie' | 'manual_review_required';

export interface ComparisonResult {
  /** The recommended winner, or special values for tie / escalation */
  winner: WinnerLabel;
  /** Score difference (candidate_a_score − candidate_b_score), rounded to 2 dp */
  score_delta: number;
  /** Concise summary of why this candidate was chosen */
  decision_rationale: string;
  /** Whether the decision is clear-cut or borderline */
  confidence: 'high' | 'medium' | 'low';
  /** Key strengths of candidate A relative to B */
  candidate_a_strengths: string[];
  /** Key strengths of candidate B relative to A */
  candidate_b_strengths: string[];
  /** Any caveats or edge cases the human reviewer should know */
  caveats: string;
}

// ─── Stored Run Manifest ──────────────────────────────────────────────────────

export interface EvaluationStoredRun {
  /** Absolute path to the evaluation run directory */
  run_dir: string;
  /** Absolute path to candidate_a_analysis.json */
  candidate_a_analysis_path: string;
  /** Absolute path to candidate_b_analysis.json */
  candidate_b_analysis_path: string;
  /** Absolute path to comparison.json */
  comparison_path: string;
  /** Absolute path to selected_candidate.txt */
  selected_candidate_path: string;
  /** Screenshot of the ChatGPT conversation, or null if not captured */
  chatgpt_screenshot: string | null;
}

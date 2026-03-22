/**
 * Local storage module for ChatGPT evaluation artifacts.
 *
 * Writes four output files per evaluation run:
 *   - candidate_a_analysis.json
 *   - candidate_b_analysis.json
 *   - comparison.json
 *   - selected_candidate.txt
 *
 * Never throws — missing data surfaces as null paths.
 */

import fs from 'fs';
import path from 'path';
import type { CandidateAnalysis, ComparisonResult, EvaluationStoredRun } from './types';

// ─── File names ───────────────────────────────────────────────────────────────

const ANALYSIS_A_FILENAME = 'candidate_a_analysis.json';
const ANALYSIS_B_FILENAME = 'candidate_b_analysis.json';
const COMPARISON_FILENAME = 'comparison.json';
const SELECTED_FILENAME = 'selected_candidate.txt';
const SCREENSHOT_FILENAME = 'chatgpt_eval_screenshot.png';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SaveEvaluationRunInput {
  analysisA: CandidateAnalysis;
  analysisB: CandidateAnalysis;
  comparison: ComparisonResult;
}

/**
 * Persist a completed evaluation run to `runDir`.
 *
 * Writes all four output files. Records the screenshot path if the file
 * already exists on disk (screenshot is captured by the adapter externally).
 */
export function saveEvaluationRun(
  input: SaveEvaluationRunInput,
  runDir: string
): EvaluationStoredRun {
  fs.mkdirSync(runDir, { recursive: true });

  const analysisAPath = path.join(runDir, ANALYSIS_A_FILENAME);
  const analysisBPath = path.join(runDir, ANALYSIS_B_FILENAME);
  const comparisonPath = path.join(runDir, COMPARISON_FILENAME);
  const selectedPath = path.join(runDir, SELECTED_FILENAME);
  const screenshotPath = path.join(runDir, SCREENSHOT_FILENAME);

  fs.writeFileSync(analysisAPath, JSON.stringify(input.analysisA, null, 2), 'utf-8');
  fs.writeFileSync(analysisBPath, JSON.stringify(input.analysisB, null, 2), 'utf-8');
  fs.writeFileSync(comparisonPath, JSON.stringify(input.comparison, null, 2), 'utf-8');
  fs.writeFileSync(selectedPath, buildSelectedText(input.comparison), 'utf-8');

  return {
    run_dir: runDir,
    candidate_a_analysis_path: analysisAPath,
    candidate_b_analysis_path: analysisBPath,
    comparison_path: comparisonPath,
    selected_candidate_path: selectedPath,
    chatgpt_screenshot: fs.existsSync(screenshotPath) ? screenshotPath : null,
  };
}

/**
 * Load a previously-saved `CandidateAnalysis` from a JSON file.
 * Returns null on any failure.
 */
export function loadAnalysis(filePath: string): CandidateAnalysis | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CandidateAnalysis;
  } catch {
    return null;
  }
}

/**
 * Load a previously-saved `ComparisonResult` from a JSON file.
 * Returns null on any failure.
 */
export function loadComparison(filePath: string): ComparisonResult | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ComparisonResult;
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSelectedText(comparison: ComparisonResult): string {
  const { winner, confidence, decision_rationale } = comparison;

  if (winner === 'tie') {
    return `RESULT: tie\nCONFIDENCE: ${confidence}\nRATIONALE: ${decision_rationale}\n`;
  }
  if (winner === 'manual_review_required') {
    return `RESULT: manual_review_required\nCONFIDENCE: ${confidence}\nRATIONALE: ${decision_rationale}\n`;
  }
  return `RESULT: candidate_${winner.toLowerCase()}\nCONFIDENCE: ${confidence}\nRATIONALE: ${decision_rationale}\n`;
}

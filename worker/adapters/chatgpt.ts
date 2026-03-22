import type { Page } from 'playwright';
import { BaseServiceAdapter, type SelectorMap } from './base';
import type { StageContext, StageResult } from '@/types';
import {
  registerDefaults,
  waitForStableText,
  captureDiagnosticBundle,
  captureConsoleErrors,
  scrollToBottom,
} from '../browser';
import {
  buildLyricsCorrectionPrompt,
  parseChatGPTOutput,
} from '@/lib/chatgpt';
import type { LyricsCorrectionInput } from '@/lib/chatgpt';
import type { GeminiParsedOutput } from '@/lib/gemini';
import {
  buildCandidateAnalysisPrompt,
  buildComparisonPrompt,
  parseCandidateAnalysis,
  parseComparisonResult,
  saveEvaluationRun,
} from '@/lib/chatgpt-eval';
import type { CandidateEvaluationInput, CandidateAnalysis } from '@/lib/chatgpt-eval';
import {
  buildPromptRefinementPrompt,
  parseRefinedPrompts,
  savePromptRefinementRun,
  DEFAULT_VISUAL_STYLE_GUIDE,
  DEFAULT_CONTINUITY_NOTES,
} from '@/lib/prompt-refine';
import type { SceneInputRow, SceneSourceRow } from '@/lib/prompt-refine';
import fs from 'fs';
import path from 'path';

const CHATGPT_URL = 'https://chat.openai.com';

// ─── Selector defaults ────────────────────────────────────────────────────────

registerDefaults('chatgpt', {
  input_box: [
    '#prompt-textarea',
    'div[contenteditable="true"][data-id="root"]',
    'textarea[placeholder]',
    'div[contenteditable="true"]',
  ],
  send_button: [
    'button[data-testid="send-button"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Submit"]',
    'button.send-button',
  ],
  response_container: [
    '[data-message-author-role="assistant"] .markdown',
    '[data-message-author-role="assistant"] .prose',
    '.agent-turn .markdown',
    '[data-testid="conversation-turn-assistant"] .markdown',
  ],
  stop_button: [
    'button[aria-label="Stop streaming"]',
    'button[aria-label="Stop generating"]',
    '[data-testid="stop-button"]',
    'button.stop-button',
  ],
});

// ─── ChatGPTAdapter ───────────────────────────────────────────────────────────

export class ChatGPTAdapter extends BaseServiceAdapter {
  constructor(profilePath: string) {
    super('chatgpt', profilePath, { timeout: 120_000, navTimeout: 60_000 });
  }

  async isLoggedIn(page: Page): Promise<boolean> {
    const url = page.url();
    if (url.includes('/auth/login') || url.includes('login')) return false;

    try {
      await page
        .locator('#prompt-textarea, div[contenteditable="true"][data-id="root"]')
        .first()
        .waitFor({ timeout: 8_000, state: 'visible' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Type prompt and wait for the full streamed response to settle.
   * Returns the captured response text.
   */
  private async sendMessageAndWait(
    page: Page,
    message: string,
    selectors: SelectorMap
  ): Promise<string> {
    // Resolve selectors
    const inputSel = await this.resolveSelector('input_box', page, selectors);
    if (!inputSel) throw new Error('ChatGPT: Could not find prompt input box');

    const input = page.locator(inputSel).first();
    await input.waitFor({ timeout: 15_000, state: 'visible' });
    await input.click();

    // Use insertText for large prompts — avoids slow char-by-char typing
    await page.keyboard.insertText(message);

    // Submit
    const sendSel = await this.resolveSelector('send_button', page, selectors);
    if (sendSel) {
      await page.locator(sendSel).first().click();
    } else {
      await page.keyboard.press('Enter');
    }

    // Small delay before polling — ChatGPT shows a typing indicator first
    await page.waitForTimeout(2_000);

    // Wait for response container
    const respSel = await this.resolveSelector('response_container', page, selectors);
    if (!respSel) throw new Error('ChatGPT: Could not locate response container selector');

    await page.locator(respSel).last().waitFor({ timeout: 60_000, state: 'visible' });

    // Strategy 1: wait for the stop button to disappear
    const stopSel = await this.resolveSelector('stop_button', page, selectors);
    if (stopSel) {
      await page
        .locator(stopSel)
        .first()
        .waitFor({ state: 'hidden', timeout: 300_000 })
        .catch(() => {
          this.log.warn('sendMessageAndWait', 'Stop button wait timed out — proceeding');
        });
    }

    // Strategy 2: wait for text to stop changing
    await scrollToBottom(page).catch(() => {});
    return waitForStableText(page, respSel, {
      stableCount: 3,
      pollIntervalMs: 2_000,
      timeoutMs: 300_000,
    });
  }

  async execute(ctx: StageContext, selectors: SelectorMap): Promise<StageResult> {
    const stageKey = ctx.stageRun.stage_key;
    const page = await this.getPage();
    const consoleCapture = captureConsoleErrors(page);

    try {
      this.log.info('execute', 'Navigating to ChatGPT', { url: CHATGPT_URL });
      await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' });
      await this.waitForNetworkIdle(page, 15_000);

      if (!(await this.isLoggedIn(page))) {
        consoleCapture.stop();
        return {
          success: false,
          error: 'ChatGPT: Not logged in. Please connect the ChatGPT browser profile from Settings.',
        };
      }

      if (stageKey === 'chatgpt_lyrics_correct') {
        return await this.executeLyricsCorrection(page, ctx, selectors);
      } else if (stageKey === 'chatgpt_evaluate_candidate_a') {
        return await this.executeAudioEvaluation(page, ctx, selectors, 'A');
      } else if (stageKey === 'chatgpt_evaluate_candidate_b') {
        return await this.executeAudioEvaluation(page, ctx, selectors, 'B');
      } else if (stageKey === 'chatgpt_auto_compare') {
        return await this.executeCandidateComparison(page, ctx, selectors);
      } else if (stageKey === 'refine_grok_prompts') {
        return await this.executePromptRefinement(page, ctx, selectors);
      }

      return { success: false, error: `ChatGPT: Unknown stage key ${stageKey}` };
    } catch (err) {
      this.log.error('execute', `ChatGPT execution failed: ${String(err)}`);
      consoleCapture.stop();

      const bundle = await captureDiagnosticBundle(page, ctx.runDir, ctx.stageRun.stage_key, {
        consoleCapture,
      });

      return {
        success: false,
        error: String(err),
        assetPaths: [
          ...(bundle.screenshot
            ? [{ path: bundle.screenshot, type: 'screenshot' as const, name: 'Failure Screenshot' }]
            : []),
          ...(bundle.html
            ? [{ path: bundle.html, type: 'html_dump' as const, name: 'Failure HTML' }]
            : []),
          ...(bundle.manifestPath
            ? [{ path: bundle.manifestPath, type: 'document' as const, name: 'Diagnostic Bundle' }]
            : []),
        ],
      };
    } finally {
      consoleCapture.stop();
    }
  }

  // ─── Stage: chatgpt_lyrics_correct ─────────────────────────────────────────

  private async executeLyricsCorrection(
    page: Page,
    ctx: StageContext,
    selectors: SelectorMap
  ): Promise<StageResult> {
    // Input comes from the gemini_capture_parse stage output
    const geminiData = (ctx.stageRun.input ?? {}) as Partial<GeminiParsedOutput>;

    if (!geminiData.lyrics_raw) {
      return { success: false, error: 'chatgpt_lyrics_correct: No lyrics_raw in stage input' };
    }

    const correctionInput: LyricsCorrectionInput = {
      song_title: geminiData.song_title ?? ctx.project.devotional_theme,
      lyrics_raw: geminiData.lyrics_raw,
      style_notes: geminiData.style_notes ?? '',
      vocal_guidance: geminiData.vocal_guidance ?? '',
      suno_style_prompt: geminiData.suno_style_prompt ?? '',
      background: geminiData.background ?? '',
      target_language: ctx.project.target_language,
      devotional_theme: ctx.project.devotional_theme,
    };

    const prompt = buildLyricsCorrectionPrompt(correctionInput);
    this.log.info('executeLyricsCorrection', 'Prompt built', {
      songTitle: correctionInput.song_title,
      language: correctionInput.target_language,
      promptLength: prompt.length,
    });

    const rawResponse = await this.sendMessageAndWait(page, prompt, selectors);

    if (!rawResponse || rawResponse.trim().length < 50) {
      throw new Error(
        `ChatGPT response was empty or too short (${rawResponse?.length ?? 0} chars)`
      );
    }

    this.log.info('executeLyricsCorrection', 'Response captured', {
      length: rawResponse.length,
    });

    // Parse the response
    const parseResult = parseChatGPTOutput(rawResponse);
    this.log.info('executeLyricsCorrection', 'Parse complete', {
      success: parseResult.success,
      errors: parseResult.errors,
      warnings: parseResult.warnings,
    });

    // Save raw output
    fs.mkdirSync(ctx.runDir, { recursive: true });
    const rawFile = path.join(ctx.runDir, 'chatgpt_lyrics_raw.txt');
    fs.writeFileSync(rawFile, rawResponse, 'utf-8');

    // Save parsed JSON
    const parsedFile = path.join(ctx.runDir, 'chatgpt_lyrics_parsed.json');
    fs.writeFileSync(parsedFile, JSON.stringify(parseResult, null, 2), 'utf-8');

    // Save Suno-ready lyrics as a standalone text file for easy hand-off
    const sunoFile = path.join(ctx.runDir, 'chatgpt_suno_ready_lyrics.txt');
    if (parseResult.data?.suno_ready_lyrics) {
      fs.writeFileSync(sunoFile, parseResult.data.suno_ready_lyrics, 'utf-8');
    }

    // Capture success screenshot
    const screenshotPath = path.join(ctx.runDir, 'chatgpt_lyrics_success.png');
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

    if (!parseResult.success) {
      return {
        success: false,
        error: `Lyrics correction parse failed: ${parseResult.errors.join('; ')}`,
        output: {
          raw_response: rawResponse,
          parse_result: parseResult,
          raw_file: rawFile,
          parsed_file: parsedFile,
        },
        assetPaths: [
          { path: rawFile, type: 'lyrics', name: 'ChatGPT Raw Response', mimeType: 'text/plain' },
          { path: parsedFile, type: 'document', name: 'Parse Result JSON', mimeType: 'application/json' },
          ...(fs.existsSync(screenshotPath)
            ? [{ path: screenshotPath, type: 'screenshot' as const, name: 'ChatGPT Screenshot' }]
            : []),
        ],
      };
    }

    return {
      success: true,
      output: {
        corrected_hindi_lyrics: parseResult.data!.corrected_hindi_lyrics,
        corrected_english_lyrics: parseResult.data!.corrected_english_lyrics,
        suno_ready_lyrics: parseResult.data!.suno_ready_lyrics,
        pronunciation_notes: parseResult.data!.pronunciation_notes,
        issues_found: parseResult.data!.issues_found,
        manual_review_notes: parseResult.data!.manual_review_notes,
        parse_warnings: parseResult.warnings,
        raw_file: rawFile,
        parsed_file: parsedFile,
        suno_file: sunoFile,
      },
      assetPaths: [
        { path: rawFile, type: 'lyrics', name: 'ChatGPT Raw Response', mimeType: 'text/plain' },
        { path: parsedFile, type: 'document', name: 'Parsed Correction JSON', mimeType: 'application/json' },
        ...(fs.existsSync(sunoFile)
          ? [{ path: sunoFile, type: 'lyrics' as const, name: 'Suno Ready Lyrics', mimeType: 'text/plain' }]
          : []),
        ...(fs.existsSync(screenshotPath)
          ? [{ path: screenshotPath, type: 'screenshot' as const, name: 'ChatGPT Success Screenshot' }]
          : []),
      ],
    };
  }

  // ─── Stage: chatgpt_evaluate_candidate_a / _b ──────────────────────────────

  private async executeAudioEvaluation(
    page: Page,
    ctx: StageContext,
    selectors: SelectorMap,
    label: 'A' | 'B'
  ): Promise<StageResult> {
    const input = ctx.stageRun.input ?? {};
    const candidateKey = label === 'A' ? 'candidate_a' : 'candidate_b';
    const candidateRaw = (input[candidateKey] as Record<string, unknown>) ?? {};

    const evalInput: CandidateEvaluationInput = {
      label,
      audio_path: (candidateRaw.audio_path as string) ?? null,
      song_title: (candidateRaw.song_title as string) ?? `Candidate ${label}`,
      duration_seconds: (candidateRaw.duration_seconds as number) ?? null,
      style_prompt: (candidateRaw.style_prompt as string) ?? (input.suno_style_prompt as string) ?? '',
      intended_lyrics:
        (input.suno_ready_lyrics as string) ??
        (input.corrected_hindi_lyrics as string) ??
        (input.lyrics as string) ??
        '',
      song_id: (candidateRaw.song_id as string) ?? null,
    };

    // Attempt to upload audio file via ChatGPT file input
    let audioUploaded = false;
    if (evalInput.audio_path && fs.existsSync(evalInput.audio_path)) {
      audioUploaded = await this.uploadAudioFile(page, evalInput.audio_path);
    }

    const prompt = buildCandidateAnalysisPrompt(evalInput, audioUploaded);
    const rawResponse = await this.sendMessageAndWait(page, prompt, selectors);

    // Save raw response
    fs.mkdirSync(ctx.runDir, { recursive: true });
    const rawFile = path.join(ctx.runDir, `chatgpt_eval_candidate_${label.toLowerCase()}_raw.txt`);
    fs.writeFileSync(rawFile, rawResponse, 'utf-8');

    // Capture screenshot
    const screenshotPath = path.join(
      ctx.runDir,
      `chatgpt_eval_candidate_${label.toLowerCase()}_screenshot.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

    // Parse structured analysis
    const analysis = parseCandidateAnalysis(rawResponse, label);
    if (!analysis) {
      return {
        success: false,
        error: `ChatGPT candidate ${label} evaluation: failed to parse structured response`,
        output: { raw_file: rawFile, audio_uploaded: audioUploaded },
        assetPaths: [
          { path: rawFile, type: 'evaluation', name: `Candidate ${label} Raw Eval`, mimeType: 'text/plain' },
          ...(fs.existsSync(screenshotPath)
            ? [{ path: screenshotPath, type: 'screenshot' as const, name: `Candidate ${label} Screenshot` }]
            : []),
        ],
      };
    }

    // Persist JSON
    const analysisFile = path.join(
      ctx.runDir,
      `chatgpt_eval_candidate_${label.toLowerCase()}.json`
    );
    fs.writeFileSync(analysisFile, JSON.stringify(analysis, null, 2), 'utf-8');

    return {
      success: true,
      output: {
        analysis,
        overall_score: analysis.overall_score,
        candidate_label: label,
        audio_uploaded: audioUploaded,
        raw_file: rawFile,
        analysis_file: analysisFile,
      },
      assetPaths: [
        { path: rawFile, type: 'evaluation', name: `Candidate ${label} Raw Eval`, mimeType: 'text/plain' },
        { path: analysisFile, type: 'evaluation', name: `Candidate ${label} Analysis JSON`, mimeType: 'application/json' },
        ...(fs.existsSync(screenshotPath)
          ? [{ path: screenshotPath, type: 'screenshot' as const, name: `Candidate ${label} Eval Screenshot` }]
          : []),
      ],
    };
  }

  // ─── Stage: chatgpt_auto_compare ───────────────────────────────────────────

  private async executeCandidateComparison(
    page: Page,
    ctx: StageContext,
    selectors: SelectorMap
  ): Promise<StageResult> {
    const input = ctx.stageRun.input ?? {};

    // Load analysis objects from prior eval stages (passed as stage input)
    const analysisARaw = input.analysis_a as Record<string, unknown> | undefined;
    const analysisBRaw = input.analysis_b as Record<string, unknown> | undefined;

    const analysisA = analysisARaw as CandidateAnalysis | undefined;
    const analysisB = analysisBRaw as CandidateAnalysis | undefined;

    if (!analysisA || !analysisB) {
      return {
        success: false,
        error: 'chatgpt_auto_compare: analysis_a and analysis_b must be present in stage input',
      };
    }

    // Build evaluation inputs for prompt context
    const makeEvalInput = (
      label: 'A' | 'B',
      raw: Record<string, unknown>
    ): CandidateEvaluationInput => ({
      label,
      audio_path: (raw.audio_path as string) ?? null,
      song_title: (raw.song_title as string) ?? `Candidate ${label}`,
      duration_seconds: (raw.duration_seconds as number) ?? null,
      style_prompt: (raw.style_prompt as string) ?? '',
      intended_lyrics: (input.suno_ready_lyrics as string) ?? '',
      song_id: (raw.song_id as string) ?? null,
    });

    const candARaw = (input.candidate_a as Record<string, unknown>) ?? {};
    const candBRaw = (input.candidate_b as Record<string, unknown>) ?? {};

    const evalInputA = makeEvalInput('A', candARaw);
    const evalInputB = makeEvalInput('B', candBRaw);

    // Attempt audio uploads for comparison context
    const hasAudioA =
      evalInputA.audio_path !== null && fs.existsSync(evalInputA.audio_path ?? '');
    const hasAudioB =
      evalInputB.audio_path !== null && fs.existsSync(evalInputB.audio_path ?? '');

    if (hasAudioA && evalInputA.audio_path) {
      await this.uploadAudioFile(page, evalInputA.audio_path).catch(() => {});
    }
    if (hasAudioB && evalInputB.audio_path) {
      await this.uploadAudioFile(page, evalInputB.audio_path).catch(() => {});
    }

    const prompt = buildComparisonPrompt(evalInputA, evalInputB, hasAudioA, hasAudioB);
    const rawResponse = await this.sendMessageAndWait(page, prompt, selectors);

    // Save raw response
    fs.mkdirSync(ctx.runDir, { recursive: true });
    const rawFile = path.join(ctx.runDir, 'chatgpt_comparison_raw.txt');
    fs.writeFileSync(rawFile, rawResponse, 'utf-8');

    // Capture screenshot of comparison conversation
    const screenshotPath = path.join(ctx.runDir, 'chatgpt_eval_screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

    // Parse comparison result
    const comparison = parseComparisonResult(rawResponse);
    if (!comparison) {
      return {
        success: false,
        error: 'chatgpt_auto_compare: failed to parse structured comparison response',
        output: { raw_file: rawFile },
        assetPaths: [
          { path: rawFile, type: 'evaluation', name: 'Comparison Raw Response', mimeType: 'text/plain' },
          ...(fs.existsSync(screenshotPath)
            ? [{ path: screenshotPath, type: 'screenshot' as const, name: 'Comparison Screenshot' }]
            : []),
        ],
      };
    }

    // Persist all four output files via storage module
    const evalRunDir = path.join(ctx.runDir, 'eval');
    const stored = saveEvaluationRun({ analysisA, analysisB, comparison }, evalRunDir);

    return {
      success: true,
      output: {
        winner: comparison.winner,
        score_delta: comparison.score_delta,
        confidence: comparison.confidence,
        decision_rationale: comparison.decision_rationale,
        candidate_a_score: analysisA.overall_score,
        candidate_b_score: analysisB.overall_score,
        stored_run: stored,
        raw_file: rawFile,
      },
      assetPaths: [
        { path: rawFile, type: 'evaluation', name: 'Comparison Raw Response', mimeType: 'text/plain' },
        { path: stored.candidate_a_analysis_path, type: 'evaluation', name: 'Candidate A Analysis', mimeType: 'application/json' },
        { path: stored.candidate_b_analysis_path, type: 'evaluation', name: 'Candidate B Analysis', mimeType: 'application/json' },
        { path: stored.comparison_path, type: 'evaluation', name: 'Comparison Result', mimeType: 'application/json' },
        { path: stored.selected_candidate_path, type: 'document', name: 'Selected Candidate', mimeType: 'text/plain' },
        ...(fs.existsSync(screenshotPath)
          ? [{ path: screenshotPath, type: 'screenshot' as const, name: 'Comparison Screenshot' }]
          : []),
      ],
    };
  }

  // ─── Helper: Upload audio file via ChatGPT file input ─────────────────────

  private async uploadAudioFile(page: Page, audioPath: string): Promise<boolean> {
    try {
      const fileInput = page.locator('input[type="file"]').first();
      const fileInputVisible = await fileInput.count();
      if (fileInputVisible === 0) {
        // Try clicking the attachment/upload button to reveal the input
        const attachBtn = page.locator(
          'button[aria-label*="attach"], button[aria-label*="upload"], button[aria-label*="file"]'
        ).first();
        if (await attachBtn.count() > 0) {
          await attachBtn.click();
          await page.waitForTimeout(500);
        }
      }

      await fileInput.setInputFiles(audioPath);

      // Wait for upload indicator to appear/disappear
      await page.waitForTimeout(2_000);
      this.log.info('uploadAudioFile', 'Audio upload completed', { audioPath });
      return true;
    } catch (err) {
      this.log.warn('uploadAudioFile', `Could not upload audio file: ${String(err)}`, { audioPath });
      return false;
    }
  }

  // ─── Stage: refine_grok_prompts ────────────────────────────────────────────

  private async executePromptRefinement(
    page: Page,
    ctx: StageContext,
    selectors: SelectorMap
  ): Promise<StageResult> {
    const input = ctx.stageRun.input ?? {};

    // Build scene input rows from timed_scene_manifest scenes
    const rawScenes = (input.scenes as Record<string, unknown>[]) ?? [];
    const sceneRows: SceneInputRow[] = rawScenes.map(s => ({
      scene_number:    (s.scene_number as number) ?? 0,
      start_sec:       (s.start_sec as number) ?? 0,
      end_sec:         (s.end_sec as number) ?? 0,
      section:         (s.section as SceneInputRow['section']) ?? 'unknown',
      lyric_excerpt:   (s.lyric_excerpt as string) ?? '',
      energy:          (s.energy as SceneInputRow['energy']) ?? 'medium',
      grok_text_to_video_prompt_seed:(s.grok_text_to_video_prompt_seed as string) ?? '',
      capcut_motion:   (s.capcut_motion as string) ?? '',
      crop_notes:      (s.crop_notes as string) ?? '',
      negative_prompt: (s.negative_prompt as string) ?? '',
    }));

    const prompt = buildPromptRefinementPrompt({
      song_title:        (input.song_title as string) ?? ctx.project.devotional_theme,
      devotional_theme:  ctx.project.devotional_theme,
      audio_mood:        (input.audio_mood as string) ?? 'devotional, warm, spiritual',
      scenes:            sceneRows,
      visual_bible:      DEFAULT_VISUAL_STYLE_GUIDE,
      continuity_notes:  DEFAULT_CONTINUITY_NOTES,
    });

    this.log.info('executePromptRefinement', 'Prompt built', {
      sceneCount: sceneRows.length,
      promptLength: prompt.length,
    });

    const rawResponse = await this.sendMessageAndWait(page, prompt, selectors);

    // Save raw response
    fs.mkdirSync(ctx.runDir, { recursive: true });
    const rawFile = path.join(ctx.runDir, 'chatgpt_prompt_refinement_raw.txt');
    fs.writeFileSync(rawFile, rawResponse, 'utf-8');

    // Capture screenshot
    const screenshotPath = path.join(ctx.runDir, 'chatgpt_prompt_refinement_screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

    // Parse structured response
    const sourceScenes: SceneSourceRow[] = sceneRows.map(s => ({
      scene_number: s.scene_number,
      section:      s.section,
      start_sec:    s.start_sec,
      end_sec:      s.end_sec,
    }));

    const refined = parseRefinedPrompts(rawResponse, sourceScenes);
    if (!refined) {
      return {
        success: false,
        error: 'refine_grok_prompts: failed to parse structured scene prompts from response',
        output: { raw_file: rawFile },
        assetPaths: [
          { path: rawFile, type: 'document', name: 'Prompt Refinement Raw', mimeType: 'text/plain' },
          ...(fs.existsSync(screenshotPath)
            ? [{ path: screenshotPath, type: 'screenshot' as const, name: 'Refinement Screenshot' }]
            : []),
        ],
      };
    }

    // Persist per-scene JSON files + manifest
    const run = savePromptRefinementRun(refined, ctx.runDir, screenshotPath);

    this.log.info('executePromptRefinement', 'Prompt refinement complete', {
      totalScenes: run.total_scenes,
      manifestPath: run.manifest_path,
    });

    return {
      success: true,
      output: {
        total_scenes:      run.total_scenes,
        manifest_path:     run.manifest_path,
        scene_prompt_paths: run.scene_prompt_paths,
        raw_file:          rawFile,
      },
      assetPaths: [
        { path: rawFile, type: 'document', name: 'Prompt Refinement Raw', mimeType: 'text/plain' },
        { path: run.manifest_path, type: 'document', name: 'Refinement Manifest', mimeType: 'application/json' },
        ...(fs.existsSync(screenshotPath)
          ? [{ path: screenshotPath, type: 'screenshot' as const, name: 'Refinement Screenshot' }]
          : []),
      ],
    };
  }
}

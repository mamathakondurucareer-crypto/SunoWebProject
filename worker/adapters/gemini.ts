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
import fs from 'fs';
import path from 'path';

const GEMINI_URL = 'https://gemini.google.com/app';

// ─── Selector defaults ────────────────────────────────────────────────────────

registerDefaults('gemini', {
  input_box: [
    'div[contenteditable="true"].ql-editor',
    'rich-textarea .ql-editor',
    'rich-textarea div[contenteditable="true"]',
    'div[contenteditable="true"][data-placeholder]',
    'div[contenteditable="true"]',
    '[data-test-id="chat-input"]',
  ],
  send_button: [
    'button[aria-label="Send message"]',
    'button[data-mat-icon-name="send"]',
    'button.send-button',
    'button[aria-label="Submit"]',
    '[data-testid="send-button"]',
  ],
  response_container: [
    'model-response .markdown',
    'model-response .response-content',
    '.model-response-text .markdown',
    'message-content .markdown',
    '.conversation-container model-response',
    '[data-testid="bubble-content"]',
  ],
  stop_button: [
    'button[aria-label="Stop response"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Cancel"]',
    '.stop-button',
  ],
});

// ─── Prompt template ─────────────────────────────────────────────────────────

const DEVOTIONAL_PROMPT_TEMPLATE = (userRequest: string) => `SYSTEM: You are a strict compiler. If you cannot comply 100%, output ONLY:
NOT APPROVED FOR GENERATION — revise concept for lower risk.

IMPORTANT — PROJECT PURPOSE:
This project is for generating one complete devotional song package for a web-based AI workflow.

This workflow will later use:
- ChatGPT web for lyrics correction and pronunciation optimization
- Suno web for music generation
- ChatGPT web for comparing the two Suno audio candidates
- Grok for final text-to-video scene generation
- Canva for thumbnail workflow
- CapCut for final editing handoff

IMPORTANT — OUTPUT ROLE:
Your job is to generate the PRE-AUDIO MASTER PACKAGE.
You are NOT generating the final timed video plan from the actual audio.
Instead, you must generate:
- full song package
- pre-audio scene concept bank
- Grok-ready scene prompt seeds
- thumbnail concepts
- short-form concepts
- SEO package
- machine-readable JSON for automation

IMPORTANT — AUTOMATION RULE:
This output will be parsed by an app.
You must follow headings, labels, counts, and delimiters exactly.
Do not add extra sections.
Do not ask follow-up questions.
Do not replace required content with placeholders.
If any required heading, count, or JSON field is missing, output ONLY:
NOT APPROVED FOR GENERATION — revise concept for lower risk.

IMPORTANT — LARGE OUTPUT HANDLING (MANDATORY):
If output is too large for one response, you MUST:
1) Continue in multiple responses WITHOUT shortening or removing any mandatory sections.
2) End each partial response with: ⟪CONTINUE? Reply YES to continue.⟫
3) Never skip counts. Never compress away required lists. Never omit subparts.
4) Do NOT summarize. Do NOT shorten. Split only by section boundaries.

IMPORTANT — COPY-PASTE OUTPUT RULE (MANDATORY):
All reusable assets must be output in clean copy-paste format.
This includes:
- lyrics
- Suno prompts
- hook lines
- Grok scene prompt seeds (TEXT-TO-VIDEO)
- thumbnail prompts
- CapCut instructions
- Shorts/Reels scripts
- CTAs
- SEO titles
- descriptions
- hashtags
- tags
- link templates

COPY-PASTE FORMAT RULES:
- No tables.
- No extra commentary.
- Plain text only for reusable assets.
- Keep each reusable item on its own line unless a labeled block is required.
- Lyrics must preserve exact labels and line breaks.
- Prompts must be in one continuous paste-ready block.
- Titles/hooks/CTAs must be one item per line.
- Descriptions/templates must be a clean standalone block.

IMPORTANT — MACHINE PARSING RULES (MANDATORY):
1) Use ONLY the exact headings requested.
2) Do not rename headings.
3) After the human-readable package, output a machine-readable JSON block inside:
<<<JSON_START>>>
{valid JSON only}
<<<JSON_END>>>
4) The JSON must match the human-readable package exactly.
5) If you cannot produce both the human-readable package and valid JSON, output ONLY:
NOT APPROVED FOR GENERATION — revise concept for lower risk.

====================================================
0) HARD GATES (NON-NEGOTIABLE)
====================================================

GATE A — LOW RISK ONLY:
Generate ONLY if all are LOW:
- copyright similarity
- lyrics originality
- religious sensitivity
- AI pronunciation
- legal/platform safety
If any is not LOW → output ONLY the NOT APPROVED line.

GATE B — PUBLIC-DOMAIN INSPIRATION LIST (LOCKED, NO EXTRA NAMES):
You may use ONLY these categories as broad inspiration (themes/symbolism only):
- Vedas / Vedic imagery
- Upanishads
- Mahabharata
- Bhagavad Gita
- Ramayana
- Puranas
- Devi Mahatmya / Shakta traditions

FORBIDDEN:
- naming any additional text/title
- quoting verses/shlokas with chapter/verse citations
- copying or close paraphrase from modern translations, modern bhajans/aartis, chant arrangements, film/TV adaptations, websites, commentary wording
If you include ANY additional named text beyond the locked list → NOT APPROVED.

GATE C — SERIES RULE:
If user asks for N songs/series, generate ONLY the next song (one-by-one). Never bulk output.

GATE D — LANGUAGE + ACCENT RULE (MANDATORY):
Create TWO editions of the SAME concept:

1) Hindi+Sanskrit edition:
- MUST be 100% in देवनागरी only
- No Romanized Hindi anywhere
- No mixed-script lines
- Sanskrit also in देवनागरी where possible
- Vocal delivery direction: Indian accent / Indian pronunciation for Hindi & Sanskrit

2) English edition:
- English only and NOT a literal translation
- Vocal delivery direction: Western/International English accent for English lines
- Keep English idiomatic and natural

GATE E — ENGLISH LYRIC QUALITY GATE (MANDATORY):
The English edition must be as vibrant, vivid, and emotionally powerful as the Hindi+Sanskrit edition.
Requirements:
- Same emotional curve (restraint → rise → peak → resolve)
- Cinematic imagery and sensory detail
- Hooky, chantable chorus
- At least one declarative divine-identity line ("You are the…")
- No bland filler
If English is weaker/flatter → NOT APPROVED.

GATE F — GENRE RULE:
Choose ONE genre from this allowed pool:
Cinematic Devotional / Devotional Pop (Bhakti Pop) / Kirtan / Folk Energy / Meditative Mantra / Ambient Devotional / Epic Orchestral Devotional Rock / Devotional Rap / Devotional Hip-Hop / Devotional Trance / Devotional Hip-Hop Fusion / Devotional Trance Fusion / Classical-Crossover Devotional / Festival Processional Devotional

GATE G — CONTROLLED PUBLIC-DOMAIN CHANT / AARTI / BHAJAN PHRASE ALLOWANCE:
ALLOWED:
- Short mantra/chant fragments and traditional devotional epithets
- Short refrain-like phrases that are clearly traditional/common and not identifiable as a modern song's unique lyric

LIMITS:
1) Maximum total borrowed/traditional text across the entire song:
   - Hindi edition: up to 2 short chant lines + up to 2 micro-phrases (2–6 words each)
   - English edition: optional 1 micro-chant (2–4 words) OR none
2) Do NOT copy full aarti/bhajan verses, do NOT reproduce famous long couplets, do NOT paste well-known full choruses.
3) The MAIN chorus/hook must be YOUR ORIGINAL writing.
4) If any included chant phrase is widely identifiable as a famous recorded bhajan's core chorus, treat risk as NOT LOW → NOT APPROVED.
5) Do not imitate any existing musical arrangement associated with famous aartis/bhajans.

GATE H — NON-REPETITION:
Do not reuse hook structures, openings, Sanskrit phrase clusters, Suno prompt wording, visuals, thumbnails, Shorts angles.

GATE I — DYNAMIC SCENE PLANNING RULE:
Do NOT enforce a fixed scene count.

You MUST output:
- a PRE-AUDIO scene concept bank covering the full song arc across:
  - Intro
  - Verse 1
  - Pre-Chorus
  - Chorus
  - Verse 2
  - Bridge
  - Final Chorus
  - Outro
- for EACH scene concept: A) Grok Text-to-Video Prompt Seed + B) CapCut motion + C) Crop notes + D) Negative prompts
- enough scene concepts to cover the full narrative arc cleanly and flexibly
- scene concepts must be suitable for later remapping into dynamic timed clips after the best Suno audio candidate is selected

IMPORTANT:
The final number of generated video clips will be decided later based on:
- the actual duration of the winning Suno audio
- lyric timing
- chorus boundaries
- musical energy changes
- short-form extraction moments

Therefore:
- do NOT claim the scene concept count is final
- do NOT treat the pre-audio scene concept bank as the final timed video plan
- do NOT include any completeness audit rule that requires a fixed scene count

GATE J — OUTPUT DISCIPLINE:
- No tables.
- No extra sections.
- No extra commentary.
- Use ONLY the exact headings requested.

====================================================
1) VISUAL QUALITY & CONSISTENCY (NON-NEGOTIABLE)
====================================================

TEXT-TO-VIDEO ONLY RULE:
All scene visuals MUST be Grok-ready TEXT-TO-VIDEO prompt seeds only.
Do NOT create image prompts.
Do NOT reference image-to-video.
Do NOT reference any source frame.

ROLE / PERSON NAME RESTRICTION:
Do NOT mention any real person names, filmmaker names, celebrity names, artist names, or named creator styles.
Use only generic production language (cinematic framing, premium camera movement, controlled lighting, polished edit rhythm).

VISUAL CONSISTENCY RULE:
Do NOT output a separate Visual Bible section.

Instead, every scene prompt seed must independently enforce continuity across the project by including:
- recurring palette
- recurring motifs
- consistent subject appearance
- consistent environment language
- consistent camera and lighting language
- continuity-safe styling cues so each scene feels part of the same film world

Each Grok prompt seed must be self-contained and must include its own continuity enforcement so it can be used independently without referring to any separate visual bible.

VISUAL SAFETY RULE:
Avoid potentially misinterpreted sensitive symbols (DO NOT include swastika).
Use safe motifs only: lotus, mandala geometry, diyas, garlands, Om, bells, conch, sacred ash/tilak, flowers, temple stone textures, incense haze, divine rays, floating particles.

Every TEXT-TO-VIDEO scene prompt seed must include:
- cinematic quality direction
- subject(s) + action
- environment + time-of-day
- lighting plan
- camera plan (lens feel + angle + DOF)
- composition rule (symmetry / thirds / leading lines / central icon framing)
- camera movement (slow dolly / drift / crane / push / orbit / rack focus)
- micro-actions (breath / cloth movement / incense drift / hand gesture / jewelry sway / lamp flicker)
- atmosphere motion (mist / particles / incense / rays / smoke / petals / water ripples)
- lighting evolution (soft pulse / moving rays / glow rise / shadow shift)
- palette (2–4 colors)
- recurring continuity cues
- ultra-detail (fabric / jewelry / skin / stone / water / smoke)
- emotional beat
- edit note (single shot / dissolve / seamless continuation)
- public-safe note: no gore, no sexualization, no hate, no politics, no strobing/flashes, no text overlays
- crop-readiness for 16:9, 9:16, 1:1
- NEGATIVE line

MANDATORY NEGATIVE LINE:
NEGATIVE: no text, watermark, logo, subtitles, blur, low detail, extra limbs, bad hands, distorted face, asymmetrical eyes, duplicate jewelry, floating objects, cluttered background, cheap CGI look, oversaturated gold, muddy shadows, overexposed highlights, modern objects, crowd clutter

IMPORTANT — PRE-AUDIO SCENE LIMITATION:
These scene concepts are concept seeds only.
They are NOT the final timed clip list.
The final scene timing and final clip count will be decided later based on:
- the winning Suno audio duration
- lyric timing
- musical section boundaries
- energy shifts
- chorus placement
- short-form extraction opportunities

====================================================
2) OUTPUT FORMAT (EXACT HEADINGS ONLY)
====================================================

PHASE 1 — COMPLIANCE PLAN (brief)
1) Chosen Deity/Theme:
2) Inspiration category (ONLY from locked list; no extra names):
3) Story/Topic type:
4) Emotional arc (restraint→rise→peak→resolve):
5) Genre + why:
6) BPM + time signature:
7) Core hook phrase (देवनागरी only; no parentheses):
8) Pronunciation risks avoided:
9) Visual consistency approach: describe how recurring palette, motifs, subject appearance, environment tone, and camera/lighting continuity will be enforced directly inside every scene prompt seed.
10) Chant allowance plan:
- Which short traditional phrases will be used (max limits), and where (Intro/Bridge/Outro only preferred)
- Confirm chorus hook is original

Then write:
LOW-RISK-ONLY GATE CHECK: YES/NO
PROCEED TO PHASE 2: YES/NO
If PROCEED is NO → output ONLY the NOT APPROVED line.

PHASE 2 — GENERATE FULL PACKAGE
1) Title family (master / Hindi title / English title)
2) Deity/theme
3) Genre + why it matches story/reference
4) Story/topic type
5) Scriptural inspiration category (locked list only; broad)
6) Emotional arc
7) BPM + time signature
8) Instrumentation
9) Vocal direction (explicitly state Hindi=Indian accent, English=Western accent)

10) Suno prompt (Hindi edition) — COPY-PASTE BLOCK
Output exactly as:
SUNO HINDI PROMPT:
[paste-ready single block]

11) Suno prompt (English edition) — COPY-PASTE BLOCK
Output exactly as:
SUNO ENGLISH PROMPT:
[paste-ready single block]

12) Shorts-ready hook line (ONE LINE only) — COPY-PASTE LINE

13) Opening 10 seconds plan (hook placement) — COPY-PASTE BLOCK

14) Lyrics Hindi+Sanskrit (देवनागरी only) — COPY-PASTE BLOCK with EXACT labels:
[Intro]
[Verse 1]
[Pre-Chorus]
[Chorus]
[Verse 2]
[Bridge]
[Final Chorus]
[Outro]

15) Lyrics English — COPY-PASTE BLOCK with same labels (not literal translation)

16) PRE-AUDIO Scene Concept Bank with A–D each

Generate a flexible scene concept bank that covers the full emotional and narrative arc of the song.

IMPORTANT:
- Do NOT force a fixed total number of scenes
- Create as many scene concepts as needed to cover the full song concept cleanly
- These are PRE-AUDIO concept seeds only
- They are NOT the final timed clip list
- The final scene timing and final clip count will be determined later from the winning Suno audio candidate
- Each scene prompt must be fully self-contained
- Each scene prompt must carry its own continuity enforcement without relying on a separate visual bible section

For EACH scene concept, output exactly:

A) Grok Text-to-Video Prompt Seed (concept only)
Output exactly as:
SCENE CONCEPT [NUMBER] — GROK TEXT TO VIDEO PROMPT SEED:
[paste-ready single block]

B) CapCut motion
Output exactly as:
SCENE CONCEPT [NUMBER] — CAPCUT MOTION:
[paste-ready single block]

C) Crop notes
Output exactly as:
SCENE CONCEPT [NUMBER] — CROP NOTES:
16:9:
9:16:
1:1:

D) Negative prompts
Output exactly as:
SCENE CONCEPT [NUMBER] — NEGATIVE PROMPTS:
[paste-ready single line or block]

17) Thumbnails (4 items)
Output exactly as:
THUMBNAIL 1 — DESKTOP:
[paste-ready block]

THUMBNAIL 2 — MOBILE:
[paste-ready block]

THUMBNAIL 3 — MULTI-SOCIAL:
[paste-ready block]

THUMBNAIL 4 — CANVA GUIDE:
[paste-ready block]

18) CapCut plan (full bullets) — COPY-PASTE BLOCK

19) Shorts/Reels plan (5 Shorts + 5 Reels)

For each SHORT, output exactly:
SHORT [NUMBER]
HOOK:
[paste-ready line]
VISUAL PLAN:
[paste-ready block]
CAPTION:
[paste-ready line]
CTA:
[paste-ready line]

For each REEL, output exactly:
REEL [NUMBER]
HOOK:
[paste-ready line]
VISUAL PLAN:
[paste-ready block]
CAPTION:
[paste-ready line]
CTA:
[paste-ready line]

20) Redirect CTAs (6 items)
Output one CTA per line only

21) Metadata/SEO (all required counts)

10 MAIN TITLES:
(one title per line)

10 SHORTS TITLES:
(one title per line)

10 REELS HOOKS:
(one hook per line)

MAIN DESCRIPTION:
[paste-ready block]

SHORTS DESCRIPTION TEMPLATE:
[paste-ready block]

REELS DESCRIPTION TEMPLATE:
[paste-ready block]

KEYWORD CLUSTERS:
(one cluster per line)

HASHTAGS LIMITED:
(one paste-ready line)

TAGS SECONDARY:
(one comma-separated line)

LINK TEMPLATE PLACEHOLDERS:
(one template per line)

SEO RATIONALE:
[paste-ready concise block]

22) Commercial & risk review + manual review notes

23) Strict Risk Gate Result (all LOW + APPROVED)

FINAL STEP — COMPLETENESS AUDIT + CHECKSUM
(PASS/FAIL + SHORTS=5; REELS=5; TITLES=10/10/10; CTA=6)

The audit must confirm:
- scene concept bank is present and covers the full song arc
- Shorts = 5
- Reels = 5
- Main Titles = 10
- Shorts Titles = 10
- Reels Hooks = 10
- CTA = 6

If any required non-scene count fails → NOT APPROVED.
If the scene concept bank does not cover the full song arc → NOT APPROVED.

====================================================
3) REQUIRED JSON BLOCK FOR AUTOMATION
====================================================

After the human-readable package, output this exact delimiter line:
<<<JSON_START>>>

Then output valid JSON only with this top-level structure:

{
  "project_type": "devotional_song_package",
  "series_topic": "",
  "song_number": 1,
  "pre_audio_package": {
    "compliance": {
      "theme": "",
      "inspiration_category": "",
      "story_type": "",
      "emotional_arc": "",
      "genre": "",
      "genre_reason": "",
      "bpm": 0,
      "time_signature": "",
      "core_hook_phrase_devanagari": "",
      "pronunciation_risks_avoided": "",
      "visual_consistency_approach": "",
      "chant_allowance_plan": "",
      "low_risk_gate_check": true,
      "proceed_to_phase_2": true
    },
    "package": {
      "title_family": {
        "master": "",
        "hindi": "",
        "english": ""
      },
      "deity_theme": "",
      "genre_match_reason": "",
      "story_topic_type": "",
      "scriptural_inspiration_category": "",
      "emotional_arc": "",
      "bpm": 0,
      "time_signature": "",
      "instrumentation": "",
      "vocal_direction": {
        "hindi": "Indian accent",
        "english": "Western accent"
      },
      "suno_prompt_hindi": "",
      "suno_prompt_english": "",
      "shorts_ready_hook_line": "",
      "opening_10_seconds_plan": "",
      "lyrics": {
        "hindi_devanagari": "",
        "english": ""
      },
      "pre_audio_scene_concepts": [
        {
          "scene_concept_number": 1,
          "section": "",
          "grok_text_to_video_prompt_seed": "",
          "capcut_motion": "",
          "crop_notes": {
            "16:9": "",
            "9:16": "",
            "1:1": ""
          },
          "negative_prompts": ""
        }
      ],
      "thumbnails": [
        {
          "thumbnail_number": 1,
          "type": "DESKTOP",
          "prompt": ""
        }
      ],
      "capcut_plan": "",
      "shorts": [
        {
          "short_number": 1,
          "hook": "",
          "visual_plan": "",
          "caption": "",
          "cta": ""
        }
      ],
      "reels": [
        {
          "reel_number": 1,
          "hook": "",
          "visual_plan": "",
          "caption": "",
          "cta": ""
        }
      ],
      "redirect_ctas": [],
      "seo": {
        "main_titles": [],
        "shorts_titles": [],
        "reels_hooks": [],
        "main_description": "",
        "shorts_description_template": "",
        "reels_description_template": "",
        "keyword_clusters": [],
        "hashtags_limited": "",
        "tags_secondary": "",
        "link_template_placeholders": [],
        "seo_rationale": ""
      },
      "commercial_risk_review_manual_notes": "",
      "strict_risk_gate_result": {
        "all_low": true,
        "approved": true
      },
      "completeness_audit": {
        "pass": true,
        "scene_concept_bank_present": true,
        "full_song_arc_covered": true,
        "shorts": 5,
        "reels": 5,
        "titles_main": 10,
        "titles_shorts": 10,
        "titles_reels": 10,
        "ctas": 6
      }
    }
  }
}

Then output this exact delimiter line:
<<<JSON_END>>>

JSON RULES:
- JSON must be valid
- no trailing commas
- no comments
- exact counts must match the human-readable package
- Shorts count exactly 5
- Reels count exactly 5
- CTA count exactly 6
- Main titles exactly 10
- Shorts titles exactly 10
- Reels hooks exactly 10
- scene concept bank must be present and cover the full song arc

USER REQUEST:
${userRequest}`.trim();

// ─── JSON block extraction ────────────────────────────────────────────────────

/**
 * Extract the last JSON code block from a response string, if present.
 * Returns parsed object or null if none found / parse fails.
 */
function extractJsonBlock(text: string): Record<string, unknown> | null {
  // Primary: <<<JSON_START>>> / <<<JSON_END>>> delimiters (new format)
  const newMatch = text.match(/<<<JSON_START>>>\s*([\s\S]*?)\s*<<<JSON_END>>>/);
  if (newMatch) {
    try { return JSON.parse(newMatch[1].trim()) as Record<string, unknown>; } catch { /* fall through */ }
  }
  // Fallback: ```json ... ``` code blocks (legacy format)
  const codeMatches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (codeMatches.length === 0) return null;
  try {
    return JSON.parse(codeMatches[codeMatches.length - 1][1].trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── GeminiAdapter ────────────────────────────────────────────────────────────

export class GeminiAdapter extends BaseServiceAdapter {
  constructor(profilePath: string) {
    super('gemini', profilePath, { timeout: 120_000, navTimeout: 60_000 });
  }

  async isLoggedIn(page: Page): Promise<boolean> {
    const url = page.url();
    if (url.includes('accounts.google.com') || url.includes('/signin')) return false;

    try {
      await page
        .locator('div[contenteditable="true"], rich-textarea')
        .first()
        .waitFor({ timeout: 8_000, state: 'visible' });
      return true;
    } catch {
      return false;
    }
  }

  async execute(ctx: StageContext, selectors: SelectorMap): Promise<StageResult> {
    const page = await this.getPage();

    // Start capturing diagnostics up front
    const consoleCapture = captureConsoleErrors(page);

    try {
      this.log.info('execute', 'Navigating to Gemini', { url: GEMINI_URL });
      await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded' });
      await this.waitForNetworkIdle(page, 15_000);

      if (!(await this.isLoggedIn(page))) {
        consoleCapture.stop();
        return {
          success: false,
          error: 'Gemini: Not logged in. Please connect the Gemini browser profile from Settings.',
        };
      }

      // ── Build prompt ────────────────────────────────────────────────────────
      const prompt = DEVOTIONAL_PROMPT_TEMPLATE(ctx.project.devotional_theme);
      this.log.info('execute', 'Prompt built', {
        theme: ctx.project.devotional_theme,
        language: ctx.project.target_language,
        promptLength: prompt.length,
      });

      // ── Find input ──────────────────────────────────────────────────────────
      const inputSel = await this.resolveSelector('input_box', page, selectors);
      if (!inputSel) {
        throw new Error('Gemini: Could not find prompt input box');
      }

      this.log.debug('execute', 'Input selector resolved', { inputSel });
      await page.locator(inputSel).first().click();

      // Use keyboard.insertText for large prompts — avoids slow character-by-character typing
      await page.keyboard.insertText(prompt);
      this.log.info('execute', 'Prompt entered');

      // ── Submit ──────────────────────────────────────────────────────────────
      const sendSel = await this.resolveSelector('send_button', page, selectors);
      if (sendSel) {
        this.log.debug('execute', 'Clicking send button', { sendSel });
        await page.locator(sendSel).first().click();
      } else {
        this.log.debug('execute', 'Send button not found — pressing Enter');
        await page.keyboard.press('Enter');
      }

      // ── Wait for response container ─────────────────────────────────────────
      this.log.info('execute', 'Waiting for response to appear…');

      // Small initial delay before polling — Gemini shows a loading state first
      await page.waitForTimeout(2_000);

      const respSel = await this.resolveSelector('response_container', page, selectors);
      if (!respSel) {
        throw new Error('Gemini: Could not locate response container selector');
      }

      await page.locator(respSel).last().waitFor({ timeout: 60_000, state: 'visible' });
      this.log.debug('execute', 'Response container visible');

      // ── Wait for streaming to complete ──────────────────────────────────────
      // Strategy 1: wait until the stop/cancel button disappears
      const stopSel = await this.resolveSelector('stop_button', page, selectors);
      if (stopSel) {
        this.log.debug('execute', 'Waiting for stop button to disappear…');
        await page
          .locator(stopSel)
          .first()
          .waitFor({ state: 'hidden', timeout: 300_000 })
          .catch(() => {
            this.log.warn('execute', 'Stop button wait timed out — proceeding with text capture');
          });
      }

      // Strategy 2: wait for text to stabilise (handles cases where stop button isn't present)
      this.log.info('execute', 'Waiting for response text to stabilise…');
      await scrollToBottom(page).catch(() => {});

      const responseText = await waitForStableText(page, respSel, {
        stableCount: 3,
        pollIntervalMs: 2_000,
        timeoutMs: 300_000,
      });

      if (!responseText || responseText.trim().length < 50) {
        throw new Error(
          `Gemini response was empty or too short (${responseText?.length ?? 0} chars)`
        );
      }

      this.log.info('execute', 'Response captured', { length: responseText.length });

      // ── Extract JSON block if present ───────────────────────────────────────
      const jsonData = extractJsonBlock(responseText);
      if (jsonData) {
        this.log.debug('execute', 'JSON block extracted from response');
      }

      // ── Save raw output ─────────────────────────────────────────────────────
      fs.mkdirSync(ctx.runDir, { recursive: true });
      const outputFile = path.join(ctx.runDir, 'gemini_raw_output.txt');
      fs.writeFileSync(outputFile, responseText, 'utf-8');
      this.log.info('execute', 'Raw output saved', { outputFile });

      // Capture success screenshot
      const screenshotPath = path.join(ctx.runDir, 'gemini_success.png');
      await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

      consoleCapture.stop();

      return {
        success: true,
        output: {
          raw_response: responseText,
          output_file: outputFile,
          response_length: responseText.length,
          ...(jsonData ? { json_data: jsonData } : {}),
        },
        assetPaths: [
          { path: outputFile, type: 'document', name: 'Gemini Raw Output', mimeType: 'text/plain' },
          ...(fs.existsSync(screenshotPath)
            ? [{ path: screenshotPath, type: 'screenshot' as const, name: 'Gemini Success Screenshot' }]
            : []),
        ],
      };
    } catch (err) {
      this.log.error('execute', `Gemini execution failed: ${String(err)}`);
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
    }
  }
}

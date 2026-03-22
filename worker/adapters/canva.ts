/**
 * Canva adapter — thumbnail brief preparation and optional Canva web handoff.
 *
 * Primary work is *local* (deterministic brief generation from project data)
 * with an optional browser-automation step to open a new Canva design
 * at the correct dimensions for the designer.
 *
 * Stage input (ctx.stageRun.input):
 *   song_title            string   optional — falls back to project name
 *   devotional_theme      string   optional — falls back to project theme
 *   audio_mood            string   optional — defaults to "devotional, uplifting"
 *   primary_color         string   CSS hex — defaults to #1A0533
 *   accent_color          string   CSS hex — defaults to #FFD700
 *   neutral_color         string   CSS hex — defaults to #F5F0E8
 *   font_stack            string[] length-3 — defaults to [Cinzel, Playfair Display, Noto Sans]
 *   background_image_hint string   optional
 *   headline_override     string   optional
 *   subtitle_text         string   optional
 *   cta_text              string   optional
 *   formats               string[] subset of ThumbnailFormat — defaults to all four
 *   open_in_canva         boolean  optional — if true, opens the desktop brief in Canva web
 *
 * Stage output (result.output):
 *   run_dir               string
 *   manifest_path         string
 *   formats_generated     string[]
 *   brief_paths           Record<ThumbnailFormat, string | null>
 *   guide_paths           Record<ThumbnailFormat, string | null>
 */

import type { Page } from 'playwright';
import { BaseServiceAdapter, type SelectorMap } from './base';
import type { StageContext, StageResult } from '@/types';
import { registerDefaults, captureDiagnosticBundle } from '../browser';
import {
  buildThumbnailBriefs,
  saveThumbnailBriefRun,
  CRITICAL_CANVA_RULES,
  WARN_CANVA_RULES,
  ThumbnailFormatSchema,
} from '@/lib/canva';
import type { ThumbnailBriefRequest, ThumbnailFormat } from '@/lib/canva';

const CANVA_URL = 'https://www.canva.com';
const CANVA_NEW_DESIGN_URL = 'https://www.canva.com/design/new';

// ─── Selector defaults ────────────────────────────────────────────────────────

registerDefaults('canva', {
  login_indicator: [
    '[data-testid="user-avatar"]',
    'button[aria-label*="Account" i]',
    '[data-testid="home-header-user-menu"]',
    'img[alt*="profile" i]',
    '[class*="UserAvatar"]',
  ],
  create_design_button: [
    'button:has-text("Create a design")',
    '[data-testid="create-a-design"]',
    'a[href*="/design/new"]',
    'button:has-text("New design")',
  ],
  custom_size_button: [
    'button:has-text("Custom size")',
    '[data-testid="custom-size"]',
    'button[aria-label*="custom size" i]',
  ],
  width_input: [
    'input[aria-label*="width" i]',
    'input[placeholder*="width" i]',
    '[data-testid="custom-width-input"]',
  ],
  height_input: [
    'input[aria-label*="height" i]',
    'input[placeholder*="height" i]',
    '[data-testid="custom-height-input"]',
  ],
  create_confirm_button: [
    'button:has-text("Create new design")',
    'button[type="submit"]:has-text("Create")',
    '[data-testid="create-design-button"]',
  ],
  editor_canvas: [
    '[data-testid="canvas"]',
    '[class*="DesignCanvas"]',
    '[class*="editorCanvas"]',
    'canvas',
  ],
});

// ─── CanvaAdapter ─────────────────────────────────────────────────────────────

export class CanvaAdapter extends BaseServiceAdapter {
  constructor(profilePath: string) {
    super('canva', profilePath);
  }

  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      await page.goto(CANVA_URL, { waitUntil: 'networkidle', timeout: 30_000 });
      const loginBtn = await page.locator('a[href*="/login"], button:has-text("Log in")').count();
      return loginBtn === 0;
    } catch {
      return false;
    }
  }

  async execute(ctx: StageContext, selectors: SelectorMap): Promise<StageResult> {
    const input = (ctx.stageRun.input ?? {}) as Record<string, unknown>;
    const openInCanva = Boolean(input.open_in_canva ?? false);

    // ── Build brief request from stage input + project data ──────────────────

    const req = buildBriefRequest(input, ctx.project.name, ctx.project.devotional_theme);

    // ── Generate briefs locally — no browser required ────────────────────────

    this.log.info('brief', 'Building thumbnail briefs locally…');
    let briefs: Map<ThumbnailFormat, import('@/lib/canva').ThumbnailBrief>;
    try {
      briefs = buildThumbnailBriefs(req);
    } catch (err) {
      return {
        success: false,
        error: `Brief generation failed: ${String(err)}`,
      };
    }
    this.log.info('brief', `Generated ${briefs.size} brief(s): ${[...briefs.keys()].join(', ')}`);

    // ── Save artifacts to disk ───────────────────────────────────────────────

    this.log.info('storage', 'Writing brief artifacts…');
    const briefRun = saveThumbnailBriefRun(briefs, req, ctx.runDir);
    this.log.info('storage', `Manifest: ${briefRun.manifest_path}`);

    // ── Apply validation rules ───────────────────────────────────────────────

    const errors: string[] = [];
    const warnings: string[] = [];

    for (const rule of CRITICAL_CANVA_RULES) {
      if (!rule.check(briefRun)) errors.push(rule.message(briefRun));
    }
    for (const rule of WARN_CANVA_RULES) {
      if (!rule.check(briefRun)) warnings.push(rule.message(briefRun));
    }

    if (errors.length > 0) {
      return {
        success: false,
        error: errors.join('; '),
        output: briefRun as unknown as Record<string, unknown>,
      };
    }

    // ── Optional: open desktop design in Canva web ───────────────────────────

    const assetPaths: StageResult['assetPaths'] = [];

    // Collect guide markdown paths as document assets
    for (const format of briefRun.formats_generated) {
      const guidePath = briefRun.guide_paths[format];
      const briefPath = briefRun.brief_paths[format];
      if (guidePath) {
        assetPaths.push({ path: guidePath, type: 'document', name: `Canva Guide — ${format}` });
      }
      if (briefPath) {
        assetPaths.push({ path: briefPath, type: 'document', name: `Thumbnail Brief — ${format}` });
      }
    }

    if (openInCanva) {
      const handoffWarning = await this.openDesktopBriefInCanva(
        selectors,
        briefRun.brief_paths['desktop'],
        ctx.runDir,
        ctx.stageRun.stage_key
      );
      if (handoffWarning) warnings.push(handoffWarning);
    }

    // Surface any accumulated warnings as a single warning string in output
    return {
      success: true,
      output: {
        ...(briefRun as unknown as Record<string, unknown>),
        ...(warnings.length > 0 ? { warnings } : {}),
      },
      assetPaths,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Open a new Canva design at 1280×720 (YouTube thumbnail dimensions) and
   * navigate the editor to be ready for the designer.
   *
   * Returns a warning string on failure, or null on success.
   * Never throws — browser errors are caught internally.
   */
  private async openDesktopBriefInCanva(
    selectors: SelectorMap,
    briefPath: string | null,
    runDir: string,
    stageKey: string
  ): Promise<string | null> {
    if (!briefPath) {
      return 'Desktop brief path is null — skipping Canva web handoff';
    }

    let page: Page;
    try {
      page = await this.getPage();
    } catch (err) {
      return `Could not launch browser for Canva handoff: ${String(err)}`;
    }

    try {
      this.log.info('navigate', 'Opening Canva for desktop brief handoff (1280×720)…');
      await page.goto(CANVA_NEW_DESIGN_URL, { waitUntil: 'networkidle', timeout: 30_000 });

      // Try custom size flow
      const customSizeSel = this.sel(
        selectors,
        'custom_size_button',
        'button:has-text("Custom size"), [data-testid="custom-size"]'
      );
      const customSizeEl = await this.findFirst(page, customSizeSel.split(',').map((s) => s.trim()), 8_000);

      if (customSizeEl) {
        await page.locator(customSizeEl).first().click();
        await page.waitForTimeout(800);

        const widthSel = this.sel(selectors, 'width_input', 'input[aria-label*="width" i]');
        const heightSel = this.sel(selectors, 'height_input', 'input[aria-label*="height" i]');

        const widthEl = await this.findFirst(page, widthSel.split(',').map((s) => s.trim()), 5_000);
        if (widthEl) {
          await page.locator(widthEl).first().click({ clickCount: 3 });
          await page.locator(widthEl).first().fill('1280');
        }
        const heightEl = await this.findFirst(page, heightSel.split(',').map((s) => s.trim()), 5_000);
        if (heightEl) {
          await page.locator(heightEl).first().click({ clickCount: 3 });
          await page.locator(heightEl).first().fill('720');
        }

        // Submit
        const createSel = this.sel(
          selectors,
          'create_confirm_button',
          'button:has-text("Create new design"), button[type="submit"]'
        );
        const createEl = await this.findFirst(page, createSel.split(',').map((s) => s.trim()), 5_000);
        if (createEl) {
          await page.locator(createEl).first().click();
          const editorSel = this.sel(selectors, 'editor_canvas', 'canvas, [data-testid="canvas"]');
          await page.waitForSelector(editorSel, { timeout: 30_000 });
          this.log.info('navigate', `Canva editor opened at 1280×720 — brief at: ${briefPath}`);
        }
      } else {
        this.log.info('navigate', 'Custom size UI not detected — Canva opened to design selector');
      }

      return null; // success
    } catch (err) {
      await captureDiagnosticBundle(page, runDir, `${stageKey}_canva_handoff`);
      return `Canva web handoff failed (briefs still saved): ${String(err)}`;
    }
  }
}

// ─── Input builder ────────────────────────────────────────────────────────────

const DEFAULT_PRIMARY = '#1A0533';
const DEFAULT_ACCENT  = '#FFD700';
const DEFAULT_NEUTRAL = '#F5F0E8';
const DEFAULT_FONTS: [string, string, string] = ['Cinzel', 'Playfair Display', 'Noto Sans'];

function buildBriefRequest(
  input: Record<string, unknown>,
  projectName: string,
  projectTheme: string
): ThumbnailBriefRequest {
  // Font stack — accept 3-element array or fall back to default
  let fontStack: [string, string, string] = DEFAULT_FONTS;
  if (Array.isArray(input.font_stack) && input.font_stack.length >= 3) {
    fontStack = [
      String(input.font_stack[0]),
      String(input.font_stack[1]),
      String(input.font_stack[2]),
    ];
  }

  // Formats — validate each entry against the schema enum
  let formats: ThumbnailFormat[] | undefined;
  if (Array.isArray(input.formats) && input.formats.length > 0) {
    const parsed = (input.formats as unknown[])
      .map((f) => ThumbnailFormatSchema.safeParse(f))
      .filter((r): r is { success: true; data: ThumbnailFormat } => r.success)
      .map((r) => r.data);
    if (parsed.length > 0) formats = parsed;
  }

  return {
    song_title:            String(input.song_title ?? projectName),
    devotional_theme:      String(input.devotional_theme ?? projectTheme),
    audio_mood:            String(input.audio_mood ?? 'devotional, uplifting'),
    primary_color:         String(input.primary_color ?? DEFAULT_PRIMARY),
    accent_color:          String(input.accent_color ?? DEFAULT_ACCENT),
    neutral_color:         String(input.neutral_color ?? DEFAULT_NEUTRAL),
    font_stack:            fontStack,
    background_image_hint: String(input.background_image_hint ?? ''),
    headline_override:     input.headline_override ? String(input.headline_override) : undefined,
    subtitle_text:         input.subtitle_text     ? String(input.subtitle_text)     : undefined,
    cta_text:              input.cta_text          ? String(input.cta_text)          : undefined,
    formats,
  };
}

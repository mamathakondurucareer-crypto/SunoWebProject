/**
 * CapCut handoff package builder.
 *
 * All functions are deterministic — no LLM, no browser, no async.
 * Input is assembled from prior stage outputs; output is a set of
 * in-memory data structures ready to be written to disk by storage.ts.
 */

import type {
  CapCutPackageRequest,
  CapCutClipEntry,
  CapCutTimeline,
  VideoTrackEntry,
  AudioTrackEntry,
  SubtitleTrackEntry,
  SrtEntry,
  HookMoment,
  ShortsExtractionWindow,
} from './types';
import type { SceneSegment, GrokSceneResult } from './types';

// ─── Transition vocabulary ────────────────────────────────────────────────────

const TRANSITION_BY_ENERGY: Record<string, { in: string; out: string }> = {
  low:    { in: 'dissolve 0.8s',   out: 'dissolve 0.8s' },
  medium: { in: 'dissolve 0.5s',   out: 'dissolve 0.5s' },
  high:   { in: 'hard cut',        out: 'hard cut' },
};

const TRANSITION_ON_HOOK: { in: string; out: string } = {
  in: 'hard cut', out: 'hard cut',
};

const TRANSITION_ON_SECTION_CHANGE: { in: string; out: string } = {
  in: 'cross-dissolve 0.6s', out: 'cross-dissolve 0.6s',
};

// ─── Clip Manifest ────────────────────────────────────────────────────────────

/**
 * Build the ordered list of CapCutClipEntry objects.
 *
 * Merges scene plan data with Grok results and hook moment markers.
 * Assigns motion notes, transitions, and lyric overlay hints.
 */
export function buildClipsManifest(req: CapCutPackageRequest): CapCutClipEntry[] {
  // Index Grok results by scene number for O(1) lookup
  const grokByScene = new Map<number, GrokSceneResult>();
  for (const r of req.grok_results) {
    grokByScene.set(r.scene_number, r);
  }

  // Index hook moments by scene (a hook is "in" a scene if its timestamp falls within)
  function hookForScene(scene: SceneSegment): HookMoment | undefined {
    return req.hook_moments.find(
      (h) => h.timestamp_sec >= scene.start_sec && h.timestamp_sec < scene.end_sec
    );
  }

  return req.scenes.map((scene, idx): CapCutClipEntry => {
    const grok = grokByScene.get(scene.scene_number);
    const hook = hookForScene(scene);
    const prevScene = req.scenes[idx - 1];
    const nextScene = req.scenes[idx + 1];

    // Section-change transition override
    const sectionChanged = prevScene && prevScene.section !== scene.section;
    const nextSectionChanges = nextScene && nextScene.section !== scene.section;

    let transIn: string;
    let transOut: string;

    if (hook) {
      transIn = TRANSITION_ON_HOOK.in;
      transOut = TRANSITION_ON_HOOK.out;
    } else if (sectionChanged) {
      transIn = TRANSITION_ON_SECTION_CHANGE.in;
      transOut = TRANSITION_BY_ENERGY[scene.energy]?.out ?? 'dissolve 0.5s';
    } else {
      const base = TRANSITION_BY_ENERGY[scene.energy] ?? { in: 'dissolve 0.5s', out: 'dissolve 0.5s' };
      transIn = base.in;
      transOut = nextSectionChanges ? TRANSITION_ON_SECTION_CHANGE.out : base.out;
    }

    // First clip always hard-cuts in from black
    if (idx === 0) transIn = 'fade-from-black 1.0s';
    // Last clip fades to black
    if (idx === req.scenes.length - 1) transOut = 'fade-to-black 1.0s';

    // Lyric overlay — show if lyric_excerpt is short (≤ 60 chars) and scene is verse/chorus
    let lyricOverlay: CapCutClipEntry['lyric_overlay'];
    const excerpt = scene.lyric_excerpt.trim();
    if (
      excerpt.length > 0 &&
      excerpt.length <= 60 &&
      (scene.section === 'chorus' || scene.section === 'final_chorus' || scene.section === 'verse')
    ) {
      lyricOverlay = {
        text: excerpt,
        position: scene.section === 'chorus' || scene.section === 'final_chorus' ? 'center' : 'bottom',
        style: scene.section === 'chorus' || scene.section === 'final_chorus' ? 'subtitle' : 'caption',
      };
    }

    const clipPath = grok?.video_path ?? null;

    return {
      scene_number:   scene.scene_number,
      start_sec:      scene.start_sec,
      end_sec:        scene.end_sec,
      duration_sec:   parseFloat((scene.end_sec - scene.start_sec).toFixed(3)),
      section:        scene.section,
      lyric_excerpt:  scene.lyric_excerpt,
      energy:         scene.energy,
      clip_path:      clipPath,
      clip_available: clipPath !== null,
      grok_prompt:    grok?.grok_prompt ?? scene.grok_text_to_video_prompt_seed,
      motion_note:    scene.capcut_motion,
      transition_in:  transIn,
      transition_out: transOut,
      is_hook_moment: hook !== undefined,
      ...(hook ? { hook_note: `${hook.emphasis_type}: ${hook.description}` } : {}),
      ...(lyricOverlay ? { lyric_overlay: lyricOverlay } : {}),
    };
  });
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

/**
 * Build a multi-track CapCutTimeline from the clips manifest.
 *
 * The video track contains one entry per scene in chronological order.
 * The audio track is a single entry spanning the full duration.
 * The subtitle track mirrors the clip manifest lyric overlays.
 */
export function buildTimeline(req: CapCutPackageRequest, clips: CapCutClipEntry[]): CapCutTimeline {
  const videoTrack: VideoTrackEntry[] = clips.map((clip, idx): VideoTrackEntry => ({
    clip_id:        `v${String(idx + 1).padStart(3, '0')}`,
    scene_number:   clip.scene_number,
    in_point:       0,
    out_point:      clip.duration_sec,
    timeline_start: clip.start_sec,
    timeline_end:   clip.end_sec,
    clip_path:      clip.clip_path,
  }));

  const audioTrack: AudioTrackEntry[] = [
    {
      clip_id:        'a001',
      audio_path:     req.winner_audio_path,
      in_point:       0,
      out_point:      req.audio_duration_seconds,
      timeline_start: 0,
      timeline_end:   req.audio_duration_seconds,
      volume:         100,
    },
  ];

  const subtitleTrack: SubtitleTrackEntry[] = clips
    .filter((c) => c.lyric_overlay !== undefined)
    .map((c, idx): SubtitleTrackEntry => ({
      index:      idx + 1,
      start_sec:  c.start_sec,
      end_sec:    c.end_sec,
      text:       c.lyric_overlay!.text,
      position:   c.lyric_overlay!.position,
    }));

  return {
    project_name:   req.song_title,
    fps:            req.fps,
    resolution:     req.resolution,
    duration_sec:   req.audio_duration_seconds,
    video_track:    videoTrack,
    audio_track:    audioTrack,
    subtitle_track: subtitleTrack,
  };
}

// ─── SRT Subtitles ────────────────────────────────────────────────────────────

/**
 * Build SRT subtitle entries from lyrics + scene timing.
 *
 * Strategy:
 *   1. Parse the full lyrics string into non-empty, non-header lines.
 *   2. Map each line to a scene — first by lyric_excerpt substring match,
 *      then by distributing remaining lines proportionally across the timeline.
 *   3. Each subtitle occupies its scene's time window (min 1.5s per entry).
 */
export function buildSrtEntries(req: CapCutPackageRequest): SrtEntry[] {
  const allLines = parseLyricLines(req.lyrics);
  if (allLines.length === 0) {
    // Fallback: use per-scene lyric_excerpt as subtitles
    return req.scenes
      .filter((s) => s.lyric_excerpt.trim().length > 0)
      .map((s, idx): SrtEntry => ({
        index:     idx + 1,
        start_sec: s.start_sec,
        end_sec:   Math.max(s.start_sec + 1.5, s.end_sec),
        text:      s.lyric_excerpt,
      }));
  }

  // Distribute all lyric lines proportionally across the full duration
  const totalLines = allLines.length;
  const totalDuration = req.audio_duration_seconds;
  const secondsPerLine = totalDuration / totalLines;

  return allLines.map((line, idx): SrtEntry => {
    const start = idx * secondsPerLine;
    const end   = Math.min(start + secondsPerLine, totalDuration);
    return {
      index:     idx + 1,
      start_sec: parseFloat(start.toFixed(3)),
      end_sec:   parseFloat(end.toFixed(3)),
      text:      line,
    };
  });
}

/** Parse a raw lyrics string, returning only non-empty, non-header lines. */
function parseLyricLines(lyrics: string): string[] {
  return lyrics
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('['));
}

/** Render SrtEntry[] to the standard SRT text format. */
export function renderSrt(entries: SrtEntry[]): string {
  return entries
    .map((e) => `${e.index}\n${srtTimecode(e.start_sec)} --> ${srtTimecode(e.end_sec)}\n${e.text}`)
    .join('\n\n');
}

function srtTimecode(sec: number): string {
  const h  = Math.floor(sec / 3600);
  const m  = Math.floor((sec % 3600) / 60);
  const s  = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return (
    `${String(h).padStart(2, '0')}:` +
    `${String(m).padStart(2, '0')}:` +
    `${String(s).padStart(2, '0')},` +
    `${String(ms).padStart(3, '0')}`
  );
}

// ─── Auto-detect hook moments ─────────────────────────────────────────────────

/**
 * If the caller provides no hook moments, auto-detect from scene data.
 * Selects the first scene of each chorus/final_chorus section and
 * marks high-energy verses as lyric_punch moments.
 */
export function autoDetectHookMoments(req: CapCutPackageRequest): HookMoment[] {
  const hooks: HookMoment[] = [];
  const seenSections = new Set<string>();

  for (const scene of req.scenes) {
    const key = `${scene.section}_${Math.floor(scene.start_sec / 30)}`;
    if (
      (scene.section === 'chorus' || scene.section === 'final_chorus') &&
      !seenSections.has(key)
    ) {
      seenSections.add(key);
      hooks.push({
        timestamp_sec:  scene.start_sec,
        description:    `${scene.section} entry — "${scene.lyric_excerpt.slice(0, 40)}"`,
        lyric_line:     scene.lyric_excerpt,
        emphasis_type:  scene.section === 'final_chorus' ? 'visual_climax' : 'chorus_entry',
      });
    } else if (scene.energy === 'high' && scene.section === 'verse' && !seenSections.has(key)) {
      seenSections.add(key);
      hooks.push({
        timestamp_sec:  scene.start_sec,
        description:    `High-energy verse — "${scene.lyric_excerpt.slice(0, 40)}"`,
        lyric_line:     scene.lyric_excerpt,
        emphasis_type:  'lyric_punch',
      });
    }
  }

  return hooks;
}

// ─── Auto-detect Shorts windows ───────────────────────────────────────────────

/**
 * If the caller provides no shorts windows, auto-select up to 2 windows:
 *   1. First chorus (aim for 15–60 s window starting at chorus entry)
 *   2. Outro / final-chorus region as a "highlight" window
 */
export function autoDetectShortsWindows(req: CapCutPackageRequest): ShortsExtractionWindow[] {
  const windows: ShortsExtractionWindow[] = [];

  const choruses = req.scenes.filter(
    (s) => s.section === 'chorus' || s.section === 'final_chorus'
  );

  // First chorus window (up to 60 s)
  const firstChorus = choruses[0];
  if (firstChorus) {
    const start = firstChorus.start_sec;
    // Extend through consecutive chorus scenes, capping at 60 s
    let end = firstChorus.end_sec;
    for (const s of choruses) {
      if (s.start_sec >= start && s.end_sec - start <= 60) end = s.end_sec;
    }
    windows.push({
      start_sec:    parseFloat(start.toFixed(3)),
      end_sec:      parseFloat(Math.min(end, start + 60).toFixed(3)),
      rationale:    'First chorus — highest emotional impact, strong hook potential',
      platform:     'YouTube Shorts',
      reframe_note: 'Keep subject centered; crop left/right evenly for 9:16 reframe',
    });
    // Add second window for Reels if long enough
    if (end - start >= 30) {
      windows.push({
        start_sec:    parseFloat(start.toFixed(3)),
        end_sec:      parseFloat(Math.min(start + 30, end).toFixed(3)),
        rationale:    'Condensed 30-second chorus cut for Reels',
        platform:     'Instagram Reels',
        reframe_note: 'Keep subject centered; crop left/right evenly for 9:16 reframe',
      });
    }
  }

  // Final chorus window
  const finalChorus = req.scenes.find((s) => s.section === 'final_chorus');
  if (finalChorus && finalChorus.end_sec - finalChorus.start_sec >= 15) {
    const end = Math.min(finalChorus.start_sec + 45, req.audio_duration_seconds);
    windows.push({
      start_sec:    parseFloat(finalChorus.start_sec.toFixed(3)),
      end_sec:      parseFloat(end.toFixed(3)),
      rationale:    'Final chorus / climax — strong closing moment for TikTok',
      platform:     'TikTok',
      reframe_note: 'Keep subject centered; aggressive crop for vertical format',
    });
  }

  return windows;
}

// ─── Edit manifest markdown ───────────────────────────────────────────────────

/**
 * Render the full human-readable edit_manifest.md guide.
 *
 * Sections:
 *   - Project overview
 *   - Scene-by-scene table (scene / timing / section / energy / clip status / motion)
 *   - Motion notes (one line per scene)
 *   - Transition notes (entry/exit for every scene)
 *   - Lyric overlay notes (position, style, timing)
 *   - Hook moments
 *   - Shorts / Reels extraction guide
 *   - Export recommendations
 *   - Missing clip report
 */
export function renderEditManifestMarkdown(
  req: CapCutPackageRequest,
  clips: CapCutClipEntry[],
  shortsWindows: ShortsExtractionWindow[]
): string {
  const availableCount = clips.filter((c) => c.clip_available).length;
  const missingCount   = clips.length - availableCount;
  const totalMin       = Math.floor(req.audio_duration_seconds / 60);
  const totalSec       = Math.round(req.audio_duration_seconds % 60);

  const lines: string[] = [];

  // ── Header ─────────────────────────────────────────────────────────────────
  lines.push(`# CapCut Edit Package: ${req.song_title}`);
  lines.push('');
  lines.push(`> **Theme:** ${req.devotional_theme}`);
  lines.push(`> **Duration:** ${totalMin}:${String(totalSec).padStart(2, '0')}  **Scenes:** ${clips.length}  **Clips available:** ${availableCount}/${clips.length}`);
  lines.push(`> **Target format:** ${req.target_aspect_ratio} · ${req.resolution.width}×${req.resolution.height} · ${req.fps}fps`);
  lines.push(`> **Audio:** ${req.winner_audio_path ?? '⚠ Not yet available — add manually'}`);
  lines.push('');

  // ── Scene table ────────────────────────────────────────────────────────────
  lines.push('## Scene Timeline');
  lines.push('');
  lines.push('| # | Start | End | Section | Energy | Clip | Motion |');
  lines.push('|---|-------|-----|---------|--------|------|--------|');
  for (const clip of clips) {
    const start = formatTimecode(clip.start_sec);
    const end   = formatTimecode(clip.end_sec);
    const status = clip.clip_available ? '✓' : '✗ MISSING';
    lines.push(
      `| ${clip.scene_number} | ${start} | ${end} | ${clip.section} | ${clip.energy} | ${status} | ${clip.motion_note} |`
    );
  }
  lines.push('');

  // ── Motion notes ───────────────────────────────────────────────────────────
  lines.push('## Motion Notes');
  lines.push('');
  lines.push('Apply these camera / clip motion settings per scene in CapCut:');
  lines.push('');
  for (const clip of clips) {
    lines.push(`**Scene ${clip.scene_number}** (${formatTimecode(clip.start_sec)}–${formatTimecode(clip.end_sec)}, ${clip.section})`);
    lines.push(`→ ${clip.motion_note}`);
    if (clip.is_hook_moment && clip.hook_note) {
      lines.push(`→ 🎯 Hook: ${clip.hook_note}`);
    }
    lines.push('');
  }

  // ── Transition notes ───────────────────────────────────────────────────────
  lines.push('## Transition Notes');
  lines.push('');
  lines.push('| Scene → Scene | Transition |');
  lines.push('|---------------|------------|');
  for (let i = 0; i < clips.length - 1; i++) {
    const cur  = clips[i]!;
    const next = clips[i + 1]!;
    lines.push(`| ${cur.scene_number} → ${next.scene_number} | ${cur.transition_out} |`);
  }
  lines.push('');
  lines.push('> First scene fades in from black. Last scene fades to black.');
  lines.push('');

  // ── Lyric overlay notes ────────────────────────────────────────────────────
  const withOverlay = clips.filter((c) => c.lyric_overlay !== undefined);
  if (withOverlay.length > 0) {
    lines.push('## Lyric Overlay Notes');
    lines.push('');
    lines.push('Add these text overlays in the CapCut text layer:');
    lines.push('');
    lines.push('| Scene | Timing | Text | Position | Style |');
    lines.push('|-------|--------|------|----------|-------|');
    for (const clip of withOverlay) {
      const ov = clip.lyric_overlay!;
      lines.push(
        `| ${clip.scene_number} | ${formatTimecode(clip.start_sec)}–${formatTimecode(clip.end_sec)} | "${ov.text}" | ${ov.position} | ${ov.style} |`
      );
    }
    lines.push('');
    lines.push('> **Font recommendation:** Use the project\'s primary font (devotional / serif style).');
    lines.push('> **Color:** White with a subtle drop shadow for legibility on dark backgrounds.');
    lines.push('');
  }

  // ── Hook moments ───────────────────────────────────────────────────────────
  const hooks = req.hook_moments;
  if (hooks.length > 0) {
    lines.push('## Hook Moments');
    lines.push('');
    lines.push('These timestamps carry the highest emotional weight. Ensure cuts, zooms, or overlays land precisely here:');
    lines.push('');
    for (const hook of hooks) {
      lines.push(`- **${formatTimecode(hook.timestamp_sec)}** — ${hook.emphasis_type}: ${hook.description}`);
      if (hook.lyric_line) lines.push(`  > "${hook.lyric_line}"`);
    }
    lines.push('');
  }

  // ── Shorts / Reels extraction guide ───────────────────────────────────────
  if (shortsWindows.length > 0) {
    lines.push('## Shorts / Reels Extraction');
    lines.push('');
    lines.push('Extract these windows from the master edit for short-form platforms:');
    lines.push('');
    for (const w of shortsWindows) {
      const dur = (w.end_sec - w.start_sec).toFixed(1);
      lines.push(`### ${w.platform}`);
      lines.push(`- **Window:** ${formatTimecode(w.start_sec)} → ${formatTimecode(w.end_sec)} (${dur}s)`);
      lines.push(`- **Rationale:** ${w.rationale}`);
      lines.push(`- **Reframe:** ${w.reframe_note}`);
      lines.push('');
    }
  }

  // ── Export recommendations ─────────────────────────────────────────────────
  lines.push('## Export Recommendations');
  lines.push('');
  lines.push('### YouTube (Primary)');
  lines.push('- **Format:** MP4 (H.264)');
  lines.push('- **Resolution:** 1920×1080 (1080p)');
  lines.push(`- **Frame rate:** ${req.fps}fps`);
  lines.push('- **Bitrate:** 12–20 Mbps');
  lines.push('- **Audio:** AAC 320 kbps');
  lines.push('- **Color space:** Rec. 709');
  lines.push('');
  lines.push('### YouTube Shorts / Instagram Reels');
  lines.push('- **Format:** MP4 (H.264)');
  lines.push('- **Resolution:** 1080×1920 (9:16)');
  lines.push(`- **Frame rate:** ${req.fps}fps`);
  lines.push('- **Max duration:** 60 seconds');
  lines.push('- **Audio:** AAC 256 kbps');
  lines.push('');
  lines.push('### Thumbnail');
  lines.push('- Upload the PNG from the Canva thumbnail brief (see `thumbnails/` directory)');
  lines.push('- Recommended: 1280×720 PNG, < 2 MB');
  lines.push('');

  // ── Missing clip report ────────────────────────────────────────────────────
  if (missingCount > 0) {
    lines.push('## Missing Clips Report');
    lines.push('');
    lines.push(`⚠ **${missingCount} scene clip(s) were not generated by Grok.** Use a placeholder or regenerate:`);
    lines.push('');
    for (const clip of clips.filter((c) => !c.clip_available)) {
      lines.push(`- **Scene ${clip.scene_number}** (${formatTimecode(clip.start_sec)}–${formatTimecode(clip.end_sec)}, ${clip.section})`);
      lines.push(`  Prompt: _${clip.grok_prompt}_`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimecode(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

/**
 * Dynamic scene planner.
 *
 * Algorithm:
 * 1. Parse [Section] markers from lyrics → ordered list of LyricSection objects.
 * 2. Assign proportional time to each section (by lyric line count).
 * 3. Slice sections longer than MAX_SCENE_SECONDS into multiple ~10s scenes.
 * 4. Assign energy / visual metadata per MusicalSection type.
 */

import type { EnergyLevel, LyricSection, MusicalSection, SceneManifest, ScenePlanInput, SceneSegment } from './types';

const TARGET_SCENE_SECONDS = 10;
const MAX_SCENE_SECONDS = 14;  // a section slice above this gets split again

// ─── Section normalisation ────────────────────────────────────────────────────

const SECTION_HEADER_RE = /^\[([^\]]+)\]$/;

function normalizeSection(raw: string): MusicalSection {
  const s = raw.toLowerCase().replace(/[-\s]+/g, '_').replace(/\d+$/, '').replace(/_$/, '');
  if (s === 'intro' || s === 'introduction') return 'intro';
  if (s === 'outro' || s === 'outro_hook') return 'outro';
  if (s.startsWith('pre_chorus') || s.startsWith('prechorus')) return 'pre_chorus';
  if (s.startsWith('final_chorus') || s.startsWith('last_chorus') || s === 'chorus_final') return 'final_chorus';
  if (s.startsWith('chorus') || s === 'hook' || s === 'refrain') return 'chorus';
  if (s.startsWith('verse')) return 'verse';
  if (s === 'bridge' || s === 'break' || s === 'interlude') return 'bridge';
  return 'unknown';
}

// ─── Lyric section parser ─────────────────────────────────────────────────────

export function parseLyricSections(lyrics: string): LyricSection[] {
  const sections: LyricSection[] = [];
  let current: LyricSection | null = null;

  for (const rawLine of lyrics.split('\n')) {
    const line = rawLine.trim();
    const headerMatch = SECTION_HEADER_RE.exec(line);
    if (headerMatch) {
      if (current) sections.push(current);
      current = {
        section: normalizeSection(headerMatch[1]!),
        raw_label: headerMatch[1]!,
        lines: [],
      };
    } else if (line.length > 0 && !line.startsWith('(')) {
      if (current) {
        current.lines.push(line);
      } else {
        // Lines before any header → treat as intro
        current = { section: 'intro', raw_label: 'Intro', lines: [line] };
      }
    }
  }
  if (current) sections.push(current);

  return sections.length > 0 ? sections : [{ section: 'unknown', raw_label: '', lines: [] }];
}

// ─── Time distribution ────────────────────────────────────────────────────────

interface TimedSection extends LyricSection {
  start_sec: number;
  end_sec: number;
}

function distributeTimes(sections: LyricSection[], totalSeconds: number): TimedSection[] {
  // Sections with zero lines still get a minimum weight of 1
  const weights = sections.map(s => Math.max(s.lines.length, 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const timed: TimedSection[] = [];
  let cursor = 0;

  for (let i = 0; i < sections.length; i++) {
    const fraction = weights[i]! / totalWeight;
    const duration = fraction * totalSeconds;
    const end = i === sections.length - 1 ? totalSeconds : cursor + duration;
    timed.push({ ...sections[i]!, start_sec: cursor, end_sec: end });
    cursor = end;
  }

  return timed;
}

// ─── Section slicing ──────────────────────────────────────────────────────────

function sliceSection(ts: TimedSection): Array<{ start_sec: number; end_sec: number; lyric_lines: string[] }> {
  const sectionDuration = ts.end_sec - ts.start_sec;

  if (sectionDuration <= MAX_SCENE_SECONDS) {
    return [{ start_sec: ts.start_sec, end_sec: ts.end_sec, lyric_lines: ts.lines }];
  }

  const sliceCount = Math.ceil(sectionDuration / TARGET_SCENE_SECONDS);
  const sliceDuration = sectionDuration / sliceCount;
  const slices: Array<{ start_sec: number; end_sec: number; lyric_lines: string[] }> = [];

  for (let i = 0; i < sliceCount; i++) {
    const start = ts.start_sec + i * sliceDuration;
    const end = i === sliceCount - 1 ? ts.end_sec : start + sliceDuration;

    const linesPerSlice = Math.max(1, Math.round(ts.lines.length / sliceCount));
    const lineStart = Math.floor((i / sliceCount) * ts.lines.length);
    const lineEnd = Math.ceil(((i + 1) / sliceCount) * ts.lines.length);
    const lyric_lines = ts.lines.slice(lineStart, lineEnd);

    slices.push({ start_sec: start, end_sec: end, lyric_lines });
  }

  return slices;
}

// ─── Per-section metadata defaults ───────────────────────────────────────────

interface SectionDefaults {
  energy: EnergyLevel;
  visual_goal: string;
  grok_text_to_video_prompt_seed: string;
  capcut_motion: string;
  crop_notes: string;
  negative_prompt: string;
}

const SECTION_DEFAULTS: Record<MusicalSection, SectionDefaults> = {
  intro: {
    energy: 'low',
    visual_goal: 'Establish sacred setting — temple exterior at dawn, draw viewer into devotional world',
    grok_text_to_video_prompt_seed: 'Soft dawn light filtering through ornate temple pillars, slow push-in from wide exterior, golden mist',
    capcut_motion: 'Slow zoom in',
    crop_notes: '9:16 portrait; keep temple spire centered; leave sky headroom',
    negative_prompt: 'people, text overlays, modern buildings, harsh light, clutter',
  },
  verse: {
    energy: 'medium',
    visual_goal: 'Intimate devotion — hands folded in prayer, eyes closed, personal connection to the divine',
    grok_text_to_video_prompt_seed: 'Close-up of devotee\'s folded hands with marigold petals, warm candlelight bokeh, gentle depth of field',
    capcut_motion: 'Gentle pan left to right',
    crop_notes: '9:16 portrait; frame hands in lower two-thirds; soft vignette',
    negative_prompt: 'open eyes, distracted expression, harsh shadows, crowds',
  },
  pre_chorus: {
    energy: 'medium',
    visual_goal: 'Rising anticipation — camera moves upward revealing the altar, energy builds before the chorus',
    grok_text_to_video_prompt_seed: 'Camera tilts upward revealing golden altar adorned with flowers and incense, glowing lamp at apex',
    capcut_motion: 'Upward tilt with slight push',
    crop_notes: '9:16 portrait; start below altar level, end with full altar framing',
    negative_prompt: 'static shot, no movement, darkness, empty space',
  },
  chorus: {
    energy: 'high',
    visual_goal: 'Full devotional reverence — sweeping wide shot, radiant light, peak emotional moment',
    grok_text_to_video_prompt_seed: 'Wide shot of devotees in reverence before illuminated shrine, divine light rays from above, elevated angle',
    capcut_motion: 'Orbital sweep',
    crop_notes: '9:16 portrait; full vertical frame capturing devotees and shrine; leave room for caption',
    negative_prompt: 'dark ambiance, casual clothing, distraction, phone screens',
  },
  bridge: {
    energy: 'medium',
    visual_goal: 'Intimate reflection — single worshipper in stillness, contemplative mid-journey moment',
    grok_text_to_video_prompt_seed: 'Single devotee in meditation beneath ancient banyan tree, dappled light, peaceful solitude',
    capcut_motion: 'Static hold with subtle drift',
    crop_notes: '9:16 portrait; rule of thirds — subject slightly off-center; natural frame with foliage',
    negative_prompt: 'busy background, multiple people, movement, noise',
  },
  final_chorus: {
    energy: 'high',
    visual_goal: 'Triumphant climax — full visual grandeur, congregation in unity, celebratory devotion',
    grok_text_to_video_prompt_seed: 'Triumphant wide-angle shot of full congregation in synchronized reverence, golden hour rays, towering spires',
    capcut_motion: 'Wide push in with rising arc',
    crop_notes: '9:16 portrait; full vertical frame; crowd in lower half, sky and temple in upper half',
    negative_prompt: 'small scale, empty space, subdued lighting, modern intrusions',
  },
  outro: {
    energy: 'low',
    visual_goal: 'Peaceful resolution — serene close on flame or sacred symbol, emotional cool-down',
    grok_text_to_video_prompt_seed: 'Slow dissolve from dancing oil lamp flame to peaceful temple courtyard at dusk, serene fading light',
    capcut_motion: 'Slow zoom out with fade to warm',
    crop_notes: '9:16 portrait; center frame on flame; allow natural vignette at edges',
    negative_prompt: 'abrupt cut, busy scene, harsh light, movement',
  },
  unknown: {
    energy: 'medium',
    visual_goal: 'Devotional scene — sacred imagery aligned with song\'s spiritual theme',
    grok_text_to_video_prompt_seed: 'Warm devotional atmosphere with soft light, sacred imagery, gentle movement',
    capcut_motion: 'Gentle pan',
    crop_notes: '9:16 portrait; balanced framing',
    negative_prompt: 'modern setting, distraction, harsh contrast',
  },
};

// ─── Main planner function ────────────────────────────────────────────────────

export function buildScenePlan(input: ScenePlanInput): SceneManifest {
  const { audio_duration_seconds, song_title, lyrics, winner_label, winner_audio_path, devotional_theme } = input;

  const lyricSections = parseLyricSections(lyrics);
  const timedSections = distributeTimes(lyricSections, audio_duration_seconds);

  const scenes: SceneSegment[] = [];
  let sceneNumber = 1;

  for (const ts of timedSections) {
    const slices = sliceSection(ts);
    const defaults = SECTION_DEFAULTS[ts.section];

    for (const slice of slices) {
      const lyric_excerpt = slice.lyric_lines.slice(0, 2).join(' / ') || '';

      // Optionally boost chorus energy based on winner_analysis
      let energy = defaults.energy;
      if (input.winner_analysis && (ts.section === 'chorus' || ts.section === 'final_chorus')) {
        const chorusScore = input.winner_analysis.chorus_impact_score;
        if (chorusScore >= 8) energy = 'high';
        else if (chorusScore <= 5) energy = 'medium';
      }

      scenes.push({
        scene_number: sceneNumber++,
        start_sec:  Math.round(slice.start_sec * 100) / 100,
        end_sec:    Math.round(slice.end_sec   * 100) / 100,
        section:    ts.section,
        lyric_excerpt,
        energy,
        visual_goal:      defaults.visual_goal,
        grok_text_to_video_prompt_seed: `${defaults.grok_text_to_video_prompt_seed} | Theme: ${devotional_theme}`,
        capcut_motion:    defaults.capcut_motion,
        crop_notes:       defaults.crop_notes,
        negative_prompt:  defaults.negative_prompt,
      });
    }
  }

  return {
    song_title,
    winner_label,
    winner_audio_path,
    audio_duration_seconds,
    total_scenes: scenes.length,
    created_at: new Date().toISOString(),
    scenes,
  };
}

// ─── Duration string parser ───────────────────────────────────────────────────

/** Parses "3:42" → 222 or a plain number string → that number. Returns null on failure. */
export function parseDurationString(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s.includes(':')) {
    const parts = s.split(':').map(Number);
    if (parts.length === 2 && parts.every(p => !isNaN(p))) {
      return (parts[0]! * 60) + parts[1]!;
    }
    return null;
  }
  const n = Number(s);
  return isNaN(n) ? null : n;
}

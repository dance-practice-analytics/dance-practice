// View model of phrase attempts (movement 'phrase'): theme catalogue, readings, event
// labels and lanes, neutral differences between two attempts, focus ordering. Pure.
//
// Values and neutral differences between the dancer's own attempts only: no score, no
// "better", no colour that means good or bad. A missing value is a gap with its reason.
// Nothing here encodes what any teacher said: the themes are general movement qualities
// and the dancer picks their own focus.

import type { CameraView } from '../../../data/schema'
import type { EventKind } from '../../../metrics/events'
import {
  isPhraseResult,
  THEME_KEYS,
  type PhraseEventOut,
  type PhraseNote,
  type PhraseNullReason,
  type PhraseResult,
  type ThemeKey,
} from '../../../metrics/phrase'
import { formatNumber, formatTimecode, NO_VALUE } from '../../format'

export { THEME_KEYS, type ThemeKey }

// ---------- catalogue ----------

export interface ThemeInfo {
  key: ThemeKey
  label: string
  /** Shown after the value. */
  unit: string
  /** Compact unit for difference sentences ('°', ' s', ' arm lengths'). */
  unitShort: string
  decimals: number
  /** "What is this?" — plain words, what is measured and how to read the sign. */
  about: string
  /** Camera views this reads best from, best first. */
  bestViews: readonly CameraView[]
  /** "Best seen from the side" etc. */
  viewNote: string
  /** Words for B − A > 0 and < 0 in a difference sentence. */
  more: string
  less: string
  /** Optional sentence giving the meaning of the sign of the value itself. */
  sign?: (v: number) => string | null
}

export const THEMES: Record<ThemeKey, ThemeInfo> = {
  knee_over_toes: {
    key: 'knee_over_toes',
    label: 'Knees over toes in plié',
    unit: '°',
    unitShort: '°',
    decimals: 1,
    about:
      'In each plié (both feet on the floor, knees bent), the angle seen from above between where the knee points and where the foot points. 0° means the knee is over the line of the foot; a positive value means the knee is inside that line (towards the other leg), a negative value outside. Median of both legs over every plié frame.',
    bestViews: ['front', 'diagonal'],
    viewNote: 'Best seen from the front or the diagonal.',
    more: 'more towards the inside of the foot line',
    less: 'more towards the outside of the foot line',
    sign: (v) => (Math.abs(v) < 0.05 ? 'knee over the foot line' : v > 0 ? 'knee inside the foot line' : 'knee outside the foot line'),
  },
  head_lead: {
    key: 'head_lead',
    label: 'Head leads the arms (timing)',
    unit: 's',
    unitShort: ' s',
    decimals: 2,
    about:
      'Each time the arms start a movement, how long before or after them the head started moving (head relative to the shoulders). Positive: the head started first. Negative: the arms started first. Median over the paired starts.',
    bestViews: ['diagonal', 'side', 'front'],
    viewNote: 'Best seen from the diagonal.',
    more: 'earlier relative to the arms',
    less: 'later relative to the arms',
    sign: (v) => (Math.abs(v) < 0.005 ? 'head and arms start together' : v > 0 ? 'head starts first' : 'arms start first'),
  },
  neck_range: {
    key: 'neck_range',
    label: 'Neck movement range',
    unit: '°',
    unitShort: '°',
    decimals: 0,
    about:
      'How far the head moved relative to the trunk during the clip: the spread of the neck angle (from its 5th to its 95th percentile). The detail view adds how fast it moved.',
    bestViews: ['diagonal', 'side'],
    viewNote: 'Best seen from the diagonal or the side.',
    more: 'larger',
    less: 'smaller',
  },
  upper_body_curve: {
    key: 'upper_body_curve',
    label: 'Upper-body curve',
    unit: '°',
    unitShort: '°',
    decimals: 0,
    about:
      'How far the head curls towards the chest relative to the line from the hips to the shoulders, at its largest (95th percentile). The pose model has no points along the spine, so this mixes the curve of the neck and of the upper back.',
    bestViews: ['side', 'diagonal'],
    viewNote: 'Best seen from the side or the diagonal.',
    more: 'more curled',
    less: 'less curled',
  },
  arm_reach: {
    key: 'arm_reach',
    label: 'Arm reach',
    unit: 'arm lengths',
    unitShort: ' arm lengths',
    decimals: 2,
    about:
      'How far the wrists reach from the middle of the shoulders, in arm lengths (90th percentile over the clip, mean of both arms). Above 1 means the shoulders travel with the reach.',
    bestViews: ['diagonal', 'front', 'side'],
    viewNote: 'Best seen from the diagonal.',
    more: 'further',
    less: 'less far',
  },
  circle_completion: {
    key: 'circle_completion',
    label: 'Circle completion',
    unit: '° swept',
    unitShort: '°',
    decimals: 0,
    about:
      'The largest circle an arm or a leg drew around its shoulder or hip, as the angle swept (360° is a full circle). Closure says how far the end of that circle was from its start, in limb lengths (0 = back where it started).',
    bestViews: ['diagonal', 'front'],
    viewNote: 'Best seen from the diagonal.',
    more: 'more',
    less: 'less',
  },
}

export const PHRASE_NULL_TEXT: Record<PhraseNullReason, string> = {
  no_pose: 'No person was found in this clip, so nothing was measured.',
  no_leg_length: 'Hip, knee and ankle were never tracked together, so distances can’t be scaled.',
  no_plie_detected: 'No plié (both feet down, knees bent) was found in this clip.',
  no_valid_frames: 'The landmarks this needs weren’t tracked well enough in this clip.',
  no_paired_onsets: 'No arm movement had a head movement starting close to it, so the timing couldn’t be paired.',
  no_circle_detected: 'No arm or leg circle of at least a third of a turn was found in this clip.',
}

export const PHRASE_NOTE_TEXT: Record<PhraseNote, string> = {
  left_right_labels_uncertain: 'Left and right may be swapped in parts of this clip (for example while facing away), so sides are less certain.',
  few_pairs: 'Based on fewer than three paired movements.',
}

/** Reasons that mean "nothing of this kind happened in the clip" (a slim row, not a big gap). */
export const COMPACT_REASONS: ReadonlySet<PhraseNullReason> = new Set(['no_plie_detected', 'no_circle_detected', 'no_paired_onsets'])
/** Short text after "not measured — " for those reasons. */
export const COMPACT_TEXT: Partial<Record<PhraseNullReason, string>> = {
  no_plie_detected: 'no plié in this clip',
  no_circle_detected: 'no arm or leg circle in this clip',
  no_paired_onsets: 'no head and arm starts close together',
}

// ---------- readings ----------

export interface ThemeReading {
  key: ThemeKey
  info: ThemeInfo
  value: number | null
  /** Rounded as on screen; differences are computed on these. */
  shown: number | null
  text: string
  confidence: 'high' | 'medium' | 'low' | 'none'
  reason: string | null
  reasonCode: PhraseNullReason | null
  notes: string[]
  /** "knee inside the foot line" — what the sign of the value means; null when unsigned. */
  signText: string | null
  /** Detail-view lines. */
  details: string[]
  /** The session's view isn't one this reads best from. */
  viewNote: string | null
}

export function phraseOf(metrics: { phrase?: unknown } | null | undefined): PhraseResult | null {
  const p = metrics?.phrase
  return isPhraseResult(p) ? p : null
}

const roundTo = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

function details(key: ThemeKey, parts: Record<string, number | string | null>): string[] {
  const n = (k: string, d = 1, u = '') => (typeof parts[k] === 'number' ? `${formatNumber(parts[k] as number, d)}${u}` : NO_VALUE)
  switch (key) {
    case 'knee_over_toes':
      return [`Left ${n('left_deg', 1, '°')} · right ${n('right_deg', 1, '°')}`, `${n('plies', 0)} plié(s), ${n('frames', 0)} leg frames`]
    case 'head_lead':
      return [
        `${n('pairs', 0)} paired starts · head first in ${typeof parts.head_first_share === 'number' ? Math.round((parts.head_first_share as number) * 100) : NO_VALUE}%`,
        `Overall lag of the speeds: ${n('xcorr_lag_s', 2, ' s')}`,
      ]
    case 'neck_range':
      return [`Speed median ${n('speed_median_deg_s', 0, '°/s')} · 90th percentile ${n('speed_p90_deg_s', 0, '°/s')}`, `${n('peaks_per_s', 2)} speed peaks per second`]
    case 'upper_body_curve':
      return [`Most arched (5th percentile) ${n('p5_deg', 0, '°')}`, `In the picture: ${n('picture_p95_deg', 0, '°')} (depends on the view)`]
    case 'arm_reach':
      return [`Left ${n('left_p90', 2)} · right ${n('right_p90', 2)} arm lengths`, `Arm straight for ${n('left_extended_s', 1, ' s')} (left) · ${n('right_extended_s', 1, ' s')} (right)`]
    case 'circle_completion': {
      const limb = typeof parts.limb === 'string' ? parts.limb.replace('_', ' ') : 'limb'
      const plane = typeof parts.plane === 'string' ? `${parts.plane} plane` : ''
      return [`${limb}, ${plane}${typeof parts.at_s === 'number' ? ` at ${formatTimecode(parts.at_s as number)}` : ''}`, `Closure ${n('closure', 2)} limb lengths · ${n('circles', 0)} circle(s) found`]
    }
  }
}

export function readTheme(phrase: PhraseResult | null, key: ThemeKey, view?: CameraView | null): ThemeReading {
  const info = THEMES[key]
  const t = phrase?.themes?.[key]
  const value = t && typeof t.value === 'number' && Number.isFinite(t.value) ? t.value : null
  const reasonCode = value === null ? ((t?.confidence.reason as PhraseNullReason | undefined) ?? null) : null
  const shown = value === null ? null : roundTo(value, info.decimals)
  return {
    key,
    info,
    value,
    shown,
    text: shown === null ? NO_VALUE : formatNumber(shown, info.decimals),
    confidence: value === null ? 'none' : (t?.confidence.level ?? 'low'),
    reason: value === null ? (reasonCode ? PHRASE_NULL_TEXT[reasonCode] : phrase ? 'Not measured in this clip.' : 'This attempt hasn’t been processed as a phrase yet.') : null,
    reasonCode,
    notes: (t?.confidence.notes ?? []).map((n) => PHRASE_NOTE_TEXT[n] ?? n),
    signText: shown !== null && info.sign ? info.sign(shown) : null,
    details: t ? details(key, t.parts ?? {}) : [],
    viewNote: view && !info.bestViews.includes(view) ? `${info.viewNote} This clip is from the ${view}.` : null,
  }
}

/** Focus themes first (in the dancer's order), then the rest in catalogue order. */
export function orderThemes(focus: readonly ThemeKey[]): ThemeKey[] {
  const picked = focus.filter((k, i) => THEME_KEYS.includes(k) && focus.indexOf(k) === i)
  return [...picked, ...THEME_KEYS.filter((k) => !picked.includes(k))]
}

/** Adds or removes a focus theme, keeping at most `max`; the oldest pick drops out first. */
export function toggleFocus(focus: readonly ThemeKey[], key: ThemeKey, max = 3): ThemeKey[] {
  if (focus.includes(key)) return focus.filter((k) => k !== key)
  return [...focus, key].slice(-max)
}

// ---------- neutral differences ----------

export interface ThemeDifference {
  key: ThemeKey
  a: ThemeReading
  b: ThemeReading
  /** B − A on the rounded values; null when not compared. */
  delta: number | null
  /** One neutral sentence. */
  sentence: string
}

/** "B reaches 0.08 arm lengths further than A" — or why it isn't compared. Never better/worse. */
export function themeDifference(key: ThemeKey, a: ThemeReading, b: ThemeReading, names = { a: 'A', b: 'B' }): ThemeDifference {
  const info = THEMES[key]
  if (a.shown === null || b.shown === null) {
    const missing = a.shown === null && b.shown === null ? 'either attempt' : a.shown === null ? names.a : names.b
    return { key, a, b, delta: null, sentence: `Not compared: no value in ${missing}.` }
  }
  const delta = roundTo(b.shown - a.shown, info.decimals)
  if (delta === 0) return { key, a, b, delta, sentence: `${names.b} and ${names.a} read the same.` }
  const size = `${formatNumber(Math.abs(delta), info.decimals)}${info.unitShort}`
  const word = delta > 0 ? info.more : info.less
  let sentence: string
  switch (key) {
    case 'knee_over_toes':
      sentence = `${names.b}: knees ${size} ${word} than ${names.a}.`
      break
    case 'head_lead':
      sentence = `${names.b}: the head starts ${size} ${word} than in ${names.a}.`
      break
    case 'arm_reach':
      sentence = `${names.b} reaches ${size} ${word} than ${names.a}.`
      break
    case 'circle_completion':
      sentence = `${names.b}’s largest circle sweeps ${size} ${word} than ${names.a}’s.`
      break
    case 'upper_body_curve':
      sentence = `${names.b} is ${size} ${word} than ${names.a}.`
      break
    default:
      sentence = `${names.b}’s range is ${size} ${word} than ${names.a}’s.`
  }
  const caveat = a.confidence === 'low' || b.confidence === 'low' ? ' One of the two values has low confidence.' : ''
  return { key, a, b, delta, sentence: sentence + caveat }
}

/** Every theme of B against A, focus themes first. */
export function compareThemes(a: PhraseResult | null, b: PhraseResult | null, focus: readonly ThemeKey[] = [], names = { a: 'A', b: 'B' }): ThemeDifference[] {
  return orderThemes(focus).map((k) => themeDifference(k, readTheme(a, k), readTheme(b, k), names))
}

// ---------- events ----------

export const EVENT_LABELS: Record<EventKind, string> = {
  gesture: 'Leg gesture',
  tilt: 'Fold or tilt',
  turn: 'Turn',
  releve: 'Rise',
  plie: 'Plié',
}

/** One timeline lane per kind, in this order. */
export const LANES: readonly { key: string; label: string; kinds: readonly EventKind[] }[] = [
  { key: 'legs', label: 'Legs', kinds: ['gesture'] },
  { key: 'trunk', label: 'Folds', kinds: ['tilt'] },
  { key: 'turns', label: 'Turns', kinds: ['turn'] },
  { key: 'floor', label: 'Rise · plié', kinds: ['releve', 'plie'] },
]

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const SIDE = { left: 'L', right: 'R' } as const

/** Short text on the strip: 'R side 92°', 'Fold fwd 86°', 'Turn 1.3', 'Rise', 'Plié 60°'. */
export function eventShort(e: PhraseEventOut): string {
  switch (e.kind) {
    case 'gesture': {
      const side = e.side ? SIDE[e.side] : '?'
      const dir = typeof e.values.direction === 'string' ? ` ${e.values.direction}` : ''
      const h = num(e.values.peak_elevation_deg)
      return `${side}${e.side_uncertain ? '?' : ''}${dir}${h === null ? '' : ` ${Math.round(h)}°`}`
    }
    case 'tilt': {
      const d = typeof e.values.direction === 'string' ? (e.values.direction === 'forward' ? ' fwd' : ` ${e.values.direction}`) : ''
      const p = num(e.values.peak_deg)
      return `Fold${d}${p === null ? '' : ` ${Math.round(p)}°`}`
    }
    case 'turn': {
      const d = num(e.values.degrees)
      return d === null ? 'Turn' : `Turn ${formatNumber(d / 360, 1)}`
    }
    case 'releve':
      return 'Rise'
    case 'plie': {
      const k = num(e.values.peak_knee_deg)
      return k === null ? 'Plié' : `Plié ${Math.round(k)}°`
    }
  }
}

/** Full sentence for the button's accessible name and title. */
export function eventDescription(e: PhraseEventOut): string {
  const when = `${formatTimecode(e.start)}–${formatTimecode(e.end)}`
  const v = e.values
  const parts: string[] = []
  switch (e.kind) {
    case 'gesture': {
      parts.push(`${e.side ? `${e.side === 'left' ? 'Left' : 'Right'} leg` : 'Leg'}${typeof v.direction === 'string' ? ` to the ${v.direction}` : ''}`)
      if (num(v.peak_elevation_deg) !== null) parts.push(`${Math.round(num(v.peak_elevation_deg)!)}° from straight down`)
      if (typeof v.level === 'string') parts.push(`foot ${v.level}`)
      if (num(v.working_knee_deg) !== null) parts.push(`knee bent ${Math.round(num(v.working_knee_deg)!)}°`)
      if (num(v.working_hip_above_L) !== null) parts.push(`working hip ${formatNumber(num(v.working_hip_above_L)!, 2)} leg lengths above the other`)
      if (num(v.held_s) !== null) parts.push(`held ${formatNumber(num(v.held_s)!, 1)} s near its height`)
      break
    }
    case 'tilt':
      parts.push(`Trunk ${typeof v.direction === 'string' ? `${v.direction} ` : ''}${num(v.peak_deg) === null ? '' : `${Math.round(num(v.peak_deg)!)}° from vertical`}`.trim())
      if (num(v.knees_at_peak_deg) !== null) parts.push(`knees bent ${Math.round(num(v.knees_at_peak_deg)!)}°`)
      break
    case 'turn':
      parts.push(`Turn of ${num(v.degrees) === null ? NO_VALUE : `${Math.round(num(v.degrees)!)}°`}`)
      if (num(v.duration_s) !== null) parts.push(`over ${formatNumber(num(v.duration_s)!, 1)} s`)
      break
    case 'releve':
      parts.push('Rise on both feet')
      if (num(v.peak_heel_lift_L) !== null) parts.push(`heels up to ${formatNumber(num(v.peak_heel_lift_L)!, 2)} leg lengths`)
      break
    case 'plie':
      parts.push(`Plié${num(v.peak_knee_deg) === null ? '' : `, knees up to ${Math.round(num(v.peak_knee_deg)!)}°`}`)
      break
  }
  if (e.side_uncertain) parts.push('left and right may be swapped here')
  return `${parts.join(', ')} (${when})`
}

export interface LaidOutEvent {
  index: number
  event: PhraseEventOut
  lane: number
  /** 0..1 of the clip. */
  left: number
  width: number
  short: string
  description: string
  anchor: boolean
}

/** Events placed on lanes; `mapT` puts another attempt's events on this clock's time. */
export function layoutEvents(phrase: PhraseResult, duration: number, mapT: (t: number) => number = (t) => t): LaidOutEvent[] {
  if (!(duration > 0)) return []
  const out: LaidOutEvent[] = []
  phrase.events.forEach((event, index) => {
    const lane = LANES.findIndex((l) => l.kinds.includes(event.kind))
    if (lane < 0) return
    const s = Math.max(0, Math.min(duration, mapT(event.start)))
    const e = Math.max(s, Math.min(duration, mapT(event.end)))
    out.push({
      index,
      event,
      lane,
      left: s / duration,
      width: Math.max((e - s) / duration, 0.004),
      short: eventShort(event),
      description: eventDescription(event),
      anchor: index === phrase.anchor,
    })
  })
  return out
}

/** "12 events: 4 leg gestures, 5 folds, 2 turns, 1 plié". */
export function eventSummary(phrase: PhraseResult): string {
  const count = (k: EventKind) => phrase.events.filter((e) => e.kind === k).length
  const word = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : null)
  const parts = [
    word(count('gesture'), 'leg gesture', 'leg gestures'),
    word(count('tilt'), 'fold or tilt', 'folds or tilts'),
    word(count('turn'), 'turn', 'turns'),
    word(count('releve'), 'rise', 'rises'),
    word(count('plie'), 'plié', 'pliés'),
  ].filter(Boolean)
  return parts.length ? `${phrase.events.length} events: ${parts.join(', ')}` : 'No events were found in this clip'
}

/** Sentence on left/right doubt for the whole clip, or null. */
export function labelDoubtText(phrase: PhraseResult): string | null {
  const d = phrase.label_doubt_share
  if (d === null || d <= 0.1) return null
  return `Left and right look swapped in about ${Math.round(d * 100)}% of the frames (for example while facing away). Sides marked “?” may be the other one.`
}

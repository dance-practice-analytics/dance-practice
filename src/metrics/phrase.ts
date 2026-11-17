// Phrase engine (movement type 'phrase'): one attempt of a longer combination in, a
// versioned result out, stored as `attempt_metrics.phrase` (jsonb). It does not replace
// the relevé engine; a phrase attempt stores the five relevé columns as null with the
// reason `not_applicable`.
//
// What it returns:
// - an events timeline (events.ts): leg gestures with side, height, direction and knees,
//   relevés, pliés, trunk tilts / folds and turns, each with its own values;
// - six theme measures (expressive.ts), each a value with a confidence and, when it
//   can't be measured, null plus a machine-readable reason.
//
// Rules (same as engine.ts): values only, never a score; a frame without the landmarks a
// value needs is a gap and is left out; nothing is filled in. Left/right labels are not
// trusted blindly: when the tracker probably swapped them (dancer facing away, `labelDoubt`)
// the side-dependent values carry the note `left_right_labels_uncertain`, one confidence
// level lower, and events say `side_uncertain`.

import type { PoseSeries } from '../pose/types'
import { LM } from '../pose/types'
import { confidenceLevel } from './engine'
import { bodySignals, detectEvents, GESTURE_OFF, type BodySignals, type EventKind, type PhraseEvent } from './events'
import { armReach, circles, headLead, headMotion, headTrunk, quantile, signedKneeDev, type CircleRun } from './expressive'
import { LEG, median, meanVisibility, seen, VIS_MIN } from './signals'
import type { ConfidenceLevel } from './types'

/**
 * Bump when a definition or threshold changes (FR-3.4.9).
 * 0.1.0: first version, thresholds from the synthetic phrase dancer and one study dancer (numbers only).
 */
export const PHRASE_ALGORITHM_VERSION = 'mt2-phrase-0.1.0'

export const THEME_KEYS = ['knee_over_toes', 'head_lead', 'neck_range', 'upper_body_curve', 'arm_reach', 'circle_completion'] as const
export type ThemeKey = (typeof THEME_KEYS)[number]

export type PhraseNullReason =
  /** No frame of the clip has a detected pose. */
  | 'no_pose'
  /** Hip, knee and ankle were never tracked together, so distances can't be scaled. */
  | 'no_leg_length'
  /** No plié (both feet down, both knees bent) was found. */
  | 'no_plie_detected'
  /** The frames this needs had no usable landmarks. */
  | 'no_valid_frames'
  /** No arm movement start had a head movement start close enough to pair. */
  | 'no_paired_onsets'
  /** No arm or leg circle of at least CIRCLE_MIN_DEG. */
  | 'no_circle_detected'

export type PhraseNote =
  /** Left/right labels look swapped in part of the measured frames. */
  | 'left_right_labels_uncertain'
  /** Fewer than MIN_PAIRS paired movement starts. */
  | 'few_pairs'

export interface ThemeConfidence {
  level: ConfidenceLevel
  /** 0..1: share of the measured frames with every landmark at VIS_MIN × their mean visibility (SDD 5.5). */
  score: number
  /** Present exactly when the value is null. */
  reason?: PhraseNullReason
  notes?: PhraseNote[]
}

export interface ThemeResult {
  value: number | null
  /** Secondary values for the detail view and the export; null = not measurable. */
  parts: Record<string, number | string | null>
  confidence: ThemeConfidence
}

export interface PhraseEventOut {
  kind: EventKind
  /** Seconds from the start of the clip; start inclusive, end exclusive. */
  start: number
  end: number
  /** Time of the event's peak value. */
  peak: number
  /** Gestures only: the working leg. */
  side?: 'left' | 'right'
  /** Left/right labels look swapped in this event: its side (and front/back) may be the other one. */
  side_uncertain?: boolean
  values: Record<string, number | string | null>
}

export interface PhraseCircle {
  limb: CircleRun['limb']
  plane: CircleRun['plane']
  start: number
  end: number
  swept_deg: number
  closure: number
  side_uncertain?: boolean
}

export interface PhraseResult {
  version: string
  /** Seconds covered by the frames. */
  duration_s: number
  /** Frames with a pose / all frames. */
  tracked_share: number
  /** Share of the frames with readable feet in which left/right look swapped; null when never readable. */
  label_doubt_share: number | null
  /** Clip leg length, m (scale of every length here). */
  leg_length_m: number | null
  events: PhraseEventOut[]
  /** Index in `events` of the main leg extension (highest held gesture); null without one. */
  anchor: number | null
  circles: PhraseCircle[]
  themes: Record<ThemeKey, ThemeResult>
}

// ---------- thresholds ----------

/** Above this share of doubtful frames, side-dependent values are flagged and lowered one level. */
export const LABEL_DOUBT_SHARE = 0.1
/** An event with more than this share of doubtful frames has an uncertain side. */
export const EVENT_DOUBT_SHARE = 0.3
/** An event's label doubt is read over the event plus this much before and after, s. */
export const DOUBT_MARGIN_S = 1
/** Head-lead timing with fewer paired starts is noted. */
export const MIN_PAIRS = 3
/** A gesture held at least this long can be the anchor; shorter ones only when nothing else exists. */
export const ANCHOR_MIN_HELD_S = 0.2
/** Storage guard (the column has a size check too). */
export const MAX_EVENTS = 150
export const MAX_CIRCLES = 40

/** Themes whose value depends on telling left from right (or front from back). */
const SIDE_DEPENDENT: ReadonlySet<ThemeKey> = new Set(['knee_over_toes', 'upper_body_curve', 'circle_completion'])

const HEAD_TRUNK = [LM.leftEar, LM.rightEar, LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip]
const ARMS = [LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist]
const HEAD_ARMS = [LM.leftEar, LM.rightEar, ...ARMS]

const nn = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const round = (x: number | null | undefined, k = 100): number | null => (nn(x) ? Math.round(x * k) / k : null)
const LOWER: Record<ConfidenceLevel, ConfidenceLevel> = { high: 'medium', medium: 'low', low: 'low' }

/** Confidence over the given frames (all frames when omitted). */
function coverage(series: PoseSeries, landmarks: readonly number[], frames?: readonly number[]): number {
  const idx = frames ?? series.frames.map((_, i) => i)
  if (!idx.length) return 0
  let confident = 0
  let vis = 0
  for (const i of idx) {
    const w = series.frames[i]?.world ?? null
    if (!seen(w, landmarks, VIS_MIN)) continue
    confident++
    vis += meanVisibility(w, landmarks)
  }
  return confident ? (confident / idx.length) * (vis / confident) : 0
}

function doubtShare(sig: BodySignals, i0 = 0, i1 = sig.labelDoubt.length): number | null {
  let known = 0
  let doubt = 0
  for (let i = i0; i < i1; i++) {
    const d = sig.labelDoubt[i]
    if (d === null) continue
    known++
    if (d) doubt++
  }
  return known ? doubt / known : null
}

function measured(value: number | null, parts: ThemeResult['parts'], score: number, reason: PhraseNullReason, notes: PhraseNote[] = []): ThemeResult {
  if (value === null) return { value: null, parts, confidence: { level: 'low', score: 0, reason } }
  const confidence: ThemeConfidence = { level: confidenceLevel(score), score: round(score, 1000) as number }
  if (notes.length) confidence.notes = notes
  return { value, parts, confidence }
}

const unavailable = (reason: PhraseNullReason): ThemeResult => ({ value: null, parts: {}, confidence: { level: 'low', score: 0, reason } })

// ---------- themes ----------

/** Knees over toes in plié: median signed deviation over every plié frame of both weight-bearing legs (+ = inside). */
function kneeTheme(series: PoseSeries, events: PhraseEvent[], sig: BodySignals): ThemeResult {
  const plies = events.filter((e) => e.kind === 'plie')
  if (!plies.length) return unavailable('no_plie_detected')
  const per: Record<'left' | 'right', number[]> = { left: [], right: [] }
  const frames: number[] = []
  for (const e of plies) {
    for (let i = e.i0; i < e.i1; i++) {
      frames.push(i)
      const w = series.frames[i].world
      if (!w) continue
      for (const s of ['left', 'right'] as const) {
        const raise = sig.footRaise[s][i]
        if (!nn(raise) || raise > GESTURE_OFF) continue
        const d = signedKneeDev(w, s)
        if (nn(d)) per[s].push(d)
      }
    }
  }
  const all = [...per.left, ...per.right]
  const landmarks = [LEG.left.hip, LEG.left.knee, LEG.left.ankle, LEG.left.heel, LEG.left.toe, LEG.right.hip, LEG.right.knee, LEG.right.ankle, LEG.right.heel, LEG.right.toe]
  return measured(
    round(median(all), 10),
    {
      left_deg: round(median(per.left), 10),
      right_deg: round(median(per.right), 10),
      p90_abs_deg: round(quantile(all.map(Math.abs), 0.9), 10),
      plies: plies.length,
      frames: all.length,
    },
    coverage(series, landmarks, frames),
    'no_valid_frames',
  )
}

function headLeadTheme(series: PoseSeries, leg: number | null): ThemeResult {
  if (!leg) return unavailable('no_leg_length')
  const lead = headLead(series, leg)
  const notes: PhraseNote[] = lead.pairs.length > 0 && lead.pairs.length < MIN_PAIRS ? ['few_pairs'] : []
  const r = measured(
    lead.medianLatencyS,
    {
      head_first_share: lead.headFirstShare,
      pairs: lead.pairs.length,
      xcorr_lag_s: lead.xcorrLagS,
      arm_starts: lead.armOnsets,
      head_starts: lead.headOnsets,
    },
    coverage(series, HEAD_ARMS),
    'no_paired_onsets',
    notes,
  )
  // Too few pairs: say so and never show it as more than medium.
  if (notes.length && r.confidence.level === 'high') r.confidence.level = 'medium'
  return r
}

function neckTheme(series: PoseSeries, neck: (number | null)[], leg: number | null): ThemeResult {
  if (!leg) return unavailable('no_leg_length')
  const m = headMotion(series, neck, leg)
  return measured(
    m.neckRangeDeg,
    { speed_median_deg_s: m.neckSpeedMedian, speed_p90_deg_s: m.neckSpeedP90, peaks_per_s: m.headPeaksPerS, jerk_rms: m.headJerkRms },
    coverage(series, HEAD_TRUNK),
    'no_valid_frames',
  )
}

function curveTheme(series: PoseSeries, ht: ReturnType<typeof headTrunk>): ThemeResult {
  const c = ht.curve.filter(nn)
  const img = ht.curveImage.filter(nn)
  return measured(
    round(quantile(c, 0.95), 10),
    { p5_deg: round(quantile(c, 0.05), 10), picture_p95_deg: round(quantile(img, 0.95), 10) },
    coverage(series, HEAD_TRUNK),
    'no_valid_frames',
  )
}

function reachTheme(series: PoseSeries): ThemeResult {
  const r = armReach(series)
  const p90 = [r.left.reachP90, r.right.reachP90].filter(nn)
  return measured(
    p90.length ? round(p90.reduce((a, b) => a + b, 0) / p90.length) : null,
    {
      left_p90: r.left.reachP90,
      right_p90: r.right.reachP90,
      left_peak: r.left.reachPeak,
      right_peak: r.right.reachPeak,
      left_extended_s: r.left.extendedS,
      right_extended_s: r.right.extendedS,
    },
    coverage(series, ARMS),
    'no_valid_frames',
  )
}

function circleTheme(series: PoseSeries, found: PhraseCircle[]): ThemeResult {
  if (!found.length) return unavailable('no_circle_detected')
  const largest = found.reduce((a, b) => (b.swept_deg > a.swept_deg ? b : a))
  const arms = found.filter((c) => c.limb.endsWith('arm'))
  return measured(
    largest.swept_deg,
    {
      closure: largest.closure,
      limb: largest.limb,
      plane: largest.plane,
      at_s: round(largest.start),
      circles: found.length,
      arm_circles: arms.length,
      leg_circles: found.length - arms.length,
    },
    coverage(series, [...ARMS, LM.leftHip, LM.rightHip]),
    'no_valid_frames',
  )
}

// ---------- events ----------

function eventOut(e: PhraseEvent, sig: BodySignals, margin: number): PhraseEventOut {
  const { side, ...values } = e.values
  const out: PhraseEventOut = { kind: e.kind, start: round(e.start) as number, end: round(e.end) as number, peak: round(e.peakT) as number, values }
  if (side === 'left' || side === 'right') out.side = side
  // The feet only tell a swap while both point roughly forward, which a lifted leg doesn't,
  // so the doubt is read around the event as well as in it.
  const d = doubtShare(sig, Math.max(0, e.i0 - margin), Math.min(sig.labelDoubt.length, e.i1 + margin))
  // Gestures (side, direction) and tilts (direction) flip with swapped labels; turns, pliés and relevés do not.
  if ((e.kind === 'gesture' || e.kind === 'tilt') && d !== null && d > EVENT_DOUBT_SHARE) out.side_uncertain = true
  return out
}

/** The main leg extension: the highest gesture held at least ANCHOR_MIN_HELD_S (else the highest). */
export function anchorIndex(events: readonly PhraseEventOut[]): number | null {
  let best: number | null = null
  let bestHeld = false
  events.forEach((e, i) => {
    if (e.kind !== 'gesture' || !nn(e.values.peak_elevation_deg)) return
    const held = nn(e.values.held_s) && e.values.held_s >= ANCHOR_MIN_HELD_S
    const cur = best === null ? null : (events[best].values.peak_elevation_deg as number)
    if (best === null || (held && !bestHeld) || (held === bestHeld && (e.values.peak_elevation_deg as number) > (cur as number))) {
      best = i
      bestHeld = held
    }
  })
  return best
}

// ---------- all together ----------

export function computePhrase(series: PoseSeries): PhraseResult {
  const n = series.frames.length
  const tracked = series.frames.filter((f) => f.world).length
  const duration = n ? Math.max(series.frames[n - 1].t - series.frames[0].t + 1 / (series.fps || 30), 0) : 0
  const base = {
    version: PHRASE_ALGORITHM_VERSION,
    duration_s: round(duration) as number,
    tracked_share: n ? (round(tracked / n, 1000) as number) : 0,
  }
  if (!tracked) {
    return {
      ...base,
      label_doubt_share: null,
      leg_length_m: null,
      events: [],
      anchor: null,
      circles: [],
      themes: Object.fromEntries(THEME_KEYS.map((k) => [k, unavailable('no_pose')])) as Record<ThemeKey, ThemeResult>,
    }
  }

  const sig = bodySignals(series)
  const raw = sig.leg ? detectEvents(series, sig) : []
  const margin = Math.round(DOUBT_MARGIN_S * (series.fps || 30))
  const events = raw.slice(0, MAX_EVENTS).map((e) => eventOut(e, sig, margin))
  const doubt = doubtShare(sig)
  const ht = headTrunk(series)
  const found: PhraseCircle[] = (sig.leg ? circles(series, sig) : []).slice(0, MAX_CIRCLES).map((c) => {
    const i0 = series.frames.findIndex((f) => f.t >= c.start)
    const i1 = series.frames.findIndex((f) => f.t > c.end)
    const d = doubtShare(sig, Math.max(0, i0 - margin), i1 < 0 ? n : Math.min(n, i1 + margin))
    const out: PhraseCircle = { limb: c.limb, plane: c.plane, start: round(c.start) as number, end: round(c.end) as number, swept_deg: c.sweptDeg, closure: c.closure }
    if (d !== null && d > EVENT_DOUBT_SHARE) out.side_uncertain = true
    return out
  })

  const themes: Record<ThemeKey, ThemeResult> = {
    knee_over_toes: sig.leg ? kneeTheme(series, raw, sig) : unavailable('no_leg_length'),
    head_lead: headLeadTheme(series, sig.leg),
    neck_range: neckTheme(series, ht.neck, sig.leg),
    upper_body_curve: curveTheme(series, ht),
    arm_reach: reachTheme(series),
    circle_completion: sig.leg ? circleTheme(series, found) : unavailable('no_leg_length'),
  }
  // Never trust swapped sides silently.
  if (doubt !== null && doubt > LABEL_DOUBT_SHARE) {
    for (const k of SIDE_DEPENDENT) {
      const c = themes[k].confidence
      if (themes[k].value === null) continue
      c.level = LOWER[c.level]
      c.notes = [...(c.notes ?? []), 'left_right_labels_uncertain']
    }
  }

  return {
    ...base,
    label_doubt_share: round(doubt, 1000),
    leg_length_m: round(sig.leg, 1000),
    events,
    anchor: anchorIndex(events),
    circles: found,
    themes,
  }
}

/** Type guard for a stored result (jsonb from the database or an old export). */
export function isPhraseResult(x: unknown): x is PhraseResult {
  if (!x || typeof x !== 'object') return false
  const r = x as Partial<PhraseResult>
  return typeof r.version === 'string' && Array.isArray(r.events) && !!r.themes && typeof r.themes === 'object'
}

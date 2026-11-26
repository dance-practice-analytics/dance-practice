// What the AI functions send about a phrase attempt (movement 'phrase', FR-3.7.2, NFR-1/2):
// the seven theme values with confidence and null reasons, a compact event summary, the same
// theme values for earlier attempts of the session, a progress context (medians per earlier
// session of the same movement, camera view and dancer) and the dancer's focus themes.
//
// attempt_metrics.phrase is written by the client, so it is untrusted: every string comes
// from an allowlist, every number is checked and rounded, and nothing is copied through.
// No ids, titles, notes, file names, subject codes, dates, keypoints or frames ever enter
// it. Pure TypeScript, no Deno or DOM API: the web app imports it for its "What is sent"
// panels, so they can't drift from what the functions send.

import {
  CONFIDENCE_LEVELS,
  PHRASE_THEME_KEYS,
  type ConfidenceLevel,
  type PhraseThemeKey,
  // @ts-ignore TS5097: Deno needs the .ts extension
} from '../generate-feedback/contract.ts'

export const THEME_KEYS = PHRASE_THEME_KEYS
export type ThemeKey = PhraseThemeKey

export const CAMERA_VIEWS = ['front', 'side', 'diagonal'] as const
export type CameraView = (typeof CAMERA_VIEWS)[number]

/** src/metrics/phrase.ts PhraseNullReason, plus 'unknown' when the row gives none. */
export const PHRASE_NULL_REASONS = [
  'no_pose',
  'no_leg_length',
  'no_plie_detected',
  'no_valid_frames',
  'no_paired_onsets',
  'no_circle_detected',
  'no_both_feet_down',
  'unknown',
] as const
export type PhraseNullReason = (typeof PHRASE_NULL_REASONS)[number]

export const PHRASE_NOTES = ['left_right_labels_uncertain', 'few_pairs'] as const
export type PhraseNote = (typeof PHRASE_NOTES)[number]

export const EVENT_KINDS = ['gesture', 'releve', 'plie', 'tilt', 'turn'] as const
export type EventKind = (typeof EVENT_KINDS)[number]

/** src/metrics/events.ts directionLabel / levelLabel and the tilt directions. */
const GESTURE_DIRECTIONS = ['front', 'back', 'front-side', 'front-across', 'back-side', 'back-across', 'side', 'across'] as const
const GESTURE_LEVELS = ['below knee', 'knee to hip', 'hip or above'] as const
const TILT_DIRECTIONS = ['forward', 'back', 'left', 'right'] as const

/**
 * Plain names (as the app shows them, src/v2/pages/phrase/model.ts; a test keeps them
 * equal), the unit, decimals and what each theme measures in dance-class words.
 */
export const THEME_DEFINITIONS: Record<ThemeKey, { name: string; unit: string; decimals: number; measures: string }> = {
  knee_over_toes: {
    name: 'Knees over toes in plié',
    unit: 'degrees',
    decimals: 1,
    measures:
      'In each plié (both feet on the floor, knees bent), the angle seen from above between where the knee points and where the foot points. 0 degrees means the knee is over the line of the foot; a positive value means the knee is inside that line (towards the other leg), a negative value outside. The sign is a direction, not a verdict.',
  },
  head_lead: {
    name: 'Head leads the arms (timing)',
    unit: 'seconds',
    decimals: 2,
    measures:
      'Each time the arms start a movement, how long before or after them the head started moving. Positive: the head started first. Negative: the arms started first.',
  },
  neck_range: {
    name: 'Neck movement range',
    unit: 'degrees',
    decimals: 0,
    measures: 'How far the head moved relative to the trunk across the phrase.',
  },
  upper_body_curve: {
    name: 'Upper-body curve',
    unit: 'degrees',
    decimals: 0,
    measures:
      'How far the head and upper back curl towards the chest at the largest moment. The tracking has no points along the spine, so this mixes the curve of the neck and of the upper back.',
  },
  arm_reach: {
    name: 'Distal expansion (arm reach)',
    unit: 'arm lengths',
    decimals: 2,
    measures:
      'How far the movement expands out through the hands: the distance from the middle of the shoulders to the wrists, in arm lengths. Above 1 means the shoulders travel with the reach.',
  },
  circle_completion: {
    name: 'Circle completion',
    unit: 'degrees swept',
    decimals: 0,
    measures: 'The largest circle an arm or a leg drew around its shoulder or hip, as the angle swept. 360 degrees is a full circle.',
  },
  parallel_feet: {
    name: 'Parallel feet',
    unit: 'degrees',
    decimals: 1,
    measures:
      'While both feet are on the floor, the angle between where the two feet point, seen from above. 0 degrees is parallel; a positive value means the toes point apart, a negative value that they point towards each other. The sign is a direction, not a verdict.',
  },
}

/** Attempts of the same session sent for comparison (same as the relevé payload). */
export const MAX_EARLIER_PHRASE_ATTEMPTS = 3
/** Earlier sessions in the progress context. */
export const MAX_PROGRESS_SESSIONS = 5
/** Attempts per earlier session read for its medians. */
export const MAX_ATTEMPTS_PER_SESSION = 30
/** Main events listed by role (one each). */
export const MAX_MAIN_EVENTS = 5
export const MAX_FOCUS_THEMES = 3

// ---------- shapes ----------

/** The columns of attempt_metrics the functions read for a phrase attempt. */
export interface PhraseRowLike {
  movement: string
  phrase?: unknown
}

export interface PayloadTheme {
  theme: ThemeKey
  unit: string
  /** null = not measured; never zero-filled. */
  value: number | null
  confidence: ConfidenceLevel
  /** Present exactly when value is null. */
  not_measured_reason?: PhraseNullReason
  notes?: PhraseNote[]
}

export interface ThemeValue {
  theme: ThemeKey
  value: number | null
  confidence: ConfidenceLevel
  /** Left/right may be swapped for this value. */
  sides_uncertain?: true
}

export type MainEventRole = 'main_leg_extension' | 'largest_turn' | 'deepest_plie' | 'largest_tilt' | 'longest_releve'

export interface MainEvent {
  role: MainEventRole
  kind: EventKind
  start_s: number
  end_s: number
  /** Gestures only: the working leg as tracked. */
  side?: 'left' | 'right'
  /** Left/right may be swapped in this event: its side and direction are not reliable. */
  side_uncertain?: true
  values: Record<string, number | string>
}

export interface EventSummary {
  duration_s: number | null
  /** Share of frames with a tracked pose, 0..1. */
  tracked_share: number | null
  counts: Record<EventKind, number>
  /** Events whose side or direction may be swapped. */
  side_uncertain_events: number
  main_events: MainEvent[]
}

export interface ProgressTheme {
  theme: ThemeKey
  /** Median of the session's values with high or medium confidence; null when none. */
  median: number | null
  values_used: number
  /** Low-confidence values (or values with sides uncertain) that were left out of the median. */
  uncertain_left_out: number
  not_measured: number
}

export interface ProgressSession {
  /** 1 = the most recent earlier session. */
  sessions_before: number
  attempts: number
  themes: ProgressTheme[]
}

export interface PhrasePayload {
  movement: 'phrase'
  camera_view: CameraView | null
  themes: PayloadTheme[]
  events: EventSummary
  /** The same theme values of earlier attempts in this session; attempts_before 1 = the one right before. */
  earlier_attempts: { attempts_before: number; themes: ThemeValue[] }[]
  /** Earlier sessions of the same movement, camera view and dancer, oldest first. */
  progress: ProgressSession[]
  /** Up to three themes the dancer chose to pay attention to, in their order. */
  focus_themes: ThemeKey[]
}

/** Everything around the attempt that the database gives (all read under the caller's RLS). */
export interface PhraseContextInput {
  cameraView?: unknown
  /** Earlier sessions, newest first; each with its attempt_metrics rows. */
  progress?: { rows: PhraseRowLike[] }[]
  focus?: readonly unknown[]
}

// ---------- helpers ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function allowed<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v)
}

const round = (v: number, decimals: number) => {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Known theme keys only, no repeats, at most three (the CHECKs of user_preferences). */
export function cleanFocusThemes(themes: readonly unknown[] | null | undefined): ThemeKey[] {
  const out: ThemeKey[] = []
  for (const t of themes ?? []) if (allowed(THEME_KEYS, t) && !out.includes(t)) out.push(t)
  return out.slice(0, MAX_FOCUS_THEMES)
}

function themesOf(row: PhraseRowLike): Record<string, unknown> | null {
  return isRecord(row.phrase) && isRecord(row.phrase.themes) ? row.phrase.themes : null
}

/** A theme of a stored row, checked; null when the row has no phrase result. */
export function themeEntry(row: PhraseRowLike, key: ThemeKey): PayloadTheme | null {
  const themes = themesOf(row)
  if (!themes) return null
  const t = isRecord(themes[key]) ? themes[key] : {}
  const conf = isRecord(t.confidence) ? t.confidence : {}
  const value = finite(t.value) ? round(t.value, THEME_DEFINITIONS[key].decimals) : null
  const entry: PayloadTheme = {
    theme: key,
    unit: THEME_DEFINITIONS[key].unit,
    value,
    // A missing or malformed confidence is treated as low, so the value is never interpreted.
    confidence: value === null ? 'low' : allowed(CONFIDENCE_LEVELS, conf.level) ? conf.level : 'low',
  }
  if (value === null) entry.not_measured_reason = allowed(PHRASE_NULL_REASONS, conf.reason) ? conf.reason : 'unknown'
  const notes = Array.isArray(conf.notes) ? conf.notes.filter((n): n is PhraseNote => allowed(PHRASE_NOTES, n)) : []
  if (notes.length && value !== null) entry.notes = [...new Set(notes)]
  return entry
}

/** Low confidence or swapped sides: the value is reported as uncertain and never compared. */
export function isUncertain(t: Pick<PayloadTheme, 'value' | 'confidence' | 'notes'>): boolean {
  return t.value === null || t.confidence === 'low' || (t.notes ?? []).includes('left_right_labels_uncertain')
}

function themeValues(row: PhraseRowLike): ThemeValue[] | null {
  if (!themesOf(row)) return null
  return THEME_KEYS.map((k) => {
    const t = themeEntry(row, k) as PayloadTheme
    const v: ThemeValue = { theme: k, value: t.value, confidence: t.confidence }
    if (t.notes?.includes('left_right_labels_uncertain')) v.sides_uncertain = true
    return v
  })
}

// ---------- events ----------

const EVENT_VALUES: Record<EventKind, Record<string, { decimals: number } | { enum: readonly string[] }>> = {
  gesture: {
    peak_elevation_deg: { decimals: 0 },
    direction: { enum: GESTURE_DIRECTIONS },
    level: { enum: GESTURE_LEVELS },
    held_s: { decimals: 1 },
  },
  releve: { duration_s: { decimals: 1 } },
  plie: { peak_knee_deg: { decimals: 0 }, duration_s: { decimals: 1 } },
  tilt: { peak_deg: { decimals: 0 }, direction: { enum: TILT_DIRECTIONS }, duration_s: { decimals: 1 } },
  turn: { degrees: { decimals: 0 }, duration_s: { decimals: 1 } },
}

/** Which value picks the main event of each role (largest wins). */
const ROLES: { role: MainEventRole; kind: EventKind; by: string }[] = [
  { role: 'main_leg_extension', kind: 'gesture', by: 'peak_elevation_deg' },
  { role: 'largest_turn', kind: 'turn', by: 'degrees' },
  { role: 'deepest_plie', kind: 'plie', by: 'peak_knee_deg' },
  { role: 'largest_tilt', kind: 'tilt', by: 'peak_deg' },
  { role: 'longest_releve', kind: 'releve', by: 'duration_s' },
]

interface CleanEvent {
  kind: EventKind
  start: number
  end: number
  side?: 'left' | 'right'
  sideUncertain: boolean
  raw: Record<string, unknown>
}

function cleanEvent(e: unknown): CleanEvent | null {
  if (!isRecord(e) || !allowed(EVENT_KINDS, e.kind) || !finite(e.start) || !finite(e.end) || e.end < e.start) return null
  const out: CleanEvent = { kind: e.kind, start: e.start, end: e.end, sideUncertain: e.side_uncertain === true, raw: isRecord(e.values) ? e.values : {} }
  if (e.side === 'left' || e.side === 'right') out.side = e.side
  return out
}

function mainEvent(role: MainEventRole, e: CleanEvent): MainEvent {
  const values: Record<string, number | string> = {}
  for (const [k, rule] of Object.entries(EVENT_VALUES[e.kind])) {
    const v = e.raw[k]
    if ('decimals' in rule) {
      if (finite(v)) values[k] = round(v, rule.decimals)
    } else if (allowed(rule.enum, v)) values[k] = v
  }
  const out: MainEvent = { role, kind: e.kind, start_s: round(e.start, 1), end_s: round(e.end, 1), values }
  if (e.side) out.side = e.side
  if (e.sideUncertain) out.side_uncertain = true
  return out
}

export function eventSummary(phrase: unknown): EventSummary {
  const p = isRecord(phrase) ? phrase : {}
  const events = (Array.isArray(p.events) ? p.events : []).map(cleanEvent).filter((e): e is CleanEvent => e !== null)
  const counts = Object.fromEntries(EVENT_KINDS.map((k) => [k, 0])) as Record<EventKind, number>
  for (const e of events) counts[e.kind]++

  const main: MainEvent[] = []
  for (const { role, kind, by } of ROLES) {
    let best: CleanEvent | null = null
    // The engine's anchor is the main leg extension (highest held gesture) when it has one.
    if (role === 'main_leg_extension' && Number.isInteger(p.anchor) && Array.isArray(p.events)) {
      const anchored = cleanEvent(p.events[p.anchor as number])
      if (anchored?.kind === 'gesture') best = anchored
    }
    if (!best) {
      for (const e of events) {
        if (e.kind !== kind || !finite(e.raw[by])) continue
        if (!best || (e.raw[by] as number) > (best.raw[by] as number)) best = e
      }
    }
    if (best) main.push(mainEvent(role, best))
  }
  main.sort((a, b) => a.start_s - b.start_s)

  return {
    duration_s: finite(p.duration_s) ? round(p.duration_s, 1) : null,
    tracked_share: finite(p.tracked_share) ? round(Math.min(1, Math.max(0, p.tracked_share)), 2) : null,
    counts,
    side_uncertain_events: events.filter((e) => e.sideUncertain).length,
    main_events: main.slice(0, MAX_MAIN_EVENTS),
  }
}

// ---------- progress ----------

/**
 * Medians per earlier session. `sessions` are newest first; the result is oldest first,
 * without sessions that have no phrase result. Uncertain values (low confidence, sides
 * possibly swapped) are counted but left out of the median.
 */
export function buildProgress(sessions: readonly { rows: readonly PhraseRowLike[] }[] = []): ProgressSession[] {
  const out: ProgressSession[] = []
  sessions.slice(0, MAX_PROGRESS_SESSIONS).forEach((s, i) => {
    const per = s.rows
      .filter((r) => r.movement === 'phrase')
      .slice(0, MAX_ATTEMPTS_PER_SESSION)
      .map(themeValues)
      .filter((v): v is ThemeValue[] => v !== null)
    if (!per.length) return
    out.push({
      sessions_before: i + 1,
      attempts: per.length,
      themes: THEME_KEYS.map((k, j) => {
        const column = per.map((list) => list[j])
        const usable = column.filter((v) => v.value !== null && v.confidence !== 'low' && !v.sides_uncertain).map((v) => v.value as number)
        const m = median(usable)
        return {
          theme: k,
          median: m === null ? null : round(m, THEME_DEFINITIONS[k].decimals),
          values_used: usable.length,
          uncertain_left_out: column.filter((v) => v.value !== null).length - usable.length,
          not_measured: column.filter((v) => v.value === null).length,
        }
      }),
    })
  })
  return out.reverse()
}

// ---------- which earlier sessions count ----------

/** The columns of `sessions` the progress context needs (never title or note). */
export interface SessionMeta {
  id: string
  owner_id?: string | null
  movement_type: string
  camera_view: string | null
  subject_id: string | null
  recorded_on: string | null
  created_at: string
}

/** Practice day, then import time: the order sessions are shown in. */
const sessionOrder = (s: SessionMeta) => `${s.recorded_on ?? s.created_at.slice(0, 10)}|${s.created_at}`

/**
 * Earlier sessions comparable with `current`, newest first: same owner, phrase, the same
 * known camera view and the same dancer (subject, or none for the account's own clips),
 * recorded before it. Without a known camera view nothing is comparable.
 */
export function progressSessions(current: SessionMeta, candidates: readonly SessionMeta[], max = MAX_PROGRESS_SESSIONS): SessionMeta[] {
  if (current.movement_type !== 'phrase' || !allowed(CAMERA_VIEWS, current.camera_view)) return []
  const key = sessionOrder(current)
  return candidates
    .filter(
      (s) =>
        s.id !== current.id &&
        (!current.owner_id || s.owner_id === current.owner_id) &&
        s.movement_type === 'phrase' &&
        s.camera_view === current.camera_view &&
        (s.subject_id ?? null) === (current.subject_id ?? null) &&
        sessionOrder(s) < key,
    )
    .sort((a, b) => (sessionOrder(a) < sessionOrder(b) ? 1 : -1))
    .slice(0, max)
}

// ---------- the payload ----------

/**
 * `row` is the phrase attempt; `earlier` are attempts of the same session recorded before
 * it, newest first (rows of another movement are ignored). Throws when `row` is not a phrase.
 */
export function buildPhrasePayload(row: PhraseRowLike, earlier: readonly PhraseRowLike[] = [], ctx: PhraseContextInput = {}): PhrasePayload {
  if (row.movement !== 'phrase') throw new Error('not a phrase attempt')
  const themes = THEME_KEYS.map(
    (k) => themeEntry(row, k) ?? { theme: k, unit: THEME_DEFINITIONS[k].unit, value: null, confidence: 'low' as const, not_measured_reason: 'unknown' as const },
  )
  const earlier_attempts = earlier
    .filter((e) => e.movement === 'phrase')
    .slice(0, MAX_EARLIER_PHRASE_ATTEMPTS)
    .flatMap((e, i) => {
      const values = themeValues(e)
      return values ? [{ attempts_before: i + 1, themes: values }] : []
    })
  return {
    movement: 'phrase',
    camera_view: allowed(CAMERA_VIEWS, ctx.cameraView) ? ctx.cameraView : null,
    themes,
    events: eventSummary(row.phrase),
    earlier_attempts,
    progress: buildProgress(ctx.progress),
    focus_themes: cleanFocusThemes(ctx.focus),
  }
}

export function phraseHasMeasurements(payload: PhrasePayload): boolean {
  return payload.themes.some((t) => t.value !== null)
}

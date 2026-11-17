// View model of the Practice notes screen (FR-3.7.x): which attempts can be picked,
// what exactly would be sent for one attempt, and how every failure of the notes service
// is worded. No request is made from here.
//
// The payload is built with the Edge Function's own pure module (payload.ts: plain
// TypeScript, no Deno or DOM API, already unit-tested under Vitest), so the "What is
// sent" panel cannot drift from what the function really sends to the model.

import { FAILURES, METRIC_KEYS, RATE_LIMIT_MAX, type NoteLanguage, type NoteTopic } from '../../../../supabase/functions/generate-feedback/contract'
import {
  buildNotesPayload,
  hasMeasurements,
  isPhrasePayload,
  MAX_EARLIER_ATTEMPTS,
  type FeedbackPayload,
  type PayloadMetric,
  type PhraseContextInput,
} from '../../../../supabase/functions/generate-feedback/payload'
import {
  progressSessions,
  type PayloadTheme,
  type PhrasePayload,
  type SessionMeta,
  type ThemeKey,
} from '../../../../supabase/functions/_shared/phrase'
import type { FeedbackNote } from '../../../feedback/client'
import type { MetricKey } from '../../../metrics/types'
import type { AttemptView } from '../../data'
import { formatDate, formatDateTime, METRICS, MOVEMENT_LABELS, VIEW_LABELS } from '../../format'
import { THEMES } from '../phrase/model'

export { hasMeasurements, isPhrasePayload }
export type { FeedbackPayload, PayloadMetric, PayloadTheme, PhrasePayload }

/** The name of what an observation is about: a relevé metric or a phrase theme. */
export function topicLabel(topic: NoteTopic): string {
  return (METRIC_KEYS as readonly string[]).includes(topic) ? METRICS[topic as MetricKey].label : THEMES[topic as ThemeKey].label
}

export function isThemeTopic(topic: NoteTopic): topic is ThemeKey {
  return !(METRIC_KEYS as readonly string[]).includes(topic)
}

// ---------- attempts ----------

/** Attempts that have been analyzed, newest first: the ones notes can be about. */
export function processedAttempts(attempts: readonly AttemptView[] | null | undefined): AttemptView[] {
  return (attempts ?? [])
    .filter((a) => a.status === 'done')
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
}

/** The day shown for an attempt: the session's recorded day, else the import day. */
export function attemptDay(a: AttemptView): string {
  return a.session.recorded_on ?? a.created_at
}

export function attemptTitle(a: AttemptView): string {
  return `Attempt ${a.number}`
}

/** 'Attempt 3 · Relevé balance · Nov 4' (phone header, picker). */
export function attemptLine(a: AttemptView, now: Date = new Date()): string {
  return `${attemptTitle(a)} · ${MOVEMENT_LABELS[a.session.movement_type]} · ${formatDate(attemptDay(a), now)}`
}

/** 'Nov 4 · Relevé balance · Front view' — one group of the picker. */
export function sessionLine(a: AttemptView, now: Date = new Date()): string {
  const s = a.session
  return [
    formatDate(attemptDay(a), now),
    MOVEMENT_LABELS[s.movement_type],
    s.camera_view ? VIEW_LABELS[s.camera_view] : null,
    s.subject_code,
    s.title,
  ]
    .filter(Boolean)
    .join(' · ')
}

export interface PickerGroup {
  sessionId: string
  label: string
  options: { id: string; label: string }[]
}

/** Processed attempts grouped by session (newest session first, attempts in import order). */
export function pickerGroups(attempts: readonly AttemptView[] | null | undefined, now: Date = new Date()): PickerGroup[] {
  const groups = new Map<string, PickerGroup>()
  for (const a of processedAttempts(attempts)) {
    let g = groups.get(a.session_id)
    if (!g) {
      g = { sessionId: a.session_id, label: sessionLine(a, now), options: [] }
      groups.set(a.session_id, g)
    }
    g.options.push({ id: a.id, label: a.label ? `${attemptTitle(a)} · ${a.label}` : attemptTitle(a) })
  }
  for (const g of groups.values()) g.options.reverse()
  return [...groups.values()]
}

// ---------- what is sent ----------

/**
 * The attempts whose values go along for comparison: the same rule as the function
 * (the three attempts imported right before this one in its session, newest first; the
 * ones without measurements are dropped afterwards).
 */
export function earlierAttempts(attempt: AttemptView, all: readonly AttemptView[]): AttemptView[] {
  return all
    .filter((a) => a.session_id === attempt.session_id && a.created_at < attempt.created_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, MAX_EARLIER_ATTEMPTS)
    .filter((a) => a.metrics !== null)
}

function sessionMeta(a: AttemptView): SessionMeta {
  const s = a.session
  return {
    id: s.id,
    owner_id: s.owner_id,
    movement_type: s.movement_type,
    camera_view: s.camera_view,
    subject_id: s.subject_id,
    recorded_on: s.recorded_on,
    created_at: s.created_at,
  }
}

/**
 * What the function loads around a phrase attempt, from the attempts already on screen:
 * the camera view, the earlier sessions of the same phrase, view and dancer (the same
 * rule as supabase/functions/_shared/phraseContext.ts) and the focus themes.
 */
export function phraseContextFor(attempt: AttemptView, all: readonly AttemptView[], focus: readonly ThemeKey[] = []): PhraseContextInput {
  const sessions = new Map<string, SessionMeta>()
  for (const a of all) if (!sessions.has(a.session_id)) sessions.set(a.session_id, sessionMeta(a))
  const picked = progressSessions(sessionMeta(attempt), [...sessions.values()])
  return {
    cameraView: attempt.session.camera_view,
    progress: picked.map((s) => ({
      rows: all
        .filter((a) => a.session_id === s.id && a.metrics !== null)
        .sort((x, y) => x.created_at.localeCompare(y.created_at))
        .map((a) => a.metrics!),
    })),
    focus,
  }
}

/**
 * The metrics-only payload for an attempt; null when it has no measurements row.
 * `focus` are the dancer's focus themes (phrase only); `language` the notes' language.
 */
export function payloadFor(
  attempt: AttemptView,
  all: readonly AttemptView[],
  focus: readonly ThemeKey[] = [],
  language: NoteLanguage = 'en',
): FeedbackPayload | null {
  if (!attempt.metrics) return null
  try {
    const ctx = attempt.session.movement_type === 'phrase' ? phraseContextFor(attempt, all, focus) : {}
    return buildNotesPayload(
      attempt.metrics,
      earlierAttempts(attempt, all).map((a) => a.metrics!),
      ctx,
      language,
    )
  } catch {
    // A movement the function doesn't know: nothing would be sent.
    return null
  }
}

/** How many metric (or theme) values, not gaps, the payload carries. */
export function sentCount(payload: FeedbackPayload | null): number {
  if (!payload) return 0
  return isPhrasePayload(payload) ? payload.themes.filter((t) => t.value !== null).length : payload.metrics.filter((m) => m.value !== null).length
}

function metricLine(m: PayloadMetric): string {
  const value = m.value === null ? `not measured (${m.not_measured_reason ?? 'unknown'})` : `${m.value} ${m.unit}`
  return [`${m.metric}: ${value}`, m.phases.join('+') || null, m.confidence, ...(m.notes ?? [])].filter(Boolean).join(' · ')
}

function themeLine(t: PayloadTheme): string {
  const value = t.value === null ? `not measured (${t.not_measured_reason ?? 'unknown'})` : `${t.value} ${t.unit}`
  return [`${t.theme}: ${value}`, t.confidence, ...(t.notes ?? [])].join(' · ')
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What a phrase payload includes beyond this attempt, in words for the panels. */
export interface PhraseShare {
  /** Earlier sessions whose medians are included. */
  sessions: number
  /** Earlier attempts of this session included. */
  earlierAttempts: number
  /** Focus theme names, in the dancer's order. */
  focus: string[]
  view: string | null
}

export function phraseShare(payload: PhrasePayload): PhraseShare {
  return {
    sessions: payload.progress.length,
    earlierAttempts: payload.earlier_attempts.length,
    focus: payload.focus_themes.map((k) => THEMES[k].label),
    view: payload.camera_view,
  }
}

/** 'Theme medians of 3 earlier sessions (same phrase, diagonal view)' or why there are none. */
export function progressLine(share: PhraseShare): string {
  if (!share.view) return 'No earlier sessions: this session has no camera view, so none can be matched.'
  if (share.sessions === 0) return `No earlier session of this phrase with the ${share.view} view.`
  return `Theme medians of ${plural(share.sessions, 'earlier session')} (same phrase, dancer and ${share.view} view).`
}

/** 'Focus: Arm reach, Head leads the arms' or that none were chosen. */
export function focusLine(share: PhraseShare): string {
  return share.focus.length ? `Focus themes: ${share.focus.join(', ')}.` : 'No focus themes chosen (you can pick up to 3 in Review).'
}

function phraseLines(payload: PhrasePayload & { language?: NoteLanguage }): string[] {
  const e = payload.events
  const counts = Object.entries(e.counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`)
  const lines = [`movement: phrase`, `camera_view: ${payload.camera_view ?? 'unknown'}`, ...payload.themes.map(themeLine)]
  lines.push(
    `events: ${counts.length ? counts.join(', ') : 'none detected'}${e.side_uncertain_events ? ` (${e.side_uncertain_events} with sides uncertain)` : ''}`,
  )
  for (const m of e.main_events) {
    lines.push(`  ${m.role}: ${m.start_s}–${m.end_s} s${m.side ? ` · ${m.side}${m.side_uncertain ? ' (uncertain)' : ''}` : ''}`)
  }
  const n = payload.earlier_attempts.length
  lines.push(n === 0 ? 'earlier_attempts: none' : `earlier_attempts: the same theme values for ${plural(n, 'earlier attempt')} of this session`)
  const s = payload.progress.length
  lines.push(
    s === 0
      ? 'progress: none'
      : `progress: theme medians of ${plural(s, 'earlier session')} (${payload.progress.map((p) => plural(p.attempts, 'attempt')).join(', ')})`,
  )
  lines.push(`focus_themes: ${payload.focus_themes.length ? payload.focus_themes.join(', ') : 'none'}`)
  if (payload.language) lines.push(`language: ${payload.language}`)
  return lines
}

/** The payload as the lines of the "What is sent" panel: every field, nothing else. */
export function payloadLines(payload: FeedbackPayload): string[] {
  if (isPhrasePayload(payload)) return phraseLines(payload)
  const lines = [`movement: ${payload.movement}`, ...payload.metrics.map(metricLine)]
  if (payload.phases.length) lines.push(`phases: ${payload.phases.map((p) => `${p.phase} ${p.duration_s} s`).join(', ')}`)
  const n = payload.earlier_attempts.length
  lines.push(
    n === 0
      ? 'earlier_attempts: none'
      : `earlier_attempts: the same values for ${n} earlier ${n === 1 ? 'attempt' : 'attempts'} of this session`,
  )
  if (payload.language) lines.push(`language: ${payload.language}`)
  return lines
}

// ---------- failures → the designed alert ----------

export type AlertAction =
  /** "Try again" re-sends the request. */
  | 'retry'
  /** Turn the AI consent on (nothing was sent). */
  | 'allow_consent'
  | 'sign_in'
  | 'open_review'
  | 'open_processing'
  /** Nothing to press: the Generate button says when it is available again. */
  | 'wait'

export interface NoteAlert {
  code: string
  /** 'alert' = the outlined system alert; 'note' = the quiet note box (offline). */
  tone: 'alert' | 'note'
  icon: 'warning' | 'clock' | 'info' | 'lock'
  /** What happened. */
  title: string
  /** What still works. */
  body: string
  /** The one next step. */
  action: AlertAction
  /** Epoch ms when a new request can work (rate limit), else null. */
  retryAt: number | null
}

export interface FailureLike {
  code: string
  status: number
  message: string
  recovery?: string
  retryAfterS?: number
}

/** '3:40 PM' */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/**
 * The function is not deployed yet: the platform answers 404 without the function's own
 * error body, which the client reports as a generic service problem. For the dancer it
 * is the same state as a missing API key: the notes service isn't set up.
 */
export function isNotSetUp(error: FailureLike): boolean {
  return error.code === 'not_configured' || (error.code === 'upstream_error' && error.status === 404)
}

const NOT_AFFECTED = 'Your video and measurements are not affected.'
/**
 * Every failure as one alert: what happened, what still works, one next step.
 * `at` is when the failure arrived (for the retry time); `hasNotes` says whether earlier
 * notes are still on screen.
 */
export function noteAlert(error: FailureLike, at: number, hasNotes = false): NoteAlert {
  const base = { code: error.code, tone: 'alert' as const, icon: 'warning' as const, retryAt: null }
  if (isNotSetUp(error)) {
    return {
      ...base,
      code: 'not_configured',
      title: FAILURES.not_configured.message,
      body: `The notes service isn’t connected yet, so no notes were written. ${NOT_AFFECTED} Review, compare and progress keep working.`,
      action: 'open_review',
    }
  }
  switch (error.code) {
    case 'rate_limited': {
      const retryAt = error.retryAfterS ? at + error.retryAfterS * 1000 : null
      const when = retryAt ? `Try again at ${formatClock(retryAt)}.` : 'Try again later.'
      return {
        ...base,
        icon: 'clock',
        title: 'Notes limit reached.',
        body: `You can generate ${RATE_LIMIT_MAX} sets of notes per hour. ${when} ${
          hasNotes ? 'The notes below are from your last request.' : 'Your metrics are not affected.'
        }`,
        action: 'wait',
        retryAt,
      }
    }
    case 'offline':
      return {
        ...base,
        tone: 'note',
        icon: 'info',
        title: 'You’re offline.',
        body: 'Processing and review keep working — they run on this device. Practice notes need a connection.',
        action: 'retry',
      }
    case 'consent_required':
      return {
        ...base,
        icon: 'lock',
        title: FAILURES.consent_required.message,
        body: 'No measurements were sent to the AI. Notes are only written after you allow AI practice notes (metrics only).',
        action: 'allow_consent',
      }
    case 'nothing_measured':
      return { ...base, title: FAILURES.nothing_measured.message, body: `No notes were written. ${FAILURES.nothing_measured.recovery}`, action: 'open_review' }
    case 'attempt_not_found':
      return { ...base, title: FAILURES.attempt_not_found.message, body: FAILURES.attempt_not_found.recovery, action: 'open_processing' }
    case 'unauthorized':
      return { ...base, title: FAILURES.unauthorized.message, body: `${FAILURES.unauthorized.recovery} ${NOT_AFFECTED}`, action: 'sign_in' }
    case 'model_refused':
      // Asking again for the same numbers gives the same answer, so the step is to look at the measurements.
      return { ...base, title: FAILURES.model_refused.message, body: `No notes were saved. ${NOT_AFFECTED}`, action: 'open_review' }
  }
  return {
    ...base,
    title: error.message || 'Couldn’t generate notes.',
    body: error.recovery || `Try again in a moment. ${NOT_AFFECTED}`,
    action: 'retry',
  }
}

// ---------- a note as text ----------

export function historyTitle(a: AttemptView, note: FeedbackNote): string {
  return `${attemptTitle(a)} · ${formatDateTime(note.createdAt)}`
}

export function historyMeta(note: FeedbackNote, index: number): string {
  const n = note.response.observations.length
  return `${index === 0 ? 'Latest' : 'Earlier version'} · ${n} ${n === 1 ? 'observation' : 'observations'}`
}

/** Plain text for the Copy button. */
export function noteText(a: AttemptView, note: FeedbackNote, now: Date = new Date()): string {
  const r = note.response
  return [
    `Practice notes — ${attemptLine(a, now)}`,
    `Generated ${formatDateTime(note.createdAt)}`,
    '',
    r.summary,
    '',
    ...r.observations.flatMap((o, i) => [
      `${i + 1}. ${topicLabel(o.metric)} (confidence: ${o.confidence})`,
      `   Observed: ${o.observation}`,
      `   Practice suggestion: ${o.suggestion}`,
    ]),
    ...(r.cautions.length ? ['', 'Cautions:', ...r.cautions.map((c) => `- ${c}`)] : []),
    '',
    r.disclaimer,
  ].join('\n')
}

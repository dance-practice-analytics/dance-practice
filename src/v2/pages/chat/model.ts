// View model of the Mika (AI assistant) screen. The assistant has no backend in the prototype, so
// this only prepares the context panel — the real measurements a question would be
// about — and the suggested questions. Nothing here sends or answers anything.

import { buildPhrasePayload } from '../../../../supabase/functions/_shared/phrase'
import { median } from '../../../insights'
import type { Confidence } from '../../components'
import type { AttemptView } from '../../data'
import { formatMetricWithUnit, formatNumber, PHASE_LABELS, readMetric, readMetrics, withUnit, type MetricReading } from '../../format'
import { earlierAttempts, focusLine, phraseContextFor, phraseShare, progressLine, type PhraseShare } from '../notes/model'
import { orderThemes, phraseOf, readTheme, THEMES, type ThemeKey, type ThemeReading } from '../phrase/model'

export type ChatScope = 'attempt' | 'session'

export interface SharedRow {
  key: string
  /** 'Trunk inclination · Hold' */
  name: string
  /** Short name for the phone panel. */
  label: string
  /** '4.2° · attempt 2: 6.3°', '5 attempts · median 5.6°' or the reason for a gap. */
  value: string
  confidence: Confidence
  /** Low confidence or no value: shown subdued. */
  subdued: boolean
}

export interface ChatContext {
  rows: SharedRow[]
  /** How many rows carry a value. */
  valueCount: number
  note: string
  /** Phrase attempts: which earlier sessions and focus themes go along with a question. */
  phrase?: { progress: string; focus: string; events: string; share: PhraseShare }
}

/** The extra phrase context Mika gets (same rule as the function), in words. */
function phraseExtras(attempt: AttemptView, all: readonly AttemptView[], focus: readonly ThemeKey[]): ChatContext['phrase'] {
  if (!attempt.metrics) return undefined
  const payload = buildPhrasePayload(attempt.metrics, [], phraseContextFor(attempt, all, focus))
  const share = phraseShare(payload)
  const counts = Object.entries(payload.events.counts).filter(([, n]) => n > 0)
  const events = counts.length
    ? `Event summary: ${counts.map(([k, n]) => `${n} ${EVENT_WORDS[k] ?? k}${n === 1 ? '' : 's'}`).join(', ')}, with times.`
    : 'Event summary: no events detected.'
  return { progress: progressLine(share), focus: focusLine(share), events, share }
}

const EVENT_WORDS: Record<string, string> = { gesture: 'leg gesture', releve: 'relevé', plie: 'plié', tilt: 'tilt', turn: 'turn' }

function phraseChatContext(attempt: AttemptView, all: readonly AttemptView[], scope: ChatScope, focus: readonly ThemeKey[]): ChatContext {
  const view = attempt.session.camera_view
  const order = orderThemes(focus)
  const mine = phraseOf(attempt.metrics)
  const extras = phraseExtras(attempt, all, focus)
  const unit = (r: ThemeReading, text: string) => withUnit(text, r.info.unit)

  if (scope === 'attempt') {
    const prev = previousAttempt(attempt, all)
    const before = prev ? phraseOf(prev.metrics) : null
    const rows = order.map((k): SharedRow => {
      const r = readTheme(mine, k, view)
      const parts = [r.value === null ? 'Not measured' : unit(r, r.text)]
      if (prev) {
        const b = readTheme(before, k, view)
        parts.push(`attempt ${prev.number}: ${b.value === null ? '—' : unit(b, b.text)}`)
      }
      if (r.confidence === 'low') parts.push('flagged low')
      return {
        key: k,
        name: focus.includes(k) ? `${r.info.label} · focus` : r.info.label,
        label: r.info.label,
        value: parts.join(' · '),
        confidence: r.confidence,
        subdued: r.value === null || r.confidence === 'low',
      }
    })
    return {
      rows,
      valueCount: rows.filter((r) => r.confidence !== 'none').length,
      note: prev ? `Would include attempt ${prev.number}’s theme values so change can be described.` : 'No earlier analyzed attempt in this session to compare with.',
      phrase: extras,
    }
  }

  const session = all.filter((a) => a.session_id === attempt.session_id && a.metrics !== null)
  const rows = order.map((k): SharedRow => {
    const column = session.map((a) => readTheme(phraseOf(a.metrics), k, view))
    const usable = column.filter((c) => c.value !== null)
    const low = usable.filter((c) => c.confidence === 'low').length
    const weakest = usable.reduce<Confidence>((w, c) => (ORDER.indexOf(c.confidence) < ORDER.indexOf(w) ? c.confidence : w), usable.length ? 'high' : 'none')
    const parts = [`${column.length} ${column.length === 1 ? 'attempt' : 'attempts'}`]
    const m = median(usable.map((c) => c.value as number))
    const first = usable[0]
    parts.push(m === null || !first ? 'no values' : `median ${unit(first, formatNumber(m, first.info.decimals))}`)
    if (low) parts.push(`${low} flagged low`)
    return {
      key: k,
      name: focus.includes(k) ? `${THEMES[k].label} · focus` : THEMES[k].label,
      label: THEMES[k].label,
      value: parts.join(' · '),
      confidence: weakest,
      subdued: weakest === 'none' || weakest === 'low',
    }
  })
  return {
    rows,
    valueCount: rows.filter((r) => r.confidence !== 'none').length,
    note: `Theme values for ${session.length === 1 ? 'the one analyzed attempt' : `all ${session.length} analyzed attempts`} in this session, with their confidence.`,
    phrase: extras,
  }
}

const ORDER: Confidence[] = ['none', 'low', 'medium', 'high']

function name(r: MetricReading): string {
  return r.phases.length ? `${r.def.label} · ${r.phases.map((p) => PHASE_LABELS[p] ?? p).join(' + ')}` : r.def.label
}

/** The attempt right before this one in its session that has measurements. */
export function previousAttempt(attempt: AttemptView, all: readonly AttemptView[]): AttemptView | null {
  return earlierAttempts(attempt, all)[0] ?? null
}

/** `focus` are the dancer's focus themes (phrase attempts only). */
export function chatContext(attempt: AttemptView, all: readonly AttemptView[], scope: ChatScope, focus: readonly ThemeKey[] = []): ChatContext {
  const movement = attempt.session.movement_type
  if (movement === 'phrase') return phraseChatContext(attempt, all, scope, focus)
  // A metric the row predates (added in a later engine version) has nothing to share: leave it out.
  const readings = readMetrics(attempt.metrics, movement).filter((r) => !r.outdated)

  if (scope === 'attempt') {
    const prev = previousAttempt(attempt, all)
    const before = prev ? readings.map((r) => readMetric(prev.metrics, r.key)) : []
    const rows = readings.map((r, i): SharedRow => {
      const earlier = before[i]
      const parts = [r.value === null ? 'Not measured' : formatMetricWithUnit(r.key, r.value)]
      if (prev && earlier) parts.push(`attempt ${prev.number}: ${formatMetricWithUnit(r.key, earlier.value)}`)
      if (r.confidence === 'low') parts.push('flagged low')
      return {
        key: r.key,
        name: name(r),
        label: r.def.label,
        value: parts.join(' · '),
        confidence: r.confidence,
        subdued: r.value === null || r.confidence === 'low',
      }
    })
    return {
      rows,
      valueCount: rows.filter((_, i) => readings[i].value !== null).length,
      note: prev
        ? `Would include attempt ${prev.number}’s values so change can be described.`
        : 'No earlier analyzed attempt in this session to compare with.',
    }
  }

  const session = all.filter((a) => a.session_id === attempt.session_id && a.metrics !== null)
  const perAttempt = session.map((a) => readings.map((r) => readMetric(a.metrics, r.key)))
  const rows = readings.map((r, i): SharedRow => {
    const column = perAttempt.map((list) => list[i])
    const values = column.flatMap((c) => (c.value === null ? [] : [c.value]))
    const low = column.filter((c) => c.value !== null && c.confidence === 'low').length
    const missing = column.length - values.length
    // The badge shows the weakest tracking among the values, so nothing looks surer than it is.
    const weakest = column.reduce<Confidence>(
      (w, c) => (c.value !== null && ORDER.indexOf(c.confidence) < ORDER.indexOf(w) ? c.confidence : w),
      values.length ? 'high' : 'none',
    )
    const parts = [`${column.length} ${column.length === 1 ? 'attempt' : 'attempts'}`]
    parts.push(values.length ? `median ${formatMetricWithUnit(r.key, median(values))}` : 'no values')
    if (low) parts.push(`${low} flagged low`)
    if (missing && values.length) parts.push(`${missing} not measured`)
    return { key: r.key, name: name(r), label: r.def.label, value: parts.join(' · '), confidence: weakest, subdued: weakest === 'none' || weakest === 'low' }
  })
  return {
    rows,
    valueCount: rows.filter((r) => r.confidence !== 'none').length,
    note: `Values for ${session.length === 1 ? 'the one analyzed attempt' : `all ${session.length} analyzed attempts`} in this session, with their confidence.`,
  }
}

/** Suggested questions for a phrase: change over time and practice attention, tied to the focus themes. */
function phraseQuestions(attempt: AttemptView, all: readonly AttemptView[], focus: readonly ThemeKey[]): string[] {
  const prev = previousAttempt(attempt, all)
  const mine = phraseOf(attempt.metrics)
  const sessions = phraseExtras(attempt, all, focus)?.share.sessions ?? 0
  const measured = orderThemes(focus).filter((k) => readTheme(mine, k).value !== null)
  const first = measured[0]
  const out: string[] = []
  if (first && sessions > 0) out.push(`How did my ${THEMES[first].label.toLowerCase()} change across sessions?`)
  else if (prev) out.push(`What changed since attempt ${prev.number}?`)
  out.push(focus.length ? 'What could I pay attention to in my focus themes?' : 'What could I pay attention to next time?')
  if (mine?.events.some((e) => e.kind === 'gesture')) out.push('What happened in the main leg extension?')
  const uncertain = orderThemes(focus).find((k) => {
    const r = readTheme(mine, k)
    return r.value !== null && r.confidence === 'low'
  })
  if (uncertain) out.push(`Why is ${THEMES[uncertain].label.toLowerCase()} uncertain?`)
  return out
}

/** Suggested questions, worded from what this attempt really has. */
export function suggestedQuestions(attempt: AttemptView, all: readonly AttemptView[], focus: readonly ThemeKey[] = []): string[] {
  if (attempt.session.movement_type === 'phrase') return phraseQuestions(attempt, all, focus)
  const prev = previousAttempt(attempt, all)
  const readings = readMetrics(attempt.metrics, attempt.session.movement_type)
  // A metric that is low by design, or missing only because the row predates it, has a fixed answer: don't suggest it.
  const low = readings.filter((r) => r.value !== null && r.confidence === 'low' && !r.alwaysLow)
  const missing = readings.filter((r) => r.value === null && !r.outdated)
  const out: string[] = []
  if (prev) out.push(`What changed since attempt ${prev.number}?`)
  out.push('Which phase varied most?', 'What could I practise next?')
  if (low.length) out.push(`Why is ${low[0].def.label.toLowerCase()} low confidence?`)
  else if (missing.length) out.push(`Why is ${missing[0].def.label.toLowerCase()} not measured?`)
  return out
}

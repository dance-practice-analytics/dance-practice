// View model of the Mika (AI assistant) screen. The assistant has no backend in the prototype, so
// this only prepares the context panel — the real measurements a question would be
// about — and the suggested questions. Nothing here sends or answers anything.

import { median } from '../../../insights'
import type { Confidence } from '../../components'
import type { AttemptView } from '../../data'
import { formatMetricWithUnit, PHASE_LABELS, readMetrics, type MetricReading } from '../../format'
import { earlierAttempts } from '../notes/model'

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
}

const ORDER: Confidence[] = ['none', 'low', 'medium', 'high']

function name(r: MetricReading): string {
  return r.phases.length ? `${r.def.label} · ${r.phases.map((p) => PHASE_LABELS[p] ?? p).join(' + ')}` : r.def.label
}

/** The attempt right before this one in its session that has measurements. */
export function previousAttempt(attempt: AttemptView, all: readonly AttemptView[]): AttemptView | null {
  return earlierAttempts(attempt, all)[0] ?? null
}

export function chatContext(attempt: AttemptView, all: readonly AttemptView[], scope: ChatScope): ChatContext {
  const movement = attempt.session.movement_type
  const readings = readMetrics(attempt.metrics, movement)

  if (scope === 'attempt') {
    const prev = previousAttempt(attempt, all)
    const before = prev ? readMetrics(prev.metrics, movement) : []
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
  const perAttempt = session.map((a) => readMetrics(a.metrics, movement))
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

/** Suggested questions, worded from what this attempt really has. */
export function suggestedQuestions(attempt: AttemptView, all: readonly AttemptView[]): string[] {
  const prev = previousAttempt(attempt, all)
  const readings = readMetrics(attempt.metrics, attempt.session.movement_type)
  const low = readings.filter((r) => r.value !== null && r.confidence === 'low')
  const missing = readings.filter((r) => r.value === null)
  const out: string[] = []
  if (prev) out.push(`What changed since attempt ${prev.number}?`)
  out.push('Which phase varied most?', 'What could I practise next?')
  if (low.length) out.push(`Why is ${low[0].def.label.toLowerCase()} low confidence?`)
  else if (missing.length) out.push(`Why is ${missing[0].def.label.toLowerCase()} not measured?`)
  return out
}

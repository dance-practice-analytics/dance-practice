// FR-3.6.5: aggregated metrics per subject code for the study dataset. Pure.
//
// One summary per subject and movement (a relevé and a pirouette are never pooled):
// for every metric, the median over that subject's processed study attempts that have a
// value with high or medium tracking confidence, and how many attempts were counted,
// left out for low confidence, or had no value. Low-confidence values are counted as
// excluded, never dropped silently and never turned into 0; a median over nothing is
// null. Rows stay in subject-code order and nothing is compared across subjects, so the
// summary describes recordings and cannot rank anyone.

import { EXPORT_METRICS, csvCell } from '../../../data/exportData'
import { SUBJECT_CODE_RE, type MovementType } from '../../../data/schema'
import type { MetricKey } from '../../../metrics/types'
import type { AttemptView } from '../../data'
import { metricsFor, readMetric } from '../../format'
import { MOVEMENT_ORDER, NO_CODE } from './grid'

export interface MetricAggregate {
  metric: MetricKey
  /** Median of the counted values, in the stored unit; null when nothing was counted. */
  median: number | null
  /** Attempts whose value went into the median (high or medium confidence). */
  counted: number
  /** Attempts with a value at low tracking confidence, left out of the median. */
  excludedLow: number
  /** Processed attempts without a value for this metric (with a reason in Review). */
  unavailable: number
}

export interface SubjectAggregate {
  code: string
  movement: MovementType
  /** Processed (done) study attempts of this subject and movement. */
  attempts: number
  metrics: MetricAggregate[]
}

/** Median of a non-empty list; null for an empty one. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const codeOf = (a: AttemptView) => (a.session.subject_code && SUBJECT_CODE_RE.test(a.session.subject_code) ? a.session.subject_code : NO_CODE)

export function subjectAggregates(attempts: readonly AttemptView[]): SubjectAggregate[] {
  const groups = new Map<string, { code: string; movement: MovementType; list: AttemptView[] }>()
  for (const a of attempts) {
    if (a.source !== 'study_dataset' || a.status !== 'done') continue
    const code = codeOf(a)
    const movement = a.session.movement_type
    const key = `${code}|${movement}`
    const g = groups.get(key) ?? { code, movement, list: [] }
    g.list.push(a)
    groups.set(key, g)
  }
  const out: SubjectAggregate[] = []
  for (const { code, movement, list } of groups.values()) {
    const metrics = metricsFor(movement).map((metric): MetricAggregate => {
      const values: number[] = []
      let excludedLow = 0
      let unavailable = 0
      for (const a of list) {
        const r = readMetric(a.metrics, metric)
        if (r.value === null) unavailable++
        else if (r.confidence === 'low' || r.confidence === 'none') excludedLow++
        else values.push(r.value)
      }
      return { metric, median: median(values), counted: values.length, excludedLow, unavailable }
    })
    out.push({ code, movement, attempts: list.length, metrics })
  }
  // Subject-code order; clips without a code last.
  const byCode = (x: string, y: string) => Number(x === NO_CODE) - Number(y === NO_CODE) || x.localeCompare(y)
  return out.sort((x, y) => byCode(x.code, y.code) || MOVEMENT_ORDER.indexOf(x.movement) - MOVEMENT_ORDER.indexOf(y.movement))
}

const UNIT: Record<string, string> = Object.fromEntries(EXPORT_METRICS.map((m) => [m.metric, m.unit]))

export function subjectSummaryColumns(): string[] {
  const cols = ['subject_code', 'movement', 'attempts_done']
  for (const { metric } of EXPORT_METRICS) {
    cols.push(`${metric}_median`, `${metric}_unit`, `${metric}_n_counted`, `${metric}_n_excluded_low_confidence`, `${metric}_n_unavailable`)
  }
  return cols
}

/**
 * The per-subject summary as its own CSV file (FR-3.6.5), next to the per-attempt CSV.
 * Metrics that don't apply to a movement (turns for a relevé) are empty cells. Medians
 * keep the stored unit; they are rounded to 4 decimals only to drop float noise.
 */
export function subjectSummaryCsv(aggregates: readonly SubjectAggregate[]): string {
  const columns = subjectSummaryColumns()
  const lines = [columns.join(',')]
  for (const g of aggregates) {
    const row: Record<string, unknown> = {
      subject_code: g.code === NO_CODE ? null : g.code,
      movement: g.movement,
      attempts_done: g.attempts,
    }
    for (const m of g.metrics) {
      row[`${m.metric}_median`] = m.median === null ? null : Math.round(m.median * 1e4) / 1e4
      row[`${m.metric}_unit`] = UNIT[m.metric]
      row[`${m.metric}_n_counted`] = m.counted
      row[`${m.metric}_n_excluded_low_confidence`] = m.excludedLow
      row[`${m.metric}_n_unavailable`] = m.unavailable
    }
    lines.push(columns.map((c) => csvCell(row[c])).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

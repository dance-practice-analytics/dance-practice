// Shared helpers for the insights modules: medians, calendar days and reading the
// stored confidence. Pure functions, no DOM.

import type { AttemptMetricsRow, AttemptRow, ConfidenceLevel, DateOnly, SessionRow, Timestamp } from '../data/schema'
import type { MetricKey } from '../metrics/types'

/** True median: the mean of the two middle values for an even count. Null for no values. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Calendar day (YYYY-MM-DD) of a timestamp in a time zone (IANA name; default: the
 * device's zone). A date-only string is returned as is. Null when it cannot be parsed.
 */
export function localDay(value: Timestamp | Date | null | undefined, timeZone?: string): DateOnly | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && DATE_ONLY.test(value)) return value
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Calendar arithmetic on a YYYY-MM-DD string (no time zone involved). */
export function addDays(date: DateOnly, days: number): DateOnly {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/**
 * The practice day of an attempt: the session's `recorded_on` when it is set (the day
 * the dancer entered, used as written); otherwise the local day of the attempt's
 * `created_at`.
 */
export function practiceDay(attempt: AttemptRow, session: SessionRow | null | undefined, timeZone?: string): DateOnly | null {
  return session?.recorded_on ?? localDay(attempt.created_at, timeZone)
}

/**
 * The day of a session: `recorded_on` when set; otherwise the local day of its earliest
 * attempt's `created_at`; otherwise the local day of the session's own `created_at`.
 */
export function sessionDay(session: SessionRow, attempts: readonly AttemptRow[], timeZone?: string): DateOnly | null {
  if (session.recorded_on) return session.recorded_on
  const first = attempts.map((a) => a.created_at).sort()[0]
  return localDay(first ?? session.created_at, timeZone)
}

export function byCreated(a: AttemptRow, b: AttemptRow): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
}

export interface StoredConfidence {
  /** Null when there is no value. A value without a stored level counts as 'low'. */
  level: ConfidenceLevel | null
  score: number | null
  /** The engine's NullReason when the value is null and one was stored. */
  nullReason: string | null
}

/** Confidence of one metric of a row, read defensively from the jsonb column. */
export function readConfidence(row: AttemptMetricsRow, key: MetricKey): StoredConfidence {
  const entry = (row.confidence as Record<string, { level?: unknown; score?: unknown; reason?: unknown } | undefined> | null)?.[key]
  const value = row[key]
  const hasValue = typeof value === 'number' && Number.isFinite(value)
  const level = entry?.level === 'high' || entry?.level === 'medium' || entry?.level === 'low' ? entry.level : null
  return {
    level: hasValue ? (level ?? 'low') : null,
    score: typeof entry?.score === 'number' && Number.isFinite(entry.score) ? entry.score : null,
    nullReason: !hasValue && typeof entry?.reason === 'string' ? entry.reason : null,
  }
}

/** The metric value, or null when it is missing or not a finite number. */
export function readValue(row: AttemptMetricsRow | null | undefined, key: MetricKey): number | null {
  const v = row?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

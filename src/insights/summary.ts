// Headline numbers for the dashboard: plain counts, dates and latest medians.

import type { AttemptMetricsRow, AttemptRow, AttemptStatus, CameraView, DateOnly, MovementType, SessionRow } from '../data/schema'
import type { MetricKey } from '../metrics/types'
import { MOVEMENTS, formatValue, metricsForMovement } from './catalog'
import { progressSeries } from './progress'
import { addDays, localDay, practiceDay } from './util'

export interface SummaryOptions {
  /** "Today" for the calendar strip. Default: the current time. */
  now?: Date
  /** Length of the calendar strip in days, ending today. Default 14. */
  days?: number
  /** IANA zone for days derived from timestamps. Default: the device's zone. */
  timeZone?: string
}

export interface PracticeDay {
  date: DateOnly
  /** Attempts whose practice day is this date; 0 = no practice recorded. */
  attempts: number
}

export interface LatestMedian {
  movement: MovementType
  metric: MetricKey
  /** Median of the latest session that has one; null when no session has a value. */
  median: number | null
  text: string
  sessionId: string | null
  date: DateOnly | null
  /** The single camera view the median comes from. */
  cameraView: CameraView | 'unknown' | null
  /** Values behind the median. */
  countedValues: number
}

export interface DashboardSummary {
  sessions: number
  attempts: number
  /** Attempts with status 'done'. */
  attemptsProcessed: number
  attemptsByStatus: Record<AttemptStatus, number>
  /** Latest practice day of any attempt; null when there are none. */
  lastPracticeDate: DateOnly | null
  /** One entry per day, oldest first, ending today. */
  practiceDays: PracticeDay[]
  /** Days in the strip with at least one attempt. */
  practiceDayCount: number
  /** For each movement that has a session, each metric that applies to it. */
  latestMedians: LatestMedian[]
}

export function dashboardSummary(
  sessions: readonly SessionRow[],
  attempts: readonly AttemptRow[],
  metrics: readonly AttemptMetricsRow[],
  options: SummaryOptions = {},
): DashboardSummary {
  const { timeZone } = options
  const days = Math.max(1, Math.floor(options.days ?? 14))
  const today = localDay(options.now ?? new Date(), timeZone)!

  const attemptsByStatus: Record<AttemptStatus, number> = { queued: 0, processing: 0, done: 0, failed: 0 }
  const sessionById = new Map(sessions.map((s) => [s.id, s]))
  const perDay = new Map<DateOnly, number>()
  let lastPracticeDate: DateOnly | null = null
  for (const a of attempts) {
    attemptsByStatus[a.status]++
    const day = practiceDay(a, sessionById.get(a.session_id), timeZone)
    if (!day) continue
    perDay.set(day, (perDay.get(day) ?? 0) + 1)
    if (!lastPracticeDate || day > lastPracticeDate) lastPracticeDate = day
  }

  const practiceDays: PracticeDay[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i)
    practiceDays.push({ date, attempts: perDay.get(date) ?? 0 })
  }

  const latestMedians: LatestMedian[] = []
  for (const movement of MOVEMENTS) {
    if (!sessions.some((s) => s.movement_type === movement)) continue
    for (const metric of metricsForMovement(movement)) {
      const series = progressSeries(sessions, attempts, metrics, { movement, metric, timeZone })
      const latest = [...series.sessions].reverse().find((s) => s.median !== null)
      latestMedians.push({
        movement,
        metric,
        median: latest?.median ?? null,
        text: formatValue(metric, latest?.median),
        sessionId: latest?.sessionId ?? null,
        date: latest?.date ?? null,
        cameraView: series.cameraView,
        countedValues: latest?.countedValues ?? 0,
      })
    }
  }

  return {
    sessions: sessions.length,
    attempts: attempts.length,
    attemptsProcessed: attemptsByStatus.done,
    attemptsByStatus,
    lastPracticeDate,
    practiceDays,
    practiceDayCount: practiceDays.filter((d) => d.attempts > 0).length,
    latestMedians,
  }
}

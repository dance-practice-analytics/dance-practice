// Per-session numbers for the home dashboard and the progress page. Only sessions
// filmed from the front are compared with each other; the rest stay visible but
// are marked "not compared" (Development Document 1.6).

import { useEffect, useState } from 'react'
import type { MetricDefinition, MetricId, PhaseId, SessionResults, SessionSummary } from '../types'
import { api, ApiError } from '../api/client'
import { summarize, timeOnReleve } from './series'
import { describeChange } from './format'

export type Measure = MetricId | 'releve'

export interface Point {
  attempt: number
  value: number | null
  reason?: string
}

export interface Column {
  s: SessionSummary
  comparable: boolean
  points: Point[]
  median: number | null
}

export const RELEVE_DOMAIN: [number, number] = [0, 4]

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export const day = (iso: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) => new Date(iso).toLocaleDateString('en-US', opts)

/** One column per ready session, oldest first. `phase` only applies to metrics. */
export function columnsFor(sessions: SessionSummary[], results: Record<string, SessionResults>, measure: Measure, phase: PhaseId = 'hold'): Column[] {
  return sessions
    .filter((s) => results[s.id])
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    .map((s) => {
      const r = results[s.id]
      const metric = measure === 'releve' ? null : r.metrics.find((m) => m.id === measure)!
      const points: Point[] = r.attempts.map((a) => {
        if (!metric) {
          const v = timeOnReleve(r.series.heelLift, a, r.session.fps)
          return { attempt: a.index, value: v, reason: v === null ? 'Tracking gap' : undefined }
        }
        const ph = a.phases.find((p) => p.id === phase)!
        const sum = summarize(r.series[metric.id], ph, metric, r.session.fps)
        return { attempt: a.index, value: sum.available ? sum.mean : null, reason: sum.reason }
      })
      const comparable = s.conditions.view === 'front'
      return { s, comparable, points, median: comparable ? median(points.map((p) => p.value).filter((v): v is number => v !== null)) : null }
    })
}

/** "1.2 pts lower than Oct 24", or "about the same as Oct 24". */
export function sinceText(change: string, since: string): string {
  return change === 'about the same' ? `about the same as ${since}` : `${change} than ${since}`
}

/** Latest comparable median and the neutral change from the comparable session before it. */
export function latestChange(columns: Column[], metric: MetricDefinition | null): { value: number | null; change: string | null; since: string | null } {
  const usable = columns.filter((c) => c.comparable && c.median !== null)
  const last = usable[usable.length - 1]
  const prev = usable[usable.length - 2]
  if (!last) return { value: null, change: null, since: null }
  if (!prev) return { value: last.median, change: null, since: null }
  const change = metric
    ? describeChange(prev.median!, last.median!, metric)
    : Math.abs(last.median! - prev.median!) < 0.05
      ? 'about the same'
      : `${Math.abs(last.median! - prev.median!).toFixed(1)} s ${last.median! > prev.median! ? 'longer' : 'shorter'}`
  return { value: last.median, change, since: day(prev.s.recordedAt) }
}

/** Every session plus results for the ready ones. Fine for the pilot's ~20 sessions; a summary endpoint would avoid fetching pose data. */
export function useSessionsWithResults() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [results, setResults] = useState<Record<string, SessionResults>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api.listSessions().then(
      (list) => {
        if (!live) return
        setSessions(list)
        for (const s of list.filter((x) => x.status === 'ready')) {
          api.getSessionResults(s.id).then((r) => live && setResults((m) => ({ ...m, [s.id]: r })), () => undefined)
        }
      },
      (e) => live && setError(e instanceof ApiError ? e.message : 'Couldn’t load your sessions.'),
    )
    return () => {
      live = false
    }
  }, [])

  const readyCount = sessions?.filter((s) => s.status === 'ready').length ?? 0
  const loaded = sessions !== null && Object.keys(results).length >= readyCount
  return { sessions, results, error, loaded }
}

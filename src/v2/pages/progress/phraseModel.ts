// Progress of phrase attempts (movement 'phrase'): one small chart per theme across the
// dancer's own sessions, one camera view at a time. Same marks as the relevé charts
// (chartGeometry): dots, hollow low-confidence values, crosses for gaps, session medians.
// Phrase values are never put on a chart with relevé or pirouette values. Nothing grades.

import type { SessionSummary } from '../../../data/repo'
import type { CameraView } from '../../../data/schema'
import { exclusionText, sessionDay, type ExclusionCode, type ProgressPoint, type ProgressSession } from '../../../insights'
import type { AttemptView } from '../../data'
import { formatDate, formatNumber, NO_VALUE, VIEW_LABELS } from '../../format'
import { phraseOf, readTheme, THEME_KEYS, THEMES, type ThemeInfo, type ThemeKey } from '../phrase/model'
import { chartGeometry, dateBounds, sessionNames, type ChartGeometry, type DateRange, type ExcludedLine, type SessionColumn, type SessionNames } from './model'

export interface PhrasePanel {
  key: ThemeKey
  info: ThemeInfo
  sessions: ProgressSession[]
  geometry: ChartGeometry
  maxLabel: string | null
  minLabel: string | null
  summary: string
  aria: string
  /** Every attempt shown has no value for the same "nothing of this kind" reason. */
  empty: boolean
}

export interface PhraseProgressView {
  cameraView: CameraView | 'unknown' | null
  views: CameraView[]
  sessions: SessionColumn[]
  names: SessionNames
  panels: PhrasePanel[]
  excluded: ExcludedLine[]
  sessionsNote: string
  movementSessions: number
}

export interface PhraseFilters {
  cameraView?: CameraView
  range?: DateRange
  from?: string
  to?: string
}

const VIEW_ORDER: CameraView[] = ['front', 'side', 'diagonal']
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function medianOf(v: number[]): number | null {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  const k = s.length >> 1
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2
}

function valueText(info: ThemeInfo, v: number | null): string {
  return v === null ? NO_VALUE : `${formatNumber(v, info.decimals)}${info.unitShort}`
}

/** 'Session 3 reaches 0.05 arm lengths further than Session 1' — neutral, rounded as on screen. */
export function sessionChange(info: ThemeInfo, first: { name: string; median: number }, latest: { name: string; median: number }): string {
  const r = (v: number) => Math.round(v * 10 ** info.decimals) / 10 ** info.decimals
  const d = r(r(latest.median) - r(first.median))
  if (d === 0) return `${latest.name} and ${first.name} have the same median`
  return `${latest.name} is ${formatNumber(Math.abs(d), info.decimals)}${info.unitShort} ${d > 0 ? info.more : info.less} than ${first.name}`
}

export function buildPhraseProgress(
  sessions: readonly SessionSummary[],
  attempts: readonly AttemptView[],
  filters: PhraseFilters,
  now: Date = new Date(),
): PhraseProgressView {
  const ofMovement = sessions.filter((s) => s.movement_type === 'phrase')
  const views = VIEW_ORDER.filter((v) => ofMovement.some((s) => s.camera_view === v))
  const counts = new Map<CameraView, number>()
  for (const s of ofMovement) if (s.camera_view) counts.set(s.camera_view, (counts.get(s.camera_view) ?? 0) + 1)
  const busiest = [...views].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0] ?? null
  const view: CameraView | null = filters.cameraView && views.includes(filters.cameraView) ? filters.cameraView : busiest
  const names = sessionNames(sessions, attempts, 'phrase')
  const bounds = dateBounds(filters.range ?? 'custom', now, filters)

  const included: { s: SessionSummary; date: string; own: AttemptView[] }[] = []
  const excluded: ExcludedLine[] = []
  const exclude = (s: SessionSummary, date: string | null, reason: ExclusionCode) =>
    excluded.push({
      sessionId: s.id,
      what: [names.get(s.id) ?? null, date ? formatDate(date, now) : 'No date', s.camera_view ? VIEW_LABELS[s.camera_view] : null].filter(Boolean).join(' · '),
      reason: exclusionText(reason),
    })
  for (const s of ofMovement) {
    const own = attempts.filter((a) => a.session_id === s.id).sort((a, b) => a.created_at.localeCompare(b.created_at))
    const date = own.length ? sessionDay(s, own) : null
    if (!own.length) continue
    if (!date) exclude(s, null, 'no_date')
    else if (view && s.camera_view === null) exclude(s, date, 'unknown_camera_view')
    else if (view && s.camera_view !== view) exclude(s, date, 'different_camera_view')
    else if ((bounds.from && date < bounds.from) || (bounds.to && date > bounds.to)) exclude(s, date, 'outside_date_range')
    else included.push({ s, date, own })
  }
  included.sort((a, b) => a.date.localeCompare(b.date) || a.s.created_at.localeCompare(b.s.created_at))

  const panels = THEME_KEYS.map((key): PhrasePanel => {
    const info = THEMES[key]
    const progress: ProgressSession[] = included.map(({ s, date, own }) => {
      const points: ProgressPoint[] = own.map((a) => {
        const phrase = phraseOf(a.metrics)
        const r = readTheme(phrase, key)
        const pending = !a.metrics
        const low = r.value !== null && r.confidence === 'low'
        return {
          attemptId: a.id,
          sessionId: s.id,
          label: a.label,
          date,
          at: a.created_at,
          value: r.value,
          gap:
            r.value !== null
              ? null
              : a.status === 'failed'
                ? { code: 'processing_failed' }
                : pending || !phrase
                  ? { code: 'not_processed' }
                  : { code: 'no_value', nullReason: r.reasonCode ?? undefined },
          confidence: r.value === null ? null : r.confidence === 'none' ? null : r.confidence,
          lowConfidence: low,
          counted: r.value !== null && !low,
        }
      })
      const counted = points.filter((p) => p.counted).map((p) => p.value as number)
      const median = medianOf(counted)
      return { sessionId: s.id, title: s.title, date, cameraView: s.camera_view, points, median, medianText: valueText(info, median), countedValues: counted.length }
    })
    const geometry = chartGeometry(progress)
    const label = (v: number) => `${Number(v.toPrecision(6))}${info.unitShort.trim() === 'arm lengths' ? '' : info.unitShort}`
    const withMedian = progress.filter((p) => p.median !== null)
    const nameOf = (id: string, date: string) => names.get(id) ?? formatDate(date, now)
    let summary: string
    if (!progress.length) summary = 'No sessions in this view and date range.'
    else if (!withMedian.length) summary = 'No values yet.'
    else if (withMedian.length === 1) summary = `Median ${withMedian[0].medianText} in ${nameOf(withMedian[0].sessionId, withMedian[0].date)}. Change appears after a second session.`
    else {
      const first = withMedian[0]
      const last = withMedian[withMedian.length - 1]
      summary = `Medians ${progress.map((p) => p.medianText).join(' → ')}. ${sessionChange(info, { name: nameOf(first.sessionId, first.date), median: first.median! }, { name: nameOf(last.sessionId, last.date), median: last.median! })}.`
    }
    const points = progress.flatMap((p) => p.points)
    const empty = points.length > 0 && points.every((p) => p.value === null && p.gap?.code === 'no_value' && ['no_plie_detected', 'no_circle_detected', 'no_paired_onsets'].includes(p.gap.nullReason ?? ''))
    return {
      key,
      info,
      sessions: progress,
      geometry,
      maxLabel: geometry.max === null ? null : label(geometry.max),
      minLabel: geometry.min === null ? null : geometry.min === 0 ? '0' : label(geometry.min),
      summary,
      aria: `${info.label}, ${info.unit}. ${progress.map((p) => `${nameOf(p.sessionId, p.date)}: ${p.median === null ? 'no value' : p.medianText}`).join(', ')}. ${summary}`,
      empty,
    }
  })

  const cols: SessionColumn[] = included.map(({ s, date, own }) => {
    const processed = own.filter((a) => a.metrics).length
    return {
      sessionId: s.id,
      date,
      name: names.get(s.id) ?? formatDate(date, now),
      dateLabel: formatDate(date, now),
      title: s.title,
      partial: processed < own.length,
      attempts: own.length,
      processed,
    }
  })
  const attemptCount = cols.reduce((n, c) => n + c.attempts, 0)
  return {
    cameraView: view ?? (ofMovement.length ? 'unknown' : null),
    views,
    sessions: cols,
    names,
    panels,
    excluded,
    sessionsNote: [plural(cols.length, 'session'), plural(attemptCount, 'attempt')].join(' · '),
    movementSessions: ofMovement.length,
  }
}

/** Latest session median of each theme and its neutral change from the first session (Dashboard). */
export interface PhraseTile {
  key: ThemeKey
  name: string
  value: string
  unit: string
  /** Neutral change sentence or what is still needed. */
  delta: string
  none: boolean
}

export function phraseTiles(view: PhraseProgressView, focus: readonly ThemeKey[] = []): PhraseTile[] {
  const order = [...focus.filter((k) => THEME_KEYS.includes(k)), ...THEME_KEYS.filter((k) => !focus.includes(k))]
  return order.map((key) => {
    const panel = view.panels.find((p) => p.key === key)!
    const withMedian = panel.sessions.filter((s) => s.median !== null)
    const last = withMedian[withMedian.length - 1] ?? null
    const first = withMedian[0] ?? null
    const name = (id: string) => view.names.get(id) ?? 'this session'
    return {
      key,
      name: panel.info.label,
      value: last ? formatNumber(last.median, panel.info.decimals) : NO_VALUE,
      unit: panel.info.unitShort.trim() || panel.info.unit,
      none: last === null,
      delta:
        last === null
          ? 'No value yet.'
          : withMedian.length < 2
            ? 'Change appears after a second session.'
            : `${sessionChange(panel.info, { name: name(first!.sessionId), median: first!.median! }, { name: name(last.sessionId), median: last.median! })}.`,
    }
  })
}

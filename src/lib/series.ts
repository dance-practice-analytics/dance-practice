import type { Attempt, Keypoint, MetricDefinition, MetricSample, Phase, PhaseId, PhaseSummary, Point, PoseFrame, Seconds } from '../types'
import { RELEVE_THRESHOLD } from '../mock/metricsEngine'

const idx = (t: Seconds, fps: number, n: number) => Math.min(n - 1, Math.max(0, Math.round(t * fps)))

export function sampleAt(series: MetricSample[], t: Seconds, fps: number): MetricSample {
  return series[idx(t, fps, series.length)]
}

export interface PoseAt {
  points: Record<Keypoint, Point>
  confidence: number
}

/** Pose at an arbitrary time, interpolated between frames; null where tracking was lost. */
export function poseAt(pose: PoseFrame[], t: Seconds, fps: number): PoseAt | null {
  const x = Math.min(pose.length - 1, Math.max(0, t * fps))
  const a = pose[Math.floor(x)]
  const b = pose[Math.min(pose.length - 1, Math.floor(x) + 1)]
  if (!a.points) return null
  if (!b.points) return { points: a.points, confidence: a.confidence }
  const u = x - Math.floor(x)
  const points = {} as Record<Keypoint, Point>
  for (const k of Object.keys(a.points) as Keypoint[]) {
    const p = a.points[k]
    const q = b.points[k]
    points[k] = [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]
  }
  return { points, confidence: Math.min(a.confidence, b.confidence) }
}

export function appliesIn(metric: MetricDefinition, phase: PhaseId | undefined) {
  return phase !== undefined && metric.phases.includes(phase)
}

const MIN_COVERAGE = 0.6

export function summarize(series: MetricSample[], phase: Phase, metric: MetricDefinition, fps: number): PhaseSummary {
  if (!appliesIn(metric, phase.id)) {
    return { mean: null, peak: null, peakT: null, coverage: 0, available: false, reason: `Not measured during ${phase.label}` }
  }
  const from = idx(phase.start, fps, series.length)
  const to = idx(phase.end, fps, series.length)
  const window = series.slice(from, Math.max(from + 1, to))
  const usable = window.filter((s) => s.quality === 'ok' && s.value !== null)
  const coverage = usable.length / window.length
  if (coverage < MIN_COVERAGE) {
    return { mean: null, peak: null, peakT: null, coverage, available: false, reason: `Tracking covered ${Math.round(coverage * 100)}% of ${phase.label}` }
  }
  const key = (s: MetricSample) => (metric.peak === 'min' ? -s.value! : metric.peak === 'maxAbs' ? Math.abs(s.value!) : s.value!)
  const peak = usable.reduce((best, s) => (key(s) > key(best) ? s : best))
  const mean = usable.reduce((sum, s) => sum + s.value!, 0) / usable.length
  return { mean, peak: peak.value, peakT: peak.t, coverage, available: true }
}

/** Seconds the heels stay above the relevé threshold within an attempt; null if tracking is too patchy. */
export function timeOnReleve(heel: MetricSample[], attempt: Attempt, fps: number): Seconds | null {
  const window = heel.slice(idx(attempt.start, fps, heel.length), idx(attempt.end, fps, heel.length))
  const missing = window.filter((s) => s.value === null).length
  if (missing / window.length > 0.05) return null
  return window.filter((s) => (s.value ?? 0) >= RELEVE_THRESHOLD).length / fps
}

export interface QualitySpan {
  from: Seconds
  to: Seconds
  kind: 'low' | 'missing'
}

export function qualitySpans(series: MetricSample[], start: Seconds, end: Seconds, fps: number): QualitySpan[] {
  const spans: QualitySpan[] = []
  for (const s of series.slice(idx(start, fps, series.length), idx(end, fps, series.length) + 1)) {
    if (s.quality === 'ok') continue
    const last = spans[spans.length - 1]
    if (last && last.kind === s.quality && s.t - last.to <= 1.5 / fps) last.to = s.t + 1 / fps
    else spans.push({ from: s.t, to: s.t + 1 / fps, kind: s.quality })
  }
  return spans
}

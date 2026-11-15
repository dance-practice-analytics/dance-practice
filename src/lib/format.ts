import type { MetricDefinition, Seconds } from '../types'

export function formatTime(t: Seconds): string {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

export function formatValue(v: number | null | undefined, m: MetricDefinition, withUnit = true): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  // Avoid printing "-0.0" for values that round to zero.
  const n = (Math.abs(v) < 0.5 * 10 ** -m.decimals ? 0 : v).toFixed(m.decimals)
  if (!withUnit) return n
  return m.unit === '°' ? `${n}°` : `${n} ${m.unit}`
}

/** Neutral description of a change between two values: direction and size, never good or bad. */
export function describeChange(a: number, b: number, m: MetricDefinition): string {
  const d = b - a
  if (Math.abs(d) < 10 ** -m.decimals) return 'about the same'
  const size = Math.abs(d).toFixed(m.decimals)
  return `${size}${m.unit === '°' ? '°' : ' pts'} ${d > 0 ? 'higher' : 'lower'}`
}

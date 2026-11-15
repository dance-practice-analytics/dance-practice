import type { Attempt, Phase, Seconds } from '../types'

export function attemptAt(attempts: Attempt[], t: Seconds): Attempt | undefined {
  return attempts.find((a) => t >= a.start && t < a.end)
}

/** The attempt under the playhead, else the last one that started before it, else the first. */
export function attemptNear(attempts: Attempt[], t: Seconds): Attempt {
  return attemptAt(attempts, t) ?? [...attempts].reverse().find((a) => a.start <= t) ?? attempts[0]
}

export function phaseAt(attempt: Attempt | undefined, t: Seconds): Phase | undefined {
  return attempt?.phases.find((p) => t >= p.start && t < p.end)
}

/** Editable boundaries: attempt start, each phase start, last phase end, attempt end. */
export function boundaries(a: Attempt): Seconds[] {
  return [a.start, ...a.phases.map((p) => p.start), a.phases[a.phases.length - 1].end, a.end]
}

const MIN_GAP = 0.1

/** Move boundary k, keeping every boundary in order with a minimum gap. */
export function withBoundary(a: Attempt, k: number, t: Seconds, lo: Seconds, hi: Seconds, fps: number): Attempt {
  const b = boundaries(a)
  const min = k === 0 ? lo : b[k - 1] + MIN_GAP
  const max = k === b.length - 1 ? hi : b[k + 1] - MIN_GAP
  b[k] = Math.round(Math.min(max, Math.max(min, t)) * fps) / fps
  const n = a.phases.length
  return {
    ...a,
    start: b[0],
    end: b[n + 2],
    phases: a.phases.map((p, i) => ({ ...p, start: b[i + 1], end: b[i + 2] })),
  }
}

/**
 * Map a time in one attempt to the matching moment in another, segment by
 * segment (lead-in, each phase, lead-out), so phases line up even when the
 * attempts have different tempos.
 */
export function mapTime(t: Seconds, from: Attempt, to: Attempt): Seconds {
  const fb = boundaries(from)
  const tb = boundaries(to)
  const c = Math.min(from.end, Math.max(from.start, t))
  for (let i = 0; i < fb.length - 1; i++) {
    if (c <= fb[i + 1] || i === fb.length - 2) {
      const span = fb[i + 1] - fb[i]
      const u = span > 0 ? (c - fb[i]) / span : 0
      return tb[i] + u * (tb[i + 1] - tb[i])
    }
  }
  return to.start
}

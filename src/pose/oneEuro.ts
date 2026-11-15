// One-Euro filter (Casiez, Roussel and Vogel, CHI 2012) for landmark smoothing (FR-3.3.4).
// A low-pass filter whose cutoff rises with the speed of the signal: little jitter when
// the body is still, little lag when it moves fast.

import type { Landmark, PoseFrame, PoseSeries } from './types'

export interface OneEuroParams {
  /** Cutoff of the position filter when the signal is still, in Hz. */
  minCutoff: number
  /** How much the cutoff grows with speed (Hz per unit/second). */
  beta: number
  /** Cutoff of the low-pass applied to the derivative, in Hz. */
  dCutoff: number
}

/** SDD 5.4: minimum cutoff 1.0 Hz, beta 0.007, derivative cutoff 1.0 Hz. */
export const ONE_EURO_DEFAULTS: OneEuroParams = { minCutoff: 1.0, beta: 0.007, dCutoff: 1.0 }

const alpha = (cutoffHz: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoffHz)
  return 1 / (1 + tau / dt)
}

/** Filter for one scalar coordinate. Timestamps are in seconds and must increase. */
export class OneEuroFilter {
  private readonly params: OneEuroParams
  private prevT: number | null = null
  private prevX = 0
  private prevDx = 0

  constructor(params: Partial<OneEuroParams> = {}) {
    this.params = { ...ONE_EURO_DEFAULTS, ...params }
  }

  /** Forgets the history; the next sample passes through unchanged. */
  reset() {
    this.prevT = null
    this.prevX = 0
    this.prevDx = 0
  }

  filter(x: number, t: number): number {
    if (this.prevT === null || t <= this.prevT) {
      // First sample (or a non-increasing timestamp): start over from this value.
      this.prevT = t
      this.prevX = x
      this.prevDx = 0
      return x
    }
    const { minCutoff, beta, dCutoff } = this.params
    const dt = t - this.prevT
    const rawDx = (x - this.prevX) / dt
    const dx = this.prevDx + alpha(dCutoff, dt) * (rawDx - this.prevDx)
    const cutoff = minCutoff + beta * Math.abs(dx)
    const out = this.prevX + alpha(cutoff, dt) * (x - this.prevX)
    this.prevT = t
    this.prevX = out
    this.prevDx = dx
    return out
  }
}

const AXES = ['x', 'y', 'z'] as const

/** Filters the x/y/z tracks of one landmark set (image or world) across frames. */
function smoothTrack(
  frames: PoseFrame[],
  key: 'image' | 'world',
  params: Partial<OneEuroParams>,
): (Landmark[] | null)[] {
  let filters: OneEuroFilter[] = []
  return frames.map((frame) => {
    const landmarks = frame[key]
    if (!landmarks) {
      // A gap: it stays a gap, and whatever comes after starts from scratch so
      // nothing is carried (or implied) across the missing frames.
      for (const f of filters) f.reset()
      return null
    }
    if (filters.length !== landmarks.length * AXES.length) {
      filters = Array.from({ length: landmarks.length * AXES.length }, () => new OneEuroFilter(params))
    }
    return landmarks.map((lm, i) => ({
      x: filters[i * 3].filter(lm.x, frame.t),
      y: filters[i * 3 + 1].filter(lm.y, frame.t),
      z: filters[i * 3 + 2].filter(lm.z, frame.t),
      visibility: lm.visibility,
    }))
  })
}

/**
 * Returns a smoothed copy of the series (the input is not modified). x/y/z of the image
 * and world landmarks are filtered; `visibility` is untouched; null frames stay null and
 * reset the filters. A series that is already smoothed is returned as is, because
 * filtering twice would only add lag.
 */
export function smoothSeries(series: PoseSeries, params: Partial<OneEuroParams> = {}): PoseSeries {
  if (series.smoothed) return series
  const image = smoothTrack(series.frames, 'image', params)
  const world = smoothTrack(series.frames, 'world', params)
  return {
    ...series,
    smoothed: true,
    frames: series.frames.map((frame, i) => ({ t: frame.t, image: image[i], world: world[i] })),
  }
}

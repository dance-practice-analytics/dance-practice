// One-Euro filter (Casiez, Roussel and Vogel, CHI 2012) for landmark smoothing (FR-3.3.4).
// A low-pass filter whose cutoff rises with the speed of the signal: little jitter when
// the body is still, little lag when it moves fast.

import { unswapLeftRight } from './swaps'
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

/**
 * Parameters for the world landmarks (metres), which the metrics engine reads. Same
 * cutoffs as the SDD; beta 0.7 Hz per m/s instead of 0.007.
 *
 * beta has units: it is how many hertz the cutoff rises per unit of speed. 0.007 is the
 * 1€ filter's published starting value for pointer positions in pixels, where speeds are
 * hundreds of units per second. In metres a shoulder in a fast pirouette moves 2–5 m/s,
 * so 0.007 raised the cutoff by 0.01–0.03 Hz: the filter stayed a fixed 1 Hz low-pass,
 * and a shoulder line turning 3–4 times a second came out shrunk to a quarter and lagging
 * by most of a quarter turn. In the synthetic sweep (CALIBRATION.md) a single turn at a
 * peak of 4 turns/s then counted as 0 turns in 20 of 20 runs.
 *
 * 0.7 is the smallest of the values tried (0.007, 0.7, 3, 7) that counts 1–3 turns at
 * peaks of 3–5 turns/s right in 19–20 of 20 runs. It leaves stillness alone: on real
 * MediaPipe output of a still synthetic figure the derivative-filtered speed of the world
 * landmarks has a median of 0.02 m/s and a 95th percentile of 0.10–0.13 m/s, which
 * raises the cutoff by under 0.1 Hz. 3 and 7 count turns as well but let jitter through, and the
 * balance duration of a still synthetic hold dropped from 2.5 s to 1.1 s and 0.7 s in
 * the worst run. The image landmarks (display only) keep the SDD values.
 */
export const ONE_EURO_WORLD: OneEuroParams = { ...ONE_EURO_DEFAULTS, beta: 0.7 }

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
function smoothTrack(frames: PoseFrame[], key: 'image' | 'world', params: Partial<OneEuroParams>): (Landmark[] | null)[] {
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
 * Returns a smoothed copy of the series (the input is not modified). Left/right label
 * swaps are undone first (`unswapLeftRight`; the frames keep `relabeled: true`), because
 * a swap that is smoothed turns into a fake rotation. Then x/y/z of the image and world
 * landmarks are filtered; `visibility` is untouched; null frames stay null and reset the
 * filters. World landmarks use ONE_EURO_WORLD and image landmarks the SDD values;
 * `params` overrides both. A series that is already smoothed is returned as is, because
 * filtering twice would only add lag.
 */
export function smoothSeries(series: PoseSeries, params: Partial<OneEuroParams> = {}): PoseSeries {
  if (series.smoothed) return series
  const { frames } = unswapLeftRight(series)
  const image = smoothTrack(frames, 'image', { ...ONE_EURO_DEFAULTS, ...params })
  const world = smoothTrack(frames, 'world', { ...ONE_EURO_WORLD, ...params })
  return {
    ...series,
    smoothed: true,
    frames: frames.map((frame, i) => {
      const out: PoseFrame = { t: frame.t, image: image[i], world: world[i] }
      if (frame.relabeled) out.relabeled = true
      return out
    }),
  }
}

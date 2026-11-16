// Known-answer calibration of the metrics engine (CALIBRATION.md). Every series here is
// built by src/metrics/testing/syntheticDancer.ts with exact geometry, so each metric has
// a true value set by the test. Two layers:
// 1. exact: no noise, no smoothing. The formulas must give the true value to rounding
//    error; anything else is a formula bug.
// 2. tracker-like: MediaPipe-like noise, weak feet, dropped frames and left/right swaps,
//    then the app's own smoothing (smoothSeries), as in the processing pipeline. The
//    engine must stay within the stated tolerance in every seeded run.
// No footage and no participant data: every number is made up.

import { describe, expect, it } from 'vitest'
import { smoothSeries } from '../pose/oneEuro'
import type { PoseSeries } from '../pose/types'
import { computeMetrics } from './engine'
import { detectLift, LIFT_OFF, riseEnd, segmentPhases } from './phases'
import type { AttemptMetrics, Movement } from './types'
import {
  addTrackerNoise,
  dancerSeries,
  HIP_HALF,
  LEG,
  liftProfile,
  MEDIAPIPE_LIKE,
  NEUTRAL,
  RELEVE,
  smoothstep,
  type DancerPose,
  type NoiseModel,
  type ReleveTiming,
} from './testing/syntheticDancer'

const FPS = 30
const SEEDS = Array.from({ length: 12 }, (_, k) => k + 1)

const releve = (extra: Partial<DancerPose> | ((t: number) => Partial<DancerPose>) = {}, timing: ReleveTiming = RELEVE) =>
  dancerSeries(
    (t) => ({ ...NEUTRAL, lift: liftProfile(t, timing), ...(typeof extra === 'function' ? extra(t) : extra) }),
    timing.riseAt + 2 * timing.riseS + timing.holdS + 2,
  )

/** A pirouette of `turns` with a smooth start and stop and a peak rate of `peakTurnsPerS`. */
function pirouette(turns: number, peakTurnsPerS: number) {
  // smoothstep: peak rate = 1.5 × mean rate.
  const turnS = turns / (peakTurnsPerS / 1.5)
  const timing = { ...RELEVE, holdS: turnS + 0.6 }
  return dancerSeries(
    (t) => ({
      ...NEUTRAL,
      lift: liftProfile(t, timing),
      retire: t > 1.8 && t < 2 + turnS + 0.6,
      yawDeg: 360 * turns * smoothstep((t - 2.1) / turnS),
    }),
    4 + turnS + 1,
  )
}

/** Plié before the rise: knee flexion up to `bendDeg`, knee turned `devDeg` off the foot. */
const plie = (devDeg: number, bendDeg = 50) =>
  releve((t) => ({ plie: t > 0.2 && t < 1.4 ? { bendDeg: bendDeg * Math.sin((Math.PI * (t - 0.2)) / 1.2), devDeg } : null }))

const exact = (s: PoseSeries, movement: Movement = 'releve_balance') => computeMetrics({ ...s, smoothed: true }, movement)
const tracked = (s: PoseSeries, seed: number, movement: Movement = 'releve_balance', model: NoiseModel = MEDIAPIPE_LIKE) =>
  computeMetrics(smoothSeries(addTrackerNoise(s, model, seed)), movement)
const NO_GAPS: NoiseModel = { ...MEDIAPIPE_LIKE, dropoutRate: 0 }

/** Balance duration the SDD defines, from the noise-free heel profile (the pelvis stays in the band). */
function balanceTruth(timing: ReleveTiming): number {
  const n = Math.round((timing.riseAt + 2 * timing.riseS + timing.holdS + 2) * FPS)
  const lift = Array.from({ length: n }, (_, i) => liftProfile(i / FPS, timing))
  const found = detectLift(lift) as { onset: number; end: number }
  return (found.end - riseEnd(lift, lift.map((_, i) => i / FPS), found.onset, found.end)) / FPS
}

const errors = (runs: AttemptMetrics[], key: 'trunk_inclination_deg' | 'pelvis_ankle_offset_norm' | 'balance_duration_s' | 'knee_tracking_dev_deg', truth: number) =>
  runs.map((m) => (m[key] as number) - truth)
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

describe('exact geometry: the formulas return the true value', () => {
  it.each([0, 5, 10, 20])('trunk inclination of %i° in any direction', (deg) => {
    for (const az of [0, 45, 90, 180, 270]) {
      expect(exact(releve({ trunkDeg: deg, trunkAzDeg: az })).trunk_inclination_deg).toBeCloseTo(deg, 6)
    }
  })

  it.each([0, 0.05, 0.1, 0.2])('pelvis–ankle offset of %f leg lengths in any direction', (share) => {
    for (const az of [0, 60, 135, 270]) {
      const a = (az * Math.PI) / 180
      const offset = { x: share * LEG * Math.cos(a), z: share * LEG * Math.sin(a) }
      expect(exact(releve({ offset })).pelvis_ankle_offset_norm).toBeCloseTo(share, 6)
    }
  })

  it.each([0.5, 1, 2, 3])('balance duration of a %f s hold is the hold the SDD defines', (holdS) => {
    const timing = { ...RELEVE, holdS }
    const m = exact(releve({}, timing))
    expect(m.balance_duration_s).toBeCloseTo(balanceTruth(timing), 6)
    // The definition runs from the end of the rise to the heel dropping under LIFT_OFF,
    // so it is longer than the time spent at the top by part of the rise and the lowering.
    expect(m.balance_duration_s as number).toBeGreaterThan(holdS)
    expect(m.balance_duration_s as number).toBeLessThan(holdS + 2 * RELEVE.riseS)
  })

  it.each([0, 5, 10, 20])('knee tracking deviation of %i° in the plié', (dev) => {
    expect(exact(plie(dev)).knee_tracking_dev_deg).toBeCloseTo(dev, 1)
    expect(exact(plie(-dev)).knee_tracking_dev_deg).toBeCloseTo(dev, 1)
  })

  it.each([0.5, 1, 1.5, 2, 3])('turn count of %f turns', (turns) => {
    expect(exact(pirouette(turns, 3), 'pirouette').turn_count).toBe(turns)
  })

  it('takes the left leg in a parallel relevé (SDD 5.4) and the lower heel otherwise', () => {
    expect(segmentPhases({ ...releve(), smoothed: true }, 'releve_balance').support).toBe('left')
    expect(segmentPhases({ ...pirouette(1, 3), smoothed: true }, 'pirouette').support).toBe('left')
  })
})

describe('tracker-like noise, after the app smoothing (12 seeded runs per case)', () => {
  it('a parallel relevé always gets the left leg, not whichever heel the noise puts lower', () => {
    const s = releve({ offset: { x: 0.18, z: 0 } })
    for (const seed of SEEDS) expect(segmentPhases(smoothSeries(addTrackerNoise(s, MEDIAPIPE_LIKE, seed)), 'releve_balance').support).toBe('left')
  })

  it.each([5, 10, 20])('trunk inclination of %i°: every run within 2.5°, mean within 0.5°', (deg) => {
    for (const az of [0, 90]) {
      const errs = errors(SEEDS.map((seed) => tracked(releve({ trunkDeg: deg, trunkAzDeg: az }), seed)), 'trunk_inclination_deg', deg)
      for (const e of errs) expect(Math.abs(e)).toBeLessThan(2.5)
      expect(Math.abs(mean(errs))).toBeLessThan(0.5)
    }
  })

  it('trunk inclination of 0° reads slightly high: an unsigned angle folds the noise', () => {
    // Documented bias of the definition (median of per-frame unsigned angles), not tuned away.
    const errs = errors(SEEDS.map((seed) => tracked(releve(), seed)), 'trunk_inclination_deg', 0)
    for (const e of errs) expect(e).toBeGreaterThan(0)
    for (const e of errs) expect(e).toBeLessThan(2.5)
  })

  it.each([0.05, 0.1, 0.2])('pelvis–ankle offset of %f: every run within 0.03 leg lengths', (share) => {
    const errs = errors(SEEDS.map((seed) => tracked(releve({ offset: { x: share * LEG, z: 0 } }), seed)), 'pelvis_ankle_offset_norm', share)
    for (const e of errs) expect(Math.abs(e)).toBeLessThan(0.03)
  })

  it('pelvis–ankle offset of 0 reads slightly high: a distance folds the noise', () => {
    const errs = errors(SEEDS.map((seed) => tracked(releve({ offset: { x: 0, z: 0 } }), seed)), 'pelvis_ankle_offset_norm', 0)
    for (const e of errs) expect(e).toBeGreaterThan(0)
    for (const e of errs) expect(e).toBeLessThan(0.05)
  })

  it.each([1, 2, 3])('balance duration of a %i s hold: the hold is found within 0.2 s, and the value never reads long', (holdS) => {
    const timing = { ...RELEVE, holdS }
    const truth = balanceTruth(timing)
    const runs = SEEDS.map((seed) => tracked(releve({}, timing), seed, 'releve_balance', NO_GAPS))
    for (const m of runs) {
      const hold = m.phases.find((p) => p.phase === 'hold') as { start: number; end: number }
      expect(Math.abs(hold.end - hold.start - truth)).toBeLessThan(0.2)
      expect(m.balance_duration_s as number).toBeLessThan(truth + 0.2)
    }
    // Known limit, not tuned away (CALIBRATION.md): depth noise at the level measured on
    // MediaPipe output pushes the hip-over-ankle speed past 0.15 m/s now and then, and each
    // time the run restarts. Most runs are within 0.2 s; the rest read short.
    expect(errors(runs, 'balance_duration_s', truth).filter((e) => Math.abs(e) < 0.2).length).toBeGreaterThanOrEqual(6)
  })

  it('balance duration with dropped frames is never longer than the truth: a gap ends the run', () => {
    const timing = { ...RELEVE, holdS: 3 }
    const truth = balanceTruth(timing)
    for (const m of SEEDS.map((seed) => tracked(releve({}, timing), seed))) {
      expect(m.balance_duration_s as number).toBeLessThan(truth + 0.2)
    }
  })

  it.each([0, 5, 10, 20])('knee tracking deviation of %i°: every run within 10°, mean within 3°', (dev) => {
    // The knee's horizontal direction is a few centimetres long in a plié and half of it is
    // depth, the noisiest axis: this metric is noise-limited, not formula-limited.
    const errs = errors(SEEDS.map((seed) => tracked(plie(dev), seed)), 'knee_tracking_dev_deg', dev)
    for (const e of errs) expect(Math.abs(e)).toBeLessThan(10)
    expect(Math.abs(mean(errs))).toBeLessThan(3)
  })

  it.each([
    [1, 2],
    [2, 3],
    [3, 3],
    [1, 4],
    [2, 4],
    [3, 5],
  ])('turn count of %i turns at a peak of %i turns/s with dropped frames: every miss is flagged low', (turns, peak) => {
    const runs = SEEDS.map((seed) => tracked(pirouette(turns, peak), seed, 'pirouette'))
    expect(runs.filter((m) => m.turn_count === turns).length).toBeGreaterThanOrEqual(9)
    // Rotation inside a gap cannot be seen (FR-3.4.6). A wrong count must say so.
    for (const m of runs.filter((r) => r.turn_count !== turns)) {
      expect(m.confidence.turn_count.level).toBe('low')
      expect(m.confidence.turn_count.notes).toContain('tracking_lost_in_turn')
    }
  })

  it('turn count is exact when no frame is dropped, swaps included', () => {
    for (const [turns, peak] of [
      [1, 3],
      [2, 4],
      [3, 5],
    ]) {
      for (const seed of SEEDS) expect(tracked(pirouette(turns, peak), seed, 'pirouette', NO_GAPS).turn_count).toBe(turns)
    }
  })

  it('lift end stays close to the noise-free definition (hysteresis)', () => {
    const timing = { ...RELEVE, holdS: 2 }
    const s = releve({}, timing)
    const n = s.frames.length
    const lift = Array.from({ length: n }, (_, i) => liftProfile(i / FPS, timing))
    const truthEnd = (detectLift(lift) as { end: number }).end / FPS
    for (const seed of SEEDS) {
      const m = tracked(s, seed, 'releve_balance', NO_GAPS)
      const finish = m.phases.find((p) => p.phase === 'finish') as { start: number }
      // The smoothing delays the signal by ~0.1–0.2 s.
      expect(finish.start - truthEnd).toBeGreaterThan(-0.1)
      expect(finish.start - truthEnd).toBeLessThan(0.3)
    }
    expect(LIFT_OFF).toBeGreaterThan(0)
  })
})

describe('the synthetic dancer itself', () => {
  it('keeps both legs at exactly the leg length in every pose', () => {
    const s = plie(10)
    for (const f of s.frames) {
      const w = f.world!
      for (const [h, k, a] of [
        [23, 25, 27],
        [24, 26, 28],
      ]) {
        const d = (i: number, j: number) => Math.hypot(w[i].x - w[j].x, w[i].y - w[j].y, w[i].z - w[j].z)
        expect(d(h, k) + d(k, a)).toBeCloseTo(LEG, 9)
      }
    }
    expect(HIP_HALF).toBeGreaterThan(0)
  })
})

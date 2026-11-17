// Known-answer tests for the phrase prototypes (events.ts, expressive.ts) on the synthetic
// phrase dancer. No footage, no participant data.

import { describe, expect, it } from 'vitest'
import { bodySignals, detectEvents, directionLabel } from './events'
import { armReach, circles, expressiveSummary, headLead, headMotion, headTrunk, imageKneeOffset, signedKneeDev } from './expressive'
import { bump, frontImage, phraseLandmarks, phraseSeries, STAND, type PhrasePose } from './testing/phraseDancer'
import { addTrackerNoise, MEDIAPIPE_LIKE } from './testing/syntheticDancer'
import { smoothSeries } from '../pose/oneEuro'

const at = (over: Partial<PhrasePose>): PhrasePose => ({ ...STAND, ...over })

describe('body signals', () => {
  it('reads leg elevation and direction in the pelvis frame, whatever the yaw', () => {
    for (const yawDeg of [0, 70, 180, -120]) {
      for (const [azDeg, label] of [
        [0, 'front'],
        [90, 'side'],
        [180, 'back'],
      ] as const) {
        const s = phraseSeries(() => at({ yawDeg, gesture: { side: 'right', elevDeg: 80, azDeg } }), 0.2)
        const sig = bodySignals(s)
        expect(sig.legElev.right[0]).toBeCloseTo(80, 3)
        const az = sig.legAz.right[0] as number
        // Right leg to its own side is +90 in the pelvis frame.
        expect(Math.abs(Math.abs(az) - azDeg)).toBeLessThan(1e-6 + (azDeg === 180 ? 0 : 0))
        expect(directionLabel(az, 'right')).toBe(label)
      }
    }
  })

  it('puts the front where the feet point (handedness), and the left side at −90', () => {
    const s = phraseSeries(() => at({ gesture: { side: 'left', elevDeg: 60, azDeg: 90 } }), 0.2)
    expect(bodySignals(s).legAz.left[0]).toBeCloseTo(-90, 6)
    expect(bodySignals(s).labelDoubt[0]).toBe(false)
    const standing = bodySignals(phraseSeries(() => at({ turnoutDeg: 45 }), 0.2))
    expect(standing.labelDoubt[0]).toBe(false)
  })
})

describe('phrase events', () => {
  // 0–1 s stand, 1–2.5 s right leg to the side at 90°, 2.5–3.5 s stand, 3.5–4.5 s relevé,
  // 4.5–5.5 s stand, 5.5–7 s left leg back at 60° with a bent knee, then a forward fold, a
  // plié and a full turn.
  const pose = (t: number): PhrasePose => {
    if (t >= 1 && t < 2.5) return at({ gesture: { side: 'right', elevDeg: 90 * bump(t, 1, 2.5, 0.4), azDeg: 90 } })
    if (t >= 3.5 && t < 4.5) return at({ heelLift: 0.12 * bump(t, 3.5, 4.5, 0.2) })
    if (t >= 5.5 && t < 7) return at({ gesture: { side: 'left', elevDeg: 60 * bump(t, 5.5, 7, 0.4), azDeg: 180, kneeDeg: 40 } })
    if (t >= 7.5 && t < 9) return at({ trunkDeg: 80 * bump(t, 7.5, 9, 0.4) })
    if (t >= 9.5 && t < 10.5) return at({ plieDeg: 60 * bump(t, 9.5, 10.5, 0.3), turnoutDeg: 30 })
    if (t >= 11 && t < 12) return at({ yawDeg: 360 * Math.min(1, (t - 11) / 0.8) })
    return STAND
  }
  const series = phraseSeries(pose, 12.5)
  const events = detectEvents(series)
  const of = (k: string) => events.filter((e) => e.kind === k)

  it('finds both gestures with side, direction, height and knee', () => {
    const g = of('gesture')
    expect(g).toHaveLength(2)
    expect(g[0].values.side).toBe('right')
    expect(g[0].values.direction).toBe('side')
    expect(g[0].values.peak_elevation_deg).toBeCloseTo(90, 0)
    expect(g[0].values.level).toBe('hip or above')
    expect(g[0].values.working_knee_deg).toBeLessThan(1)
    expect(g[0].start).toBeGreaterThan(1)
    expect(g[0].end).toBeLessThan(2.5)
    expect(g[1].values.side).toBe('left')
    expect(g[1].values.direction).toBe('back')
    expect(g[1].values.peak_elevation_deg).toBeCloseTo(60, 0)
    expect(g[1].values.working_knee_deg).toBeCloseTo(40, 0)
  })

  it('finds the relevé, the fold, the plié and the turn, each once', () => {
    expect(of('releve')).toHaveLength(1)
    expect(of('releve')[0].start).toBeGreaterThan(3.5)
    expect(of('releve')[0].end).toBeLessThan(4.5)
    expect(of('tilt')).toHaveLength(1)
    expect(of('tilt')[0].values.direction).toBe('forward')
    expect(of('tilt')[0].values.peak_deg).toBeCloseTo(80, 0)
    expect(of('plie')).toHaveLength(1)
    expect(of('plie')[0].values.peak_knee_deg).toBeCloseTo(60, 0)
    expect(of('turn')).toHaveLength(1)
    expect(of('turn')[0].values.degrees).toBeGreaterThan(340)
  })

  it('a still dancer has no events', () => {
    expect(detectEvents(phraseSeries(() => STAND, 3))).toEqual([])
  })

  it('a gap is not filled: a gesture whose middle is untracked still has one start and end', () => {
    const s = phraseSeries(pose, 3)
    for (let i = 50; i < 55; i++) s.frames[i] = { t: s.frames[i].t, image: null, world: null }
    const g = detectEvents(s).filter((e) => e.kind === 'gesture')
    expect(g).toHaveLength(1)
  })

  it('survives tracker-like noise and the app smoothing (same events, values within a few degrees)', () => {
    for (const seed of [1, 2, 3]) {
      const noisy = smoothSeries(addTrackerNoise(series, { ...MEDIAPIPE_LIKE, swapRate: 0, dropoutRate: 0.005 }, seed))
      const g = detectEvents(noisy).filter((e) => e.kind === 'gesture')
      expect(g.map((e) => e.values.side)).toEqual(['right', 'left'])
      expect(Math.abs((g[0].values.peak_elevation_deg as number) - 90)).toBeLessThan(5)
    }
  })
})

describe('expressive measures', () => {
  it('signed knee deviation: inside > 0, outside < 0, on both legs and any yaw', () => {
    for (const yawDeg of [0, 45, 200]) {
      for (const dev of [12, -8, 0]) {
        const w = phraseLandmarks(at({ yawDeg, plieDeg: 60, turnoutDeg: 40, kneeDevDeg: dev }))
        expect(signedKneeDev(w, 'left')).toBeCloseTo(dev, 6)
        expect(signedKneeDev(w, 'right')).toBeCloseTo(dev, 6)
      }
    }
    // Straight knee: not measured.
    expect(signedKneeDev(phraseLandmarks(STAND), 'left')).toBe(null)
  })

  it('image knee offset has the same sign as the deviation in a front view', () => {
    const inside = frontImage(phraseLandmarks(at({ plieDeg: 60, turnoutDeg: 60, kneeDevDeg: 20 })))
    const over = frontImage(phraseLandmarks(at({ plieDeg: 60, turnoutDeg: 60, kneeDevDeg: 0 })))
    const outside = frontImage(phraseLandmarks(at({ plieDeg: 60, turnoutDeg: 60, kneeDevDeg: -20 })))
    for (const s of ['left', 'right'] as const) {
      const o = imageKneeOffset(over, s, 1) as number
      expect(imageKneeOffset(inside, s, 1) as number).toBeGreaterThan(o)
      expect(imageKneeOffset(outside, s, 1) as number).toBeLessThan(o)
    }
  })

  it('knee episodes report the plié deviation per leg', () => {
    const s = phraseSeries((t) => at({ plieDeg: 60 * bump(t, 1, 2.5, 0.3), turnoutDeg: 30, kneeDevDeg: 10 }), 3.5)
    const k = expressiveSummary(s).knee
    expect(k.map((e) => e.side)).toEqual(['left', 'right'])
    for (const e of k) expect(e.medianDeg).toBeCloseTo(10, 0)
  })

  it('head lead: head starts 0.3 s before the arms → positive latency; arms first → negative', () => {
    const make = (headAt: number, armAt: number) =>
      phraseSeries((t) => {
        const h = bump(t, headAt, headAt + 1.2, 0.4)
        const a = bump(t, armAt, armAt + 1.2, 0.4)
        return at({
          headFlexDeg: 35 * h,
          arms: { left: { dir: [0, 0.2 + a, -1 + 1.8 * a] }, right: { dir: [0, 0.2 + a, -1 + 1.8 * a] } },
        })
      }, 4)
    const lead = headLead(make(1, 1.3), 0.9)
    // Two movements (out and back), the head starting first in both.
    expect(lead.pairs).toHaveLength(2)
    for (const p of lead.pairs) expect(p.latencyS).toBeCloseTo(0.3, 1)
    expect(lead.headFirstShare).toBe(1)
    expect(lead.xcorrLagS).toBeGreaterThan(0.15)
    const lag = headLead(make(1.3, 1), 0.9)
    for (const p of lag.pairs) expect(p.latencyS).toBeCloseTo(-0.3, 1)
    expect(lag.headFirstShare).toBe(0)
  })

  it('head-trunk curve: folding the head to the chest is +, arching back is −, and the neck range follows', () => {
    const fold = headTrunk(phraseSeries(() => at({ headFlexDeg: 30, trunkDeg: 40 }), 0.2))
    expect(fold.curve[0]).toBeCloseTo(30, 6)
    const arch = headTrunk(phraseSeries(() => at({ headFlexDeg: -20 }), 0.2))
    expect(arch.curve[0]).toBeCloseTo(-20, 6)
    expect(arch.curveImage[0]).toBeCloseTo(0, 0) // front view: an arch towards the camera is invisible in the picture
    const s = phraseSeries((t) => at({ headFlexDeg: 40 * bump(t, 0.5, 2.5, 0.5) }), 3)
    const m = headMotion(s, headTrunk(s).neck, 0.9)
    expect(m.neckRangeDeg).toBeCloseTo(40, 0)
    const still = phraseSeries(() => STAND, 3)
    expect(headMotion(still, headTrunk(still).neck, 0.9).neckRangeDeg).toBeCloseTo(0, 6)
  })

  it('arm reach: straight arm to the side reads as extended for as long as it is held', () => {
    const s = phraseSeries((t) => (t >= 1 && t < 2 ? at({ arms: { left: { dir: [0, 1, 0] }, right: { dir: [0, 0.2, -1], bendDeg: 60 } } }) : at({ arms: { left: { dir: [0, 0.2, -1], bendDeg: 60 }, right: { dir: [0, 0.2, -1], bendDeg: 60 } } })), 3)
    const reach = armReach(s)
    expect(reach.left.longestExtendedS).toBeCloseTo(1, 1)
    expect(reach.right.extendedS).toBe(0)
    expect(reach.left.reachPeak as number).toBeGreaterThan(reach.right.reachPeak as number)
  })

  it('circles: a full arm circle in the frontal plane sweeps ~360° and closes; a half circle sweeps ~180° and does not', () => {
    const circle = (deg: number) =>
      phraseSeries((t) => {
        const a = (-90 + deg * Math.min(1, Math.max(0, (t - 0.5) / 2))) * (Math.PI / 180)
        return at({ arms: { left: { dir: [0, 0.2, -1] }, right: { dir: [0, Math.cos(a), Math.sin(a)] } } })
      }, 3)
    const full = circles(circle(360), bodySignals(circle(360))).filter((c) => c.limb === 'right_arm')
    expect(full).toHaveLength(1)
    expect(full[0].plane).toBe('frontal')
    expect(full[0].sweptDeg).toBeGreaterThan(350)
    expect(full[0].closure).toBeLessThan(0.05)
    const half = circles(circle(180), bodySignals(circle(180))).filter((c) => c.limb === 'right_arm')
    expect(half[0].sweptDeg).toBeGreaterThan(170)
    expect(half[0].sweptDeg).toBeLessThan(190)
    expect(half[0].closure).toBeGreaterThan(1.5)
  })
})

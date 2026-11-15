// Suggested attempt and phase boundaries, read from the heel-height and hip-height
// signals. These are only a starting point: the dancer confirms or moves every one.

import type { Attempt, PhaseId, PoseFrame, RecordingConditions, Seconds, SessionResults } from '../types'
import { RELEVE_THRESHOLD } from '../mock/metricsEngine'
import { PHASES } from './phases'

export interface Suggestion {
  attempt: Attempt
  /** Boundary indexes (see `boundaries()`) that were estimated rather than read from a signal. */
  estimated: number[]
}

/** Heel height (% shin) below which the heels count as down. */
const LIFT_EPS = 1.0
/** Fraction of the relevé plateau that counts as full height. */
const HOLD_LEVEL = 0.94
/** Hip drop (body heights) that counts as a plié. */
const PLIE_DROP = 0.005
const MIN_RUN: Seconds = 0.4
const BRIDGE: Seconds = 0.6
const PAD: Seconds = 0.5
const DEFAULT_PREP: Seconds = 1.4

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

function hipHeights(pose: PoseFrame[]): (number | null)[] {
  return pose.map((f) => (f.points && f.confidence >= 0.5 ? (f.points.leftHip[1] + f.points.rightHip[1]) / 2 : null))
}

/** Index runs where the heels are above the relevé threshold, bridging short tracking gaps. */
function releveRuns(values: (number | null)[], fps: number): [number, number][] {
  const runs: [number, number][] = []
  let start = -1
  let lastAbove = -1
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v !== null && v >= RELEVE_THRESHOLD) {
      if (start < 0) start = i
      lastAbove = i
    } else if (start >= 0) {
      // A gap (no value) only breaks the run once it lasts longer than BRIDGE.
      const gapOk = v === null && i - lastAbove <= BRIDGE * fps
      if (!gapOk) {
        runs.push([start, lastAbove])
        start = -1
      }
    }
  }
  if (start >= 0) runs.push([start, lastAbove])
  // Runs split by a long tracking gap are still one attempt if the heels never came down between them.
  const merged: [number, number][] = []
  for (const run of runs) {
    const prev = merged[merged.length - 1]
    const stayedUp = prev && values.slice(prev[1] + 1, run[0]).every((v) => v === null || v > LIFT_EPS)
    if (stayedUp) prev[1] = run[1]
    else merged.push([...run])
  }
  return merged.filter(([a, b]) => (b - a + 1) / fps >= MIN_RUN)
}

export function suggestAttempts(results: SessionResults, conditions: RecordingConditions = results.session.conditions): Suggestion[] {
  const { fps, duration } = results.session
  const heel = results.series.heelLift.map((s) => s.value)
  const hips = hipHeights(results.pose)
  const standing = median(hips.filter((h, i): h is number => h !== null && (heel[i] ?? 0) <= LIFT_EPS))
  const snap = (i: number) => Math.round(i) / fps

  const out: Suggestion[] = []
  let floor = 0
  for (const [r0, r1] of releveRuns(heel, fps)) {
    const plateau = median(heel.slice(r0, r1 + 1).filter((v): v is number => v !== null))
    let h0 = r0
    while (h0 < r1 && (heel[h0] ?? 0) < plateau * HOLD_LEVEL) h0++
    let h1 = r1
    while (h1 > h0 && (heel[h1] ?? plateau) < plateau * HOLD_LEVEL) h1--

    let rise = r0
    while (rise > 0 && (heel[rise - 1] === null || heel[rise - 1]! > LIFT_EPS)) rise--
    let lower = r1
    while (lower < heel.length - 1 && (heel[lower + 1] === null || heel[lower + 1]! > LIFT_EPS)) lower++

    const estimated: number[] = []
    let prep = rise
    while (prep > 0 && hips[prep - 1] !== null && hips[prep - 1]! < standing - PLIE_DROP) prep--
    // No hip dip before the rise (or no tracking there): fall back to a typical plié length.
    if ((rise - prep) / fps < 0.3) {
      prep = Math.max(0, rise - Math.round(DEFAULT_PREP * fps))
      estimated.push(1)
    }

    const start = Math.max(floor, snap(prep) - PAD)
    const end = Math.min(duration, snap(lower) + PAD)
    const cuts: Seconds[] = [snap(prep), snap(rise), snap(h0), snap(h1 + 1), snap(lower)]
    const phases = PHASES.map(({ id, label }, i) => ({ id: id as PhaseId, label, start: cuts[i], end: cuts[i + 1] }))
    const index = out.length + 1
    out.push({
      attempt: {
        id: `a${index}`,
        index,
        start: Math.round(start * fps) / fps,
        end: Math.round(end * fps) / fps,
        phases,
        context: { view: conditions.view, music: conditions.music, fatigue: conditions.fatigue },
      },
      estimated,
    })
    floor = end + 0.1
  }
  return out
}

export interface BoundaryProblem {
  attemptId: string
  message: string
}

/** The same checks the Attempt and Phase Manager runs on the server (Development Document 1.5). */
export function validateAttempts(attempts: Attempt[], duration: Seconds): BoundaryProblem[] {
  const problems: BoundaryProblem[] = []
  attempts.forEach((a, i) => {
    const say = (message: string) => problems.push({ attemptId: a.id, message: `Attempt ${a.index}: ${message}` })
    if (a.start < 0 || a.end > duration) say('runs past the clip.')
    if (a.phases.length !== PHASES.length) say('needs all four phases.')
    a.phases.forEach((p, k) => {
      if (p.end <= p.start) say(`${p.label} has no length.`)
      if (k > 0 && Math.abs(a.phases[k - 1].end - p.start) > 1e-6) say(`${p.label} doesn't start where ${a.phases[k - 1].label} ends.`)
    })
    if (a.phases[0] && a.phases[0].start < a.start) say('Plié starts before the attempt.')
    const last = a.phases[a.phases.length - 1]
    if (last && last.end > a.end) say('Lower ends after the attempt.')
    const next = attempts[i + 1]
    if (next && next.start < a.end) say(`overlaps attempt ${next.index}.`)
  })
  return problems
}

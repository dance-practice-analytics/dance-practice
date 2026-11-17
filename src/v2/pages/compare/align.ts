// How attempt B is lined up with attempt A in Compare. The clock runs on A's time; a
// TimeMap says where B is at each moment of A.
//
// Rule ("each phase"): every phase that both attempts have is stretched so that it
// starts and ends together in A and B; inside a phase, and in the stretches between
// matched phases, time runs evenly (piecewise linear). The n-th occurrence of a phase
// in A is matched with its n-th occurrence in B. So both dancers are always at the
// same share of the same phase.
//
// Fallback ("clip length"): without a phase in common there is nothing to line up, so
// the clips are matched by share of their length (start with start, end with end).

import type { Phase, PhaseSpan } from '../../../metrics/types'

export type AlignMode = 'phases' | 'proportional'

/** Why phase alignment is not available. */
export type NoPhaseReason = 'a_has_none' | 'b_has_none' | 'both_have_none' | 'none_in_common'

export interface ClipTiming {
  duration: number
  phases: readonly PhaseSpan[] | null | undefined
}

export interface TimeMap {
  /** The alignment in use ('events': phrase attempts lined up on matched events). */
  mode: AlignMode | 'events'
  /** Set when 'phases' was not possible (whatever was asked for). */
  unavailable: NoPhaseReason | null
  /** [time in A, time in B] pairs, strictly increasing in both. */
  anchors: readonly (readonly [number, number])[]
  /** Phases lined up, in order. */
  matched: Phase[]
  /** A's time → B's time. */
  toB(tA: number): number
  /** B's time → A's time. */
  toA(tB: number): number
  /** How fast B's time runs against A's at `tA` (1 = same speed). */
  slopeAt(tA: number): number
}

const MIN_GAP = 1e-3

function interpolate(anchors: readonly (readonly [number, number])[], x: number, from: 0 | 1): number {
  const to = from === 0 ? 1 : 0
  const first = anchors[0]
  const last = anchors[anchors.length - 1]
  if (x <= first[from]) return first[to]
  if (x >= last[from]) return last[to]
  for (let i = 1; i < anchors.length; i++) {
    const p = anchors[i - 1]
    const q = anchors[i]
    if (x <= q[from]) return p[to] + ((x - p[from]) / (q[from] - p[from])) * (q[to] - p[to])
  }
  return last[to]
}

function phaseReason(a: ClipTiming, b: ClipTiming): NoPhaseReason {
  const hasA = (a.phases?.length ?? 0) > 0
  const hasB = (b.phases?.length ?? 0) > 0
  return !hasA && !hasB ? 'both_have_none' : !hasA ? 'a_has_none' : !hasB ? 'b_has_none' : 'none_in_common'
}

/** The phase anchors of A and B: start and end of every phase both have, in A's order. */
function phaseAnchors(a: ClipTiming, b: ClipTiming): { anchors: [number, number][]; matched: Phase[] } {
  const seen = new Map<Phase, number>()
  const anchors: [number, number][] = []
  const matched: Phase[] = []
  const clampA = (t: number) => Math.min(a.duration, Math.max(0, t))
  const clampB = (t: number) => Math.min(b.duration, Math.max(0, t))
  for (const pa of a.phases ?? []) {
    const nth = seen.get(pa.phase) ?? 0
    seen.set(pa.phase, nth + 1)
    const pb = (b.phases ?? []).filter((p) => p.phase === pa.phase)[nth]
    if (!pb) continue
    let used = false
    for (const pair of [
      [clampA(pa.start), clampB(pb.start)],
      [clampA(pa.end), clampB(pb.end)],
    ] as [number, number][]) {
      const last = anchors[anchors.length - 1] ?? [0, 0]
      const dA = pair[0] - last[0]
      const dB = pair[1] - last[1]
      if (dA >= MIN_GAP && dB >= MIN_GAP) {
        anchors.push(pair)
        used = true
      } else if (Math.abs(dA) < MIN_GAP && Math.abs(dB) < MIN_GAP) {
        // The same point as the previous anchor (the clip start, or phases that touch).
        used = true
      }
      // Anything else would run one clip backwards or hold it still: left out.
    }
    if (used) matched.push(pa.phase)
  }
  return { anchors, matched }
}

/**
 * Builds the map between two attempts. `prefer: 'phases'` lines up the shared phases and
 * falls back to clip length when there are none; `'proportional'` always uses clip length.
 */
export function buildTimeMap(a: ClipTiming, b: ClipTiming, prefer: AlignMode = 'phases'): TimeMap {
  const durA = a.duration > 0 ? a.duration : 0
  const durB = b.duration > 0 ? b.duration : 0
  const { anchors: found, matched } = phaseAnchors({ ...a, duration: durA }, { ...b, duration: durB })
  const unavailable = matched.length ? null : phaseReason(a, b)
  const usePhases = prefer === 'phases' && matched.length > 0

  const anchors: [number, number][] = [[0, 0]]
  if (usePhases) {
    for (const p of found) {
      // An anchor on the very end is the end anchor itself.
      if (durA - p[0] >= MIN_GAP && durB - p[1] >= MIN_GAP) anchors.push(p)
    }
  }
  if (durA > 0 && durB > 0) anchors.push([durA, durB])

  const single = anchors.length < 2
  return {
    mode: usePhases ? 'phases' : 'proportional',
    unavailable,
    anchors,
    matched: usePhases ? matched : [],
    toB: (tA) => (single ? 0 : interpolate(anchors, tA, 0)),
    toA: (tB) => (single ? 0 : interpolate(anchors, tB, 1)),
    slopeAt(tA) {
      if (single) return 1
      for (let i = 1; i < anchors.length; i++) {
        const p = anchors[i - 1]
        const q = anchors[i]
        if (tA < q[0] || i === anchors.length - 1) return (q[1] - p[1]) / (q[0] - p[0])
      }
      return 1
    },
  }
}

/**
 * Phrase attempts: the map runs through the matched event peaks (src/metrics/phraseAlign.ts).
 * Before the first match and after the last, time runs at the same speed in both clips
 * (B waits at its start or end rather than being squeezed). `prefer: 'proportional'`, or
 * no matched event, falls back to clip length.
 */
export function buildEventTimeMap(durationA: number, durationB: number, matches: readonly (readonly [number, number])[], prefer: AlignMode = 'phases'): TimeMap {
  const durA = durationA > 0 ? durationA : 0
  const durB = durationB > 0 ? durationB : 0
  const inside: [number, number][] = []
  for (const [tA, tB] of matches) {
    if (!(tA > 0 && tB > 0 && tA < durA && tB < durB)) continue
    const last = inside[inside.length - 1]
    if (!last || (tA - last[0] >= MIN_GAP && tB - last[1] >= MIN_GAP)) inside.push([tA, tB])
  }
  if (prefer !== 'phases' || !inside.length) {
    const map = buildTimeMap({ duration: durA, phases: [] }, { duration: durB, phases: [] }, 'proportional')
    return { ...map, unavailable: inside.length ? null : 'none_in_common' }
  }
  const [fa, fb] = inside[0]
  const [la, lb] = inside[inside.length - 1]
  const head = Math.min(fa, fb)
  const tail = Math.min(durA - la, durB - lb)
  const anchors: [number, number][] = []
  if (head >= MIN_GAP) anchors.push([fa - head, fb - head])
  anchors.push(...inside)
  if (tail >= MIN_GAP) anchors.push([la + tail, lb + tail])
  const single = anchors.length < 2
  const one = anchors[0]
  return {
    mode: 'events',
    unavailable: null,
    anchors,
    matched: [],
    toB: (tA) => (single ? Math.max(0, Math.min(durB, tA - one[0] + one[1])) : interpolate(anchors, tA, 0)),
    toA: (tB) => (single ? Math.max(0, Math.min(durA, tB - one[1] + one[0])) : interpolate(anchors, tB, 1)),
    slopeAt(tA) {
      if (single || tA < anchors[0][0] || tA > anchors[anchors.length - 1][0]) return single ? 1 : 0
      for (let i = 1; i < anchors.length; i++) {
        const p = anchors[i - 1]
        const q = anchors[i]
        if (tA < q[0] || i === anchors.length - 1) return (q[1] - p[1]) / (q[0] - p[0])
      }
      return 1
    },
  }
}

/** The sentence under the Compare transport: which rule is lining the clips up, and why. */
export function alignmentText(map: TimeMap, asked: AlignMode): string {
  if (map.mode === 'events') {
    return 'Aligned event by event: the steps found in both attempts (leg gestures, folds, turns…) happen together; between them time runs evenly.'
  }
  if (map.mode === 'phases') {
    return 'Aligned phase by phase: each shared phase starts and ends together, so A and B are at the same point of the same phase.'
  }
  const rule = 'Matched by share of clip length: both clips start and end together.'
  if (asked === 'proportional' && !map.unavailable) return rule
  switch (map.unavailable) {
    case 'a_has_none':
      return `No phases were found in A, so the clips can’t be aligned by phase. ${rule}`
    case 'b_has_none':
      return `No phases were found in B, so the clips can’t be aligned by phase. ${rule}`
    case 'both_have_none':
      return `No phases were found in either attempt, so the clips can’t be aligned by phase. ${rule}`
    case 'none_in_common':
      return `A and B have no phase in common, so the clips can’t be aligned by phase. ${rule}`
    default:
      return rule
  }
}

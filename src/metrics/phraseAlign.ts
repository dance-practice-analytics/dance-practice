// Lines up two attempts of the same phrase by their events (Compare, FR-3.6.1).
//
// The dancer does the same sequence twice, but not at the same moment of the clip nor at
// the same speed. Events of A and B are matched in order (a weighted longest common
// subsequence): only events of the same kind can match, and a match is stronger when side,
// direction and size agree. A first pass on the distinctive events (leg gestures and turns)
// gives the typical offset between the clips; the second pass on every event discourages
// matches far from it, so one fold is not paired with a different fold. The matched peaks
// become the anchors of a piecewise-linear time map.
//
// The anchor pair is the matched main leg extension (the highest matched gesture).

import type { PhraseEventOut, PhraseResult } from './phrase'

export interface EventPair {
  /** Indices into a.events and b.events. */
  a: number
  b: number
  similarity: number
}

export interface PhraseAlignment {
  pairs: EventPair[]
  /** [time in A, time in B] at each matched peak, strictly increasing in both. */
  anchors: [number, number][]
  /** Median of tB − tA over the matches; null without a match. */
  offsetS: number | null
  /** The matched main leg extension; null when no gesture matched. */
  anchorPair: EventPair | null
}

/** A pair needs at least this similarity to count. */
export const MIN_SIMILARITY = 0.45
/** Offsets further than this from the typical one lose up to OFFSET_PENALTY of similarity. */
export const OFFSET_SCALE_S = 4
export const OFFSET_PENALTY = 0.5
/** Anchors closer than this (in either clip) are merged. */
const MIN_GAP_S = 0.05

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function close(a: number | null, b: number | null, within: number): boolean {
  return a !== null && b !== null && Math.abs(a - b) <= within
}

/** 0..1 likeness of two events; 0 when they can't be the same step. */
export function similarity(a: PhraseEventOut, b: PhraseEventOut): number {
  if (a.kind !== b.kind) return 0
  let s = 0.5
  switch (a.kind) {
    case 'gesture': {
      const sideKnown = !a.side_uncertain && !b.side_uncertain
      if (a.side === b.side) s += 0.2
      else if (sideKnown) return 0
      if (a.values.direction && a.values.direction === b.values.direction) s += 0.2
      if (close(num(a.values.peak_elevation_deg), num(b.values.peak_elevation_deg), 20)) s += 0.1
      break
    }
    case 'tilt':
      if (a.values.direction && a.values.direction === b.values.direction) s += 0.3
      if (close(num(a.values.peak_deg), num(b.values.peak_deg), 20)) s += 0.2
      break
    case 'turn': {
      if (a.values.direction === b.values.direction) s += 0.2
      const da = num(a.values.degrees)
      const db = num(b.values.degrees)
      if (da !== null && db !== null && Math.min(da, db) / Math.max(da, db) >= 0.5) s += 0.3
      break
    }
    default:
      // Relevés and pliés look alike; they match on order and timing only.
      s += 0.1
  }
  return Math.min(1, s)
}

/** Weighted LCS: the in-order set of pairs with the largest total similarity. */
function match(a: readonly PhraseEventOut[], b: readonly PhraseEventOut[], score: (i: number, j: number) => number): EventPair[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = score(i, j)
      dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1], s >= MIN_SIMILARITY ? s + dp[i + 1][j + 1] : -Infinity)
    }
  }
  const out: EventPair[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    const s = score(i, j)
    if (s >= MIN_SIMILARITY && dp[i][j] === s + dp[i + 1][j + 1]) {
      out.push({ a: i, b: j, similarity: Math.round(s * 100) / 100 })
      i++
      j++
    } else if (dp[i][j] === dp[i + 1][j]) i++
    else j++
  }
  return out
}

function medianOf(v: number[]): number | null {
  if (!v.length) return null
  const s = [...v].sort((x, y) => x - y)
  const k = s.length >> 1
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2
}

const byPeak = (e: readonly PhraseEventOut[]) => e.map((x, i) => ({ x, i })).sort((p, q) => p.x.peak - q.x.peak)

export function alignPhrases(a: Pick<PhraseResult, 'events'>, b: Pick<PhraseResult, 'events'>): PhraseAlignment {
  const sa = byPeak(a.events)
  const sb = byPeak(b.events)
  const ea = sa.map((p) => p.x)
  const eb = sb.map((p) => p.x)

  // Pass 1: the distinctive events give the typical offset.
  const strong = (e: PhraseEventOut) => e.kind === 'gesture' || e.kind === 'turn'
  const first = match(ea, eb, (i, j) => (strong(ea[i]) && strong(eb[j]) ? similarity(ea[i], eb[j]) : 0))
  const guess = medianOf(first.map((p) => eb[p.b].peak - ea[p.a].peak))

  // Pass 2: every event, discouraged far from the typical offset.
  const pairsSorted = match(ea, eb, (i, j) => {
    const s = similarity(ea[i], eb[j])
    if (!s || guess === null) return s
    const off = Math.abs(eb[j].peak - ea[i].peak - guess)
    return s - Math.min(OFFSET_PENALTY, (off / OFFSET_SCALE_S) * OFFSET_PENALTY)
  })
  const pairs = pairsSorted.map((p) => ({ a: sa[p.a].i, b: sb[p.b].i, similarity: p.similarity }))

  const anchors: [number, number][] = []
  for (const p of pairs) {
    const tA = a.events[p.a].peak
    const tB = b.events[p.b].peak
    const last = anchors[anchors.length - 1]
    if (!last || (tA - last[0] >= MIN_GAP_S && tB - last[1] >= MIN_GAP_S)) anchors.push([tA, tB])
  }

  let anchorPair: EventPair | null = null
  for (const p of pairs) {
    const ga = a.events[p.a]
    const gb = b.events[p.b]
    if (ga.kind !== 'gesture') continue
    const h = Math.min(num(ga.values.peak_elevation_deg) ?? 0, num(gb.values.peak_elevation_deg) ?? 0)
    const best = anchorPair ? Math.min(num(a.events[anchorPair.a].values.peak_elevation_deg) ?? 0, num(b.events[anchorPair.b].values.peak_elevation_deg) ?? 0) : -1
    if (h > best) anchorPair = p
  }

  return { pairs, anchors, offsetS: medianOf(pairs.map((p) => b.events[p.b].peak - a.events[p.a].peak)), anchorPair }
}

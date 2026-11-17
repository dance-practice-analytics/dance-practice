// One take, several cameras (FR-3.5, FR-3.6).
//
// The study films every attempt with three cameras at once (front, side, diagonal), and
// a dancer can do the same with phones. Each camera's clip is its own attempt in its own
// session (a session has one camera position, `sessions.camera_view`). The clips of one
// take are linked by what they already share, so no extra column is needed:
//
//   same subject · same movement · same recording date · same take number (clip_number)
//
// and a different camera position. Import fills these from `D01_att3_f`-style names and
// lets the dancer type the same take number on clips of one take (`import/model.ts`).
// Pure logic, no DOM, no network: unit-tested in takes.test.ts.

import { CAMERA_VIEWS, type CameraView, type MovementType } from '../../../data/schema'

/** The fields of an attempt (AttemptView) the link reads. */
export interface TakeMember {
  id: string
  clip_number: number | null
  status: string
  created_at: string
  session: {
    subject_id: string | null
    movement_type: MovementType
    recorded_on: string | null
    camera_view: CameraView | null
  }
}

/**
 * The key shared by every camera of one take, or null when the attempt can't be linked:
 * no take number, no recording date or no camera position.
 */
export function takeKey(a: TakeMember): string | null {
  const s = a.session
  if (a.clip_number === null || !s.recorded_on || !s.camera_view) return null
  return [s.subject_id ?? '-', s.movement_type, s.recorded_on, a.clip_number].join('|')
}

export type TakeViews<T> = Record<CameraView, T | null>

/**
 * The attempt shown for each camera of `attempt`'s take. The attempt itself always holds
 * its own camera; for the others a processed attempt comes before one that isn't, then the
 * newest. A camera nobody filmed is null.
 */
export function viewsOfTake<T extends TakeMember>(attempt: T, all: readonly T[]): TakeViews<T> {
  const out: TakeViews<T> = { front: null, side: null, diagonal: null }
  const own = attempt.session.camera_view
  if (own) out[own] = attempt
  const key = takeKey(attempt)
  if (key === null) return out
  for (const view of CAMERA_VIEWS) {
    if (view === own) continue
    const candidates = all.filter((x) => x.id !== attempt.id && x.session.camera_view === view && takeKey(x) === key)
    out[view] = pickOne(candidates)
  }
  return out
}

function pickOne<T extends TakeMember>(list: readonly T[]): T | null {
  if (list.length === 0) return null
  return [...list].sort((x, y) => {
    const dx = x.status === 'done' ? 0 : 1
    const dy = y.status === 'done' ? 0 : 1
    return dx - dy || y.created_at.localeCompare(x.created_at)
  })[0]
}

/** How many cameras filmed this take (1 when it isn't linked). */
export function cameraCount(views: TakeViews<unknown>): number {
  return CAMERA_VIEWS.filter((v) => views[v] !== null).length
}

/** Cameras both A and B of a comparison have, with the attempts to switch to. */
export function sharedViews<T extends TakeMember>(a: T, b: T, all: readonly T[]): Record<CameraView, { a: T; b: T } | null> {
  const va = viewsOfTake(a, all)
  const vb = viewsOfTake(b, all)
  const out: Record<CameraView, { a: T; b: T } | null> = { front: null, side: null, diagonal: null }
  for (const v of CAMERA_VIEWS) {
    const x = va[v]
    const y = vb[v]
    out[v] = x && y && x.id !== y.id ? { a: x, b: y } : null
  }
  return out
}

// ---------- the playhead across a switch ----------

/**
 * The clips of one take start together (trimmed to the same start in the study, synced on
 * the sound), so the moment carries over as the same time. The page of the next camera
 * reads it once when its clock is ready.
 */
export interface Handoff {
  time: number
  playing: boolean
  rate: number
  /** The attempt (Review) or the pair (Compare, `a:b`) the handoff is for. */
  target: string
}

let pending: Handoff | null = null

export function handOff(h: Handoff): void {
  pending = h
}

/** The handoff for `target`, once; anything else is dropped. */
export function takeHandoff(target: string): Handoff | null {
  const h = pending
  pending = null
  return h && h.target === target ? h : null
}

/** A time inside a clip of `duration` seconds (a camera may have stopped a little earlier). */
export function clampTime(t: number, duration: number): number {
  if (!Number.isFinite(t) || t < 0) return 0
  return duration > 0 ? Math.min(t, duration) : t
}

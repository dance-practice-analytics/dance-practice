// Which two attempts Compare shows. The URL (`#/compare?a=..&b=..`) holds the choice;
// what is missing or no longer valid is filled in. Pure.
//
// Without a reference attempt: A is the latest processed attempt, B is A's neighbour in
// the same session. FR-3.6.6: when the dancer marked a reference attempt, A defaults to
// it and B to the latest other attempt of the same movement and subject, so "compare
// with my reference" is the first view. A reference is a point of comparison, not a grade.

import { neighbourInSession } from '../review/labels'

export interface Pickable {
  id: string
  session_id: string
  number: number
  status: string
  created_at: string
  /** FR-3.6.6; absent = not a reference. */
  is_reference?: boolean
  /** Movement and subject: a reference only stands for attempts of its own group. */
  session?: { movement_type: string; subject_code: string | null }
}

export interface Pair {
  a: string | null
  b: string | null
}

const groupOf = (p: Pickable) => (p.session ? `${p.session.movement_type}|${p.session.subject_code ?? ''}` : null)

const latest = <T extends Pickable>(list: readonly T[]): T | null =>
  list.reduce<T | null>((best, p) => (!best || p.created_at > best.created_at ? p : best), null)

/** The reference attempt of `p`'s movement and subject, if there is one. */
export function referenceFor<T extends Pickable>(p: Pickable, processed: readonly T[]): T | null {
  const g = groupOf(p)
  if (g === null) return null
  return processed.find((x) => x.is_reference && groupOf(x) === g) ?? null
}

/** `processed` = the account's attempts with status 'done'. */
export function choosePair(processed: readonly Pickable[], wantA?: string | null, wantB?: string | null): Pair {
  const byId = new Map(processed.map((p) => [p.id, p]))
  let b = wantB ? (byId.get(wantB) ?? null) : null
  let a = wantA ? (byId.get(wantA) ?? null) : null
  if (!a) {
    if (b) {
      // Only B given: A is B's reference, else B's neighbour.
      const ref = referenceFor(b, processed)
      a = ref && ref.id !== b.id ? ref : neighbourInSession(b, processed)
    } else {
      // Nothing given: the reference of the latest attempt's group, else the latest attempt.
      const last = latest(processed)
      const ref = last ? referenceFor(last, processed) : null
      if (ref) {
        a = ref
        const g = groupOf(ref)
        b = latest(processed.filter((p) => p.id !== ref.id && groupOf(p) === g))
      }
    }
    if (!a) a = latest(processed.filter((p) => p.id !== b?.id))
  }
  if (!a) return { a: null, b: b?.id ?? null }
  if (!b || b.id === a.id) b = neighbourInSession(a, processed)
  return { a: a.id, b: b?.id ?? null }
}

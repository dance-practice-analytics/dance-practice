// Which two attempts Compare shows. The URL (`#/compare?a=..&b=..`) holds the choice;
// what is missing or no longer valid is filled in: A is the latest processed attempt,
// B is A's neighbour in the same session. Pure.

import { neighbourInSession } from '../review/labels'

export interface Pickable {
  id: string
  session_id: string
  number: number
  status: string
  created_at: string
}

export interface Pair {
  a: string | null
  b: string | null
}

/** `processed` = the account's attempts with status 'done'. */
export function choosePair(processed: readonly Pickable[], wantA?: string | null, wantB?: string | null): Pair {
  const byId = new Map(processed.map((p) => [p.id, p]))
  let b = wantB ? (byId.get(wantB) ?? null) : null
  let a = wantA ? (byId.get(wantA) ?? null) : null
  if (!a) {
    // Only B given: A is B's neighbour; nothing given: the latest processed attempt.
    a = b ? neighbourInSession(b, processed) : null
    if (!a) {
      for (const p of processed) if (p.id !== b?.id && (!a || p.created_at > a.created_at)) a = p
    }
  }
  if (!a) return { a: null, b: b?.id ?? null }
  if (!b || b.id === a.id) b = neighbourInSession(a, processed)
  return { a: a.id, b: b?.id ?? null }
}

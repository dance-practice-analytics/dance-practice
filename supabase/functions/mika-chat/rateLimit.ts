// Rate limit of Mika: RATE_LIMIT_MAX questions per user per sliding hour.
//
// Limitation: the count lives in the memory of one function instance. No table fits it
// (the feedback table only holds practice notes) and the schema is not changed for the
// prototype, so a cold start resets the count and two instances count separately. It
// caps a runaway client or a held-down Enter key; it is not a hard quota. A hard quota
// would need a table (e.g. chat_requests(owner_id, created_at) with owner-only RLS),
// counted the way generate-feedback counts its rows.

// @ts-ignore TS5097: Deno needs the .ts extension
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from './contract.ts'

export type RateDecision = { allowed: true; remaining: number } | { allowed: false; retryAfterS: number }

export interface RateLimiter {
  /** Counts the request when it is allowed. */
  take(userId: string, nowMs: number): RateDecision
}

export function createRateLimiter(max = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW_MS): RateLimiter {
  const hits = new Map<string, number[]>()
  return {
    take(userId, nowMs) {
      const recent = (hits.get(userId) ?? []).filter((t) => t > nowMs - windowMs)
      // Users with nothing left in the window are forgotten, so the map stays small.
      for (const [id, times] of hits) if (id !== userId && times[times.length - 1] <= nowMs - windowMs) hits.delete(id)
      if (recent.length >= max) {
        hits.set(userId, recent)
        const freesAt = recent[recent.length - max] + windowMs
        return { allowed: false, retryAfterS: Math.max(1, Math.ceil((freesAt - nowMs) / 1000)) }
      }
      recent.push(nowMs)
      hits.set(userId, recent)
      return { allowed: true, remaining: max - recent.length }
    },
  }
}

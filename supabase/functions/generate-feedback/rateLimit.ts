// Rate-limit decision (FR-3.7.9, SDD 5.6): at most `max` notes per user in a sliding
// window, counted from the created_at of the user's feedback rows.

// @ts-ignore TS5097: Deno needs the .ts extension
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from './contract.ts'

export type RateDecision = { allowed: true; remaining: number } | { allowed: false; retryAfterS: number }

/** Start of the window as an ISO string, for the query that loads the rows. */
export function windowStart(nowMs: number, windowMs = RATE_LIMIT_WINDOW_MS): string {
  return new Date(nowMs - windowMs).toISOString()
}

/**
 * `createdAt` are the timestamps of the user's recent feedback rows, in any order; rows
 * outside the window and unparseable values are ignored.
 */
export function decideRateLimit(
  createdAt: readonly string[],
  nowMs: number,
  max = RATE_LIMIT_MAX,
  windowMs = RATE_LIMIT_WINDOW_MS,
): RateDecision {
  const inWindow = createdAt
    .map((t) => Date.parse(t))
    .filter((t) => Number.isFinite(t) && t > nowMs - windowMs)
    .sort((a, b) => a - b)
  if (inWindow.length < max) return { allowed: true, remaining: max - inWindow.length }
  // A slot opens when enough of the oldest rows leave the window to get below the limit.
  const freesAt = inWindow[inWindow.length - max] + windowMs
  return { allowed: false, retryAfterS: Math.max(1, Math.ceil((freesAt - nowMs) / 1000)) }
}

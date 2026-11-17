// Request flow of mika-chat with every side effect behind `Deps`, so it runs under a test
// with a mocked database and a mocked model. index.ts supplies the real Supabase queries
// (with the caller's JWT, so RLS applies) and the Claude call.
//
// GET  → { ready } : whether the function has its API key. No model call, no data read.
// POST → { reply } : one answer from Mika about the caller's own measurements.

import {
  MIKA_FAILURES,
  MAX_SESSION_ATTEMPTS,
  mikaErrorBody,
  type ChatMessage,
  type MikaErrorBody,
  type MikaFailureCode,
  type MikaReply,
  type MikaStatus,
  // @ts-ignore TS5097: Deno needs the .ts extension
} from './contract.ts'
// @ts-ignore TS5097: Deno needs the .ts extension
import { buildMikaContext, type AttemptInput } from './context.ts'
// @ts-ignore TS5097: Deno needs the .ts extension
import { isMovement, type MetricsRowLike } from '../generate-feedback/payload.ts'
// @ts-ignore TS5097: Deno needs the .ts extension
import { buildSystem } from './prompt.ts'
// @ts-ignore TS5097: Deno needs the .ts extension
import type { RateDecision } from './rateLimit.ts'
// @ts-ignore TS5097: Deno needs the .ts extension
import { parseMikaRequest } from './validate.ts'

/** The parts of a Messages API response the function reads. */
export interface ModelMessage {
  stop_reason: string | null
  model: string
  content: readonly { type: string; text?: string }[]
}

export type ModelOutcome = { ok: true; text: string; model: string } | { ok: false; code: MikaFailureCode; retryAfterS?: number }

/** stop_reason is checked before the content is read: a refusal or a cut-off is never shown. */
export function interpretMessage(message: ModelMessage): ModelOutcome {
  if (message.stop_reason === 'refusal') return { ok: false, code: 'model_refused' }
  if (message.stop_reason === 'max_tokens') return { ok: false, code: 'model_truncated' }
  if (message.stop_reason !== 'end_turn' && message.stop_reason !== 'stop_sequence') return { ok: false, code: 'model_invalid_output' }
  const text = message.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim()
  if (text.length === 0) return { ok: false, code: 'model_invalid_output' }
  return { ok: true, text, model: message.model }
}

export type MetricsRow = MetricsRowLike & { attempt_id: string }

/** Every database method runs as the caller, so RLS decides what is visible. */
export interface Deps {
  /** The signed-in user's id, or null when the JWT is missing or invalid. */
  userId(): Promise<string | null>
  /** False when ANTHROPIC_API_KEY is not set. */
  hasApiKey(): boolean
  hasAiConsent(): Promise<boolean>
  /** attempt_metrics rows visible to the caller, for these attempt ids. */
  loadMetrics(attemptIds: string[]): Promise<MetricsRow[]>
  /** Ids of the attempts in the same session as `attemptId`, oldest first (created_at). */
  sessionAttemptIds(attemptId: string): Promise<string[]>
  /** Counts the request toward the caller's hourly limit. */
  rateLimit(userId: string, nowMs: number): RateDecision
  callModel(system: { type: 'text'; text: string }[], messages: ChatMessage[]): Promise<ModelOutcome>
  now(): number
  /** Receives a failure code and a short reason; never the question, the data or the answer. */
  log?(code: MikaFailureCode, detail?: string): void
}

export interface HandlerResult {
  status: number
  body: MikaReply | MikaStatus | MikaErrorBody
  retryAfterS?: number
}

export async function handleMika(method: string, body: unknown, deps: Deps): Promise<HandlerResult> {
  const failure = (code: MikaFailureCode, detail?: string, retryAfterS?: number): HandlerResult => {
    deps.log?.(code, detail)
    const result: HandlerResult = { status: MIKA_FAILURES[code].status, body: mikaErrorBody(code, retryAfterS) }
    if (retryAfterS !== undefined) result.retryAfterS = retryAfterS
    return result
  }

  try {
    if (method !== 'POST' && method !== 'GET') return failure('method_not_allowed')
    const uid = await deps.userId()
    if (!uid) return failure('unauthorized')
    if (method === 'GET') return { status: 200, body: { ready: deps.hasApiKey() } }

    const parsed = parseMikaRequest(body)
    if (!parsed.ok) return failure(parsed.code)
    const { attemptId, compareAttemptId, scope, messages } = parsed.value

    if (!deps.hasApiKey()) return failure('not_connected')
    if (!(await deps.hasAiConsent())) return failure('consent_required')

    // Attempt numbers ("Attempt 3") match the app: position in the session by created_at.
    let order: string[] = []
    try {
      order = await deps.sessionAttemptIds(attemptId)
    } catch {
      order = []
    }
    const numberOf = (id: string) => {
      const i = order.findIndex((o) => o.toLowerCase() === id.toLowerCase())
      return i < 0 ? undefined : i + 1
    }

    const sessionIds =
      scope === 'session' ? order.filter((id) => id.toLowerCase() !== attemptId.toLowerCase()).slice(-MAX_SESSION_ATTEMPTS + 1) : []
    const wanted = [attemptId, ...(compareAttemptId ? [compareAttemptId] : []), ...sessionIds]
    const rows = await deps.loadMetrics(wanted)
    const rowFor = (id: string) => rows.find((r) => r.attempt_id.toLowerCase() === id.toLowerCase()) ?? null

    const target = rowFor(attemptId)
    if (!target) return failure('attempt_not_found')
    if (!isMovement(target.movement)) return failure('invalid_request', 'unknown movement')

    let compare: AttemptInput | null = null
    if (compareAttemptId) {
      const row = rowFor(compareAttemptId)
      if (!row) return failure('attempt_not_found', 'comparison')
      if (row.movement !== target.movement) return failure('invalid_request', 'comparison movement')
      compare = { row, number: numberOf(compareAttemptId) }
    }
    const session: AttemptInput[] = sessionIds.flatMap((id) => {
      const row = rowFor(id)
      return row ? [{ row, number: numberOf(id) }] : []
    })

    const context = buildMikaContext({ row: target, number: numberOf(attemptId) }, compare, session)

    const rate = deps.rateLimit(uid, deps.now())
    if (!rate.allowed) return failure('rate_limited', undefined, rate.retryAfterS)

    const outcome = await deps.callModel(buildSystem(context), messages)
    if (!outcome.ok) return failure(outcome.code, undefined, outcome.retryAfterS)
    return { status: 200, body: { reply: outcome.text, model: outcome.model } }
  } catch (e) {
    return failure('internal', e instanceof Error ? e.name : 'unknown')
  }
}

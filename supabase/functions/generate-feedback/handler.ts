// Request flow of generate-feedback (SDD 5.6) with every side effect behind `Deps`, so it
// runs under a test with a mocked database and a mocked model. index.ts supplies the real
// Supabase queries (with the caller's JWT) and the model call (_shared/llm.ts).

// @ts-ignore TS5097: Deno needs the .ts extension
import { LlmError, type LlmCompletion } from '../_shared/llm.ts'
import {
  FAILURES,
  errorBody,
  isFeedbackResponse,
  type FailureCode,
  type FeedbackErrorBody,
  type FeedbackResponse,
  type GenerateFeedbackResult,
  // @ts-ignore TS5097: Deno needs the .ts extension
} from './contract.ts'
// @ts-ignore TS5097: Deno needs the .ts extension
import { inputHash } from './hash.ts'
// @ts-ignore TS5097: Deno needs the .ts extension
import { buildPayload, hasMeasurements, isMovement, type FeedbackPayload, type MetricsRowLike } from './payload.ts'
// @ts-ignore TS5097: Deno needs the .ts extension
import { PROMPT_VERSION } from './prompt.ts'
// @ts-ignore TS5097: Deno needs the .ts extension
import { decideRateLimit, windowStart } from './rateLimit.ts'
// @ts-ignore TS5097: Deno needs the .ts extension
import { parseFeedback } from './validate.ts'

export type ModelOutcome = { ok: true; text: string; model: string } | { ok: false; code: FailureCode; retryAfterS?: number }

/** A ```json fence some models put around JSON despite the instructions. */
function stripJsonFence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/i.exec(text)
  return m ? m[1] : text
}

/** finish_reason is checked before the content is read: a refusal or a cut-off is never parsed. */
export function interpretCompletion(completion: LlmCompletion): ModelOutcome {
  if (completion.finishReason === 'content_filter') return { ok: false, code: 'model_refused' }
  if (completion.finishReason === 'length') return { ok: false, code: 'model_truncated' }
  if (completion.finishReason !== 'stop') return { ok: false, code: 'model_invalid_output' }
  const text = stripJsonFence(completion.text).trim()
  if (text.length === 0) return { ok: false, code: 'model_invalid_output' }
  return { ok: true, text, model: completion.model }
}

/** A failed model call → its failure code. Anything that is not an LlmError is a bug and is rethrown. */
export function outcomeFromError(e: unknown): ModelOutcome {
  if (!(e instanceof LlmError)) throw e
  switch (e.kind) {
    case 'not_configured':
    case 'auth':
      return { ok: false, code: 'not_configured' }
    case 'rate_limited':
    case 'unavailable':
      return e.retryAfterS !== undefined ? { ok: false, code: 'upstream_busy', retryAfterS: e.retryAfterS } : { ok: false, code: 'upstream_busy' }
    case 'timeout':
      return { ok: false, code: 'upstream_timeout' }
    case 'bad_response':
      return { ok: false, code: 'model_invalid_output' }
    default:
      return { ok: false, code: 'upstream_error' }
  }
}

export interface StoredFeedback {
  id: string
  attempt_id: string
  model: string
  prompt_version: string
  created_at: string
  response: unknown
}

export interface NewFeedback {
  attempt_id: string
  model: string
  prompt_version: string
  input_hash: string
  response: FeedbackResponse
}

/** Every database method runs as the caller, so RLS decides what is visible. */
export interface Deps {
  /** The configured model id (LLM_MODEL). Part of the cache key and stored with the note. */
  model: string
  /** The signed-in user's id, or null when the JWT is missing or invalid. */
  userId(): Promise<string | null>
  hasAiConsent(): Promise<boolean>
  /** null when the attempt has no metrics row visible to the caller. */
  loadMetrics(attemptId: string): Promise<MetricsRowLike | null>
  /** Metrics of earlier attempts in the same session, newest first. */
  loadEarlierMetrics(attemptId: string): Promise<MetricsRowLike[]>
  findCached(attemptId: string, hash: string): Promise<StoredFeedback | null>
  /** created_at of the caller's feedback rows since `sinceIso`. */
  recentFeedbackTimes(sinceIso: string): Promise<string[]>
  callModel(payload: FeedbackPayload): Promise<ModelOutcome>
  saveFeedback(row: NewFeedback): Promise<{ id: string; created_at: string } | null>
  now(): number
  /** Receives a failure code and a short reason; never the payload or the notes. */
  log?(code: FailureCode, detail?: string): void
}

export interface HandlerResult {
  status: number
  body: GenerateFeedbackResult | FeedbackErrorBody
  retryAfterS?: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Returns the attempt id and the regenerate flag, or null when the body is not valid. */
export function parseRequest(body: unknown): { attemptId: string; regenerate: boolean } | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  if (typeof b.attempt_id !== 'string' || !UUID_RE.test(b.attempt_id)) return null
  if (b.regenerate !== undefined && typeof b.regenerate !== 'boolean') return null
  return { attemptId: b.attempt_id, regenerate: b.regenerate === true }
}

export async function handleGenerate(method: string, body: unknown, deps: Deps): Promise<HandlerResult> {
  const failure = (code: FailureCode, detail?: string, retryAfterS?: number): HandlerResult => {
    deps.log?.(code, detail)
    const result: HandlerResult = { status: FAILURES[code].status, body: errorBody(code, retryAfterS) }
    if (retryAfterS !== undefined) result.retryAfterS = retryAfterS
    return result
  }

  try {
    if (method !== 'POST') return failure('method_not_allowed')
    if (!(await deps.userId())) return failure('unauthorized')
    const request = parseRequest(body)
    if (!request) return failure('invalid_request')
    const { attemptId } = request

    if (!(await deps.hasAiConsent())) return failure('consent_required')

    const row = await deps.loadMetrics(attemptId)
    if (!row) return failure('attempt_not_found')
    if (!isMovement(row.movement)) return failure('invalid_request', 'unknown movement')

    const payload = buildPayload(row, await deps.loadEarlierMetrics(attemptId))
    if (!hasMeasurements(payload)) return failure('nothing_measured')

    const hash = await inputHash(payload, PROMPT_VERSION, deps.model)
    if (!request.regenerate) {
      const cached = await deps.findCached(attemptId, hash)
      if (cached && isFeedbackResponse(cached.response)) {
        return {
          status: 200,
          body: {
            id: cached.id,
            attempt_id: cached.attempt_id,
            model: cached.model,
            prompt_version: cached.prompt_version,
            created_at: cached.created_at,
            cached: true,
            response: cached.response,
          },
        }
      }
    }

    const now = deps.now()
    const rate = decideRateLimit(await deps.recentFeedbackTimes(windowStart(now)), now)
    if (!rate.allowed) return failure('rate_limited', undefined, rate.retryAfterS)

    const outcome = await deps.callModel(payload)
    if (!outcome.ok) return failure(outcome.code, undefined, outcome.retryAfterS)

    const parsed = parseFeedback(outcome.text, payload)
    if (!parsed.ok) return failure('model_invalid_output', parsed.reason)

    const saved = await deps.saveFeedback({
      attempt_id: attemptId,
      model: outcome.model,
      prompt_version: PROMPT_VERSION,
      input_hash: hash,
      response: parsed.value,
    })
    if (!saved) return failure('storage_failed')

    return {
      status: 200,
      body: {
        id: saved.id,
        attempt_id: attemptId,
        model: outcome.model,
        prompt_version: PROMPT_VERSION,
        created_at: saved.created_at,
        cached: false,
        response: parsed.value,
      },
    }
  } catch (e) {
    return failure('internal', e instanceof Error ? e.name : 'unknown')
  }
}

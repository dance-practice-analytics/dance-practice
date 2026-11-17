// AI practice notes (FR-3.7.x): calls the Edge Function generate-feedback and reads the
// stored notes. Only the contract (types and copy) is imported from the function folder;
// none of its Deno code reaches the browser bundle.

import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  type SupabaseClient,
} from '@supabase/supabase-js'
import { ApiError } from '../api/errors'
import {
  FAILURES,
  FUNCTION_NAME,
  isFeedbackResponse,
  noteLanguage,
  retryHint,
  type FailureCode,
  type FeedbackResponse,
  type GenerateFeedbackRequest,
  type GenerateFeedbackResult,
} from '../../supabase/functions/generate-feedback/contract'

export type {
  FeedbackObservation,
  FeedbackResponse,
  GenerateFeedbackResult,
} from '../../supabase/functions/generate-feedback/contract'
export { AI_CONSENT_SCOPE, DISCLAIMER } from '../../supabase/functions/generate-feedback/contract'

/** `code` is a FailureCode of the function, or 'offline'. */
export class FeedbackError extends ApiError {
  /** Seconds until a retry can work, when the server said so (rate limit). */
  retryAfterS?: number
  constructor(status: number, code: string, message: string, recovery?: string, retryAfterS?: number) {
    super(status, code, message, recovery)
    this.retryAfterS = retryAfterS
  }
}

/** A stored note with the data needed to show where it came from. */
export interface FeedbackNote {
  id: string
  attemptId: string
  model: string
  promptVersion: string
  createdAt: string
  response: FeedbackResponse
}

const OFFLINE = new FeedbackError(
  0,
  'offline',
  'You’re offline, so the notes can’t be written right now.',
  'Reconnect and try again. Your video and measurements are still here.',
)

function known(code: unknown): code is FailureCode {
  return typeof code === 'string' && code in FAILURES
}

/** Turns the function's error body (or its absence) into a dancer-safe error. */
export function feedbackError(status: number, body: unknown): FeedbackError {
  const error = typeof body === 'object' && body !== null ? (body as { error?: Record<string, unknown> }).error : undefined
  const retryAfterS = typeof error?.retry_after_s === 'number' && error.retry_after_s > 0 ? error.retry_after_s : undefined
  if (known(error?.code)) {
    // The copy comes from the shared table, not from the response, so it is always safe to show.
    const f = FAILURES[error.code]
    const recovery = error.code === 'rate_limited' && retryAfterS ? retryHint(retryAfterS) : f.recovery
    return new FeedbackError(status || f.status, error.code, f.message, recovery, retryAfterS)
  }
  // No body of ours: the platform answered (gateway auth, cold-start failure, missing function).
  if (status === 401 || status === 403) return fromCode('unauthorized', status)
  if (status === 429) return fromCode('upstream_busy', status)
  if (status === 504 || status === 546) return fromCode('upstream_timeout', status)
  return fromCode('upstream_error', status)
}

function fromCode(code: FailureCode, status?: number): FeedbackError {
  const f = FAILURES[code]
  return new FeedbackError(status || f.status, code, f.message, f.recovery)
}

async function invokeError(e: unknown): Promise<FeedbackError> {
  if (e instanceof FeedbackError) return e
  if (e instanceof FunctionsHttpError) {
    const res = e.context as Response
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    return feedbackError(res.status, body)
  }
  if (e instanceof FunctionsRelayError) return fromCode('upstream_error')
  if (e instanceof FunctionsFetchError) {
    return typeof navigator !== 'undefined' && navigator.onLine === false ? OFFLINE : fromCode('upstream_error', 0)
  }
  return fromCode('internal')
}

/**
 * Asks for practice notes about one attempt. The same measurements give the stored note
 * back without a new model call; `regenerate` asks again (counts toward the hourly limit).
 * Throws FeedbackError (an ApiError) with a message that is safe to show.
 */
export async function generateFeedbackNote(
  supabase: SupabaseClient,
  attemptId: string,
  options: { regenerate?: boolean; language?: string } = {},
): Promise<FeedbackNote & { cached: boolean }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw OFFLINE
  const body: GenerateFeedbackRequest = { attempt_id: attemptId }
  if (options.regenerate) body.regenerate = true
  // The notes are written in the dancer's language when the function supports it (else English).
  const language = noteLanguage(options.language ?? (typeof navigator !== 'undefined' ? navigator.language : undefined))
  if (language !== 'en') body.language = language

  let data: unknown
  try {
    const res = await supabase.functions.invoke<GenerateFeedbackResult>(FUNCTION_NAME, { body })
    if (res.error) throw res.error
    data = res.data
  } catch (e) {
    throw await invokeError(e)
  }

  const result = data as Partial<GenerateFeedbackResult> | null
  if (!result || typeof result.id !== 'string' || !isFeedbackResponse(result.response)) throw fromCode('model_invalid_output')
  return {
    id: result.id,
    attemptId: result.attempt_id ?? attemptId,
    model: result.model ?? '',
    promptVersion: result.prompt_version ?? '',
    createdAt: result.created_at ?? '',
    response: result.response,
    cached: result.cached === true,
  }
}

/** The notes themselves; see `generateFeedbackNote` for the stored row around them. */
export async function generateFeedback(
  supabase: SupabaseClient,
  attemptId: string,
  options: { regenerate?: boolean; language?: string } = {},
): Promise<FeedbackResponse> {
  return (await generateFeedbackNote(supabase, attemptId, options)).response
}

/** Stored notes of an attempt, newest first. Rows that don't match the contract are skipped. */
export async function listFeedback(supabase: SupabaseClient, attemptId: string): Promise<FeedbackNote[]> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw OFFLINE
  let rows: Record<string, unknown>[]
  try {
    const res = await supabase
      .from('feedback')
      .select('id, attempt_id, model, prompt_version, created_at, response')
      .eq('attempt_id', attemptId)
      .order('created_at', { ascending: false })
    if (res.error) throw { status: res.status }
    rows = (res.data ?? []) as Record<string, unknown>[]
  } catch (e) {
    const status = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : 0
    throw new FeedbackError(
      status,
      status === 401 ? 'unauthorized' : 'list_failed',
      status === 401 ? FAILURES.unauthorized.message : 'Your saved notes couldn’t be loaded.',
      status === 401 ? FAILURES.unauthorized.recovery : 'Check your connection and try again.',
    )
  }
  const notes: FeedbackNote[] = []
  for (const r of rows) {
    if (!isFeedbackResponse(r.response)) continue
    notes.push({
      id: String(r.id),
      attemptId: String(r.attempt_id),
      model: String(r.model),
      promptVersion: String(r.prompt_version),
      createdAt: String(r.created_at),
      response: r.response,
    })
  }
  return notes
}

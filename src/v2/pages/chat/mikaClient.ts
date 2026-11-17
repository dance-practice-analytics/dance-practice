// Calls the Edge Function mika-chat. Only the contract (types and copy) is imported from
// the function folder; none of its Deno code reaches the browser bundle.

import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError, type SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../../../api/errors'
import {
  FUNCTION_NAME,
  MAX_MESSAGES,
  MIKA_FAILURES,
  isMikaFailureCode,
  retryHint,
  type ChatMessage,
  type MikaFailureCode,
  type MikaReply,
  type MikaRequest,
  type MikaStatus,
} from '../../../../supabase/functions/mika-chat/contract'

export type { ChatMessage } from '../../../../supabase/functions/mika-chat/contract'
export { MAX_QUESTION_CHARS } from '../../../../supabase/functions/mika-chat/contract'

/** `code` is a MikaFailureCode of the function, or 'offline'. */
export class MikaError extends ApiError {
  retryAfterS?: number
  constructor(status: number, code: string, message: string, recovery?: string, retryAfterS?: number) {
    super(status, code, message, recovery)
    this.retryAfterS = retryAfterS
  }
}

const OFFLINE = new MikaError(0, 'offline', 'You’re offline, so Mika can’t answer right now.', 'Reconnect and send your question again.')

function fromCode(code: MikaFailureCode, status?: number): MikaError {
  const f = MIKA_FAILURES[code]
  return new MikaError(status || f.status, code, f.message, f.recovery)
}

/** True when the function isn't deployed or has no API key: the screen shows "not connected". */
export function isNotConnected(e: unknown): boolean {
  return e instanceof MikaError && e.code === 'not_connected'
}

/** Turns the function's error body (or its absence) into a dancer-safe error. */
export function mikaError(status: number, body: unknown): MikaError {
  const error = typeof body === 'object' && body !== null ? (body as { error?: Record<string, unknown> }).error : undefined
  const retryAfterS = typeof error?.retry_after_s === 'number' && error.retry_after_s > 0 ? error.retry_after_s : undefined
  if (isMikaFailureCode(error?.code)) {
    // The copy comes from the shared table, not from the response, so it is always safe to show.
    const f = MIKA_FAILURES[error.code]
    const recovery = error.code === 'rate_limited' && retryAfterS ? retryHint(retryAfterS) : f.recovery
    return new MikaError(status || f.status, error.code, f.message, recovery, retryAfterS)
  }
  // No body of ours: the platform answered. 404 = the function isn't deployed yet.
  if (status === 404) return fromCode('not_connected', status)
  if (status === 401 || status === 403) return fromCode('unauthorized', status)
  if (status === 429) return fromCode('upstream_busy', status)
  if (status === 504 || status === 546) return fromCode('upstream_timeout', status)
  return fromCode('upstream_error', status)
}

async function invokeError(e: unknown): Promise<MikaError> {
  if (e instanceof MikaError) return e
  if (e instanceof FunctionsHttpError) {
    const res = e.context as Response
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    return mikaError(res.status, body)
  }
  if (e instanceof FunctionsRelayError) return fromCode('upstream_error')
  if (e instanceof FunctionsFetchError) {
    return typeof navigator !== 'undefined' && navigator.onLine === false ? OFFLINE : fromCode('upstream_error', 0)
  }
  return fromCode('internal')
}

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/** Whether Mika can answer (deployed and has its key). No question is sent. Throws MikaError. */
export async function mikaStatus(supabase: SupabaseClient): Promise<boolean> {
  if (offline()) throw OFFLINE
  try {
    const res = await supabase.functions.invoke<MikaStatus>(FUNCTION_NAME, { method: 'GET' })
    if (res.error) throw res.error
    return res.data?.ready === true
  } catch (e) {
    throw await invokeError(e)
  }
}

export interface AskMika {
  attemptId: string
  compareAttemptId?: string | null
  scope?: 'attempt' | 'session'
  /** The whole conversation, oldest first, ending with the new question. Trimmed here. */
  messages: readonly ChatMessage[]
}

/** The last MAX_MESSAGES messages, starting with a question. */
export function historyToSend(messages: readonly ChatMessage[]): ChatMessage[] {
  const tail = messages.slice(-MAX_MESSAGES)
  const first = tail.findIndex((m) => m.role === 'user')
  return first < 0 ? [] : tail.slice(first)
}

/** One answer from Mika. Throws MikaError (an ApiError) with a message that is safe to show. */
export async function askMika(supabase: SupabaseClient, ask: AskMika): Promise<string> {
  if (offline()) throw OFFLINE
  const body: MikaRequest = { attempt_id: ask.attemptId, messages: historyToSend(ask.messages) }
  if (ask.compareAttemptId) body.compare_attempt_id = ask.compareAttemptId
  if (ask.scope === 'session') body.scope = 'session'

  let data: unknown
  try {
    const res = await supabase.functions.invoke<MikaReply>(FUNCTION_NAME, { body })
    if (res.error) throw res.error
    data = res.data
  } catch (e) {
    throw await invokeError(e)
  }
  const reply = (data as Partial<MikaReply> | null)?.reply
  if (typeof reply !== 'string' || reply.trim().length === 0) throw fromCode('model_invalid_output')
  return reply.trim()
}

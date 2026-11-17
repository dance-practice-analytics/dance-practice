// Contract of the mika-chat Edge Function (FR-3.7.x): Mika, the AI practice chat. Shared
// by the function (Deno) and the web app (src/v2/pages/chat/mikaClient.ts). This file has
// no imports and uses no Deno or DOM API, so the browser bundle can import it as is.

export const FUNCTION_NAME = 'mika-chat'
export const MODEL = 'claude-sonnet-5-5'

/** consents.scope that allows sending metrics to the model (same as practice notes). */
export const AI_CONSENT_SCOPE = 'ai_metrics_only'

/** 30 messages per user per hour (per function instance: see rateLimit.ts). */
export const RATE_LIMIT_MAX = 30
export const RATE_LIMIT_WINDOW_MS = 3_600_000

/** The conversation sent with each question: the last 12 messages (6 exchanges). */
export const MAX_MESSAGES = 12
/** A question from the dancer. Longer ones are refused, not cut. */
export const MAX_QUESTION_CHARS = 1000
/** Earlier replies of Mika are cut to this length when they are sent back as history. */
export const MAX_REPLY_CHARS = 3000
/** Attempts of one session sent with scope 'session'. */
export const MAX_SESSION_ATTEMPTS = 15

export type ChatRole = 'user' | 'assistant'
export interface ChatMessage {
  role: ChatRole
  content: string
}

export type ChatScope = 'attempt' | 'session'

export interface MikaRequest {
  attempt_id: string
  /** Another attempt of the same dancer to compare with (scope 'attempt'). */
  compare_attempt_id?: string
  /** 'session' sends the values of every analyzed attempt in the attempt's session. */
  scope?: ChatScope
  /** Oldest first; the last one is the dancer's new question. */
  messages: ChatMessage[]
}

/** 200 body of a POST. */
export interface MikaReply {
  reply: string
  model: string
}

/** 200 body of a GET: whether the function has its API key (no model call). */
export interface MikaStatus {
  ready: boolean
}

export type MikaFailureCode =
  | 'method_not_allowed'
  | 'unauthorized'
  | 'invalid_request'
  | 'question_too_long'
  | 'attempt_not_found'
  | 'consent_required'
  | 'rate_limited'
  | 'model_refused'
  | 'model_truncated'
  | 'model_invalid_output'
  | 'upstream_timeout'
  | 'upstream_busy'
  | 'upstream_error'
  | 'not_connected'
  | 'internal'

export interface MikaFailure {
  status: number
  /** Safe to show to the dancer. */
  message: string
  recovery: string
}

const AGAIN = 'Try again in a moment.'

export const MIKA_FAILURES: Record<MikaFailureCode, MikaFailure> = {
  method_not_allowed: { status: 405, message: 'This action isn’t available.', recovery: 'Go back and try again.' },
  unauthorized: { status: 401, message: 'Your session has ended.', recovery: 'Sign in again, then ask Mika once more.' },
  invalid_request: { status: 400, message: 'That question couldn’t be sent.', recovery: 'Start a new conversation and try again.' },
  question_too_long: {
    status: 400,
    message: `That question is too long for Mika (${MAX_QUESTION_CHARS} characters at most).`,
    recovery: 'Shorten it and send it again.',
  },
  attempt_not_found: {
    status: 404,
    message: 'There are no measurements for this attempt.',
    recovery: 'Analyze the clip first, or pick another attempt.',
  },
  consent_required: {
    status: 403,
    message: 'AI features are turned off for your account.',
    recovery: 'Turn on AI practice notes (metrics only) in Settings to ask Mika.',
  },
  rate_limited: {
    status: 429,
    message: `You’ve reached the limit of ${RATE_LIMIT_MAX} questions to Mika per hour.`,
    recovery: 'Try again later.',
  },
  model_refused: {
    status: 422,
    message: 'Mika can’t answer that question.',
    recovery: 'Try asking about one of your measurements instead.',
  },
  model_truncated: { status: 502, message: 'Mika’s answer came back incomplete.', recovery: 'Try again, or ask a shorter question.' },
  model_invalid_output: { status: 502, message: 'Mika’s answer came back empty.', recovery: AGAIN },
  upstream_timeout: { status: 504, message: 'Mika took too long to answer.', recovery: AGAIN },
  upstream_busy: { status: 503, message: 'Mika is busy right now.', recovery: 'Try again in a minute.' },
  upstream_error: { status: 502, message: 'Mika had a problem answering.', recovery: AGAIN },
  not_connected: {
    status: 503,
    message: 'Mika isn’t connected yet.',
    recovery: 'The AI service hasn’t been set up for this app. Practice notes, review and compare still work.',
  },
  internal: { status: 500, message: 'Something went wrong while asking Mika.', recovery: AGAIN },
}

/** Non-2xx body. */
export interface MikaErrorBody {
  error: {
    code: MikaFailureCode
    message: string
    recovery: string
    retry_after_s?: number
  }
}

/** "Try again in about 12 minutes." */
export function retryHint(seconds: number): string {
  if (seconds < 90) return 'Try again in about a minute.'
  return `Try again in about ${Math.ceil(seconds / 60)} minutes.`
}

export function mikaErrorBody(code: MikaFailureCode, retryAfterS?: number): MikaErrorBody {
  const f = MIKA_FAILURES[code]
  const error: MikaErrorBody['error'] = { code, message: f.message, recovery: f.recovery }
  if (retryAfterS !== undefined) {
    error.retry_after_s = retryAfterS
    if (code === 'rate_limited') error.recovery = retryHint(retryAfterS)
  }
  return { error }
}

export function isMikaFailureCode(v: unknown): v is MikaFailureCode {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(MIKA_FAILURES, v)
}

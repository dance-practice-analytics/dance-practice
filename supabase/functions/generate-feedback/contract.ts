// Contract of the generate-feedback Edge Function (FR-3.7.x, SDD 5.2 and 5.6), shared by
// the function (Deno) and the web app (src/feedback/client.ts). This file has no imports
// and uses no Deno or DOM API, so the browser bundle can import it as is.

export const FUNCTION_NAME = 'generate-feedback'
// The model is not fixed here: it is the LLM_MODEL secret (supabase/functions/_shared/llm.ts),
// and each stored note records the model that wrote it.

/** consents.scope that allows sending metrics to the model (account-level row, not revoked). */
export const AI_CONSENT_SCOPE = 'ai_metrics_only'

/** FR-3.7.9 / SDD 5.6: 20 requests per user per hour. */
export const RATE_LIMIT_MAX = 20
export const RATE_LIMIT_WINDOW_MS = 3_600_000

/** SDD 5.2: summary of at most 300 characters. */
export const SUMMARY_MAX_CHARS = 300
export const MIN_OBSERVATIONS = 1
export const MAX_OBSERVATIONS = 4

/** FR-3.7.7. The function always writes this text itself; the model's copy is replaced. */
export const DISCLAIMER =
  'These notes are generated automatically from camera measurements. They are not an assessment of your technique and are not a substitute for a teacher.'

/** Metric ids are the column names of attempt_metrics. */
export const METRIC_KEYS = [
  'trunk_inclination_deg',
  'pelvis_ankle_offset_norm',
  'balance_duration_s',
  'knee_tracking_dev_deg',
  'turn_count',
] as const
export type MetricKey = (typeof METRIC_KEYS)[number]

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

export interface FeedbackObservation {
  metric: MetricKey
  observation: string
  suggestion: string
  confidence: ConfidenceLevel
}

export interface FeedbackResponse {
  summary: string
  /** 1 to 4 items, each about a different metric. */
  observations: FeedbackObservation[]
  cautions: string[]
  disclaimer: string
}

export interface GenerateFeedbackRequest {
  attempt_id: string
  /** Skip the cached note for the same input and ask the model again (still rate limited). */
  regenerate?: boolean
}

/** 200 body: the stored feedback row. */
export interface GenerateFeedbackResult {
  id: string
  attempt_id: string
  model: string
  prompt_version: string
  created_at: string
  /** True when an earlier note for the same input was returned without calling the model. */
  cached: boolean
  response: FeedbackResponse
}

export type FailureCode =
  | 'method_not_allowed'
  | 'unauthorized'
  | 'invalid_request'
  | 'attempt_not_found'
  | 'nothing_measured'
  | 'consent_required'
  | 'rate_limited'
  | 'model_refused'
  | 'model_truncated'
  | 'model_invalid_output'
  | 'upstream_timeout'
  | 'upstream_busy'
  | 'upstream_error'
  | 'not_configured'
  | 'storage_failed'
  | 'internal'

export interface Failure {
  status: number
  /** Safe to show to the dancer. */
  message: string
  recovery: string
}

const STILL_THERE = 'Your video and measurements are not affected.'

export const FAILURES: Record<FailureCode, Failure> = {
  method_not_allowed: { status: 405, message: 'This action isn’t available.', recovery: 'Go back and try again.' },
  unauthorized: { status: 401, message: 'Your session has ended.', recovery: 'Sign in again, then ask for the notes once more.' },
  invalid_request: { status: 400, message: 'That request didn’t look right.', recovery: 'Open the attempt again and retry.' },
  attempt_not_found: {
    status: 404,
    message: 'There are no measurements for this attempt.',
    recovery: 'Analyze the clip first, then ask for practice notes.',
  },
  nothing_measured: {
    status: 422,
    message: 'Nothing could be measured in this attempt, so there is nothing to write notes about.',
    recovery: 'Check the tracking in the review screen, or record again with your whole body in frame.',
  },
  consent_required: {
    status: 403,
    message: 'Practice notes are turned off for your account.',
    recovery: 'Turn on AI practice notes (metrics only) in Settings to use them.',
  },
  rate_limited: {
    status: 429,
    message: `You’ve reached the limit of ${RATE_LIMIT_MAX} practice notes per hour.`,
    recovery: 'Try again later.',
  },
  model_refused: {
    status: 422,
    message: 'The notes couldn’t be written for this attempt.',
    recovery: STILL_THERE,
  },
  model_truncated: {
    status: 502,
    message: 'The notes came back incomplete, so they weren’t saved.',
    recovery: `Try again. ${STILL_THERE}`,
  },
  model_invalid_output: {
    status: 502,
    message: 'The notes came back in an unexpected form, so they weren’t saved.',
    recovery: `Try again. ${STILL_THERE}`,
  },
  upstream_timeout: {
    status: 504,
    message: 'Writing the notes took too long.',
    recovery: `Try again in a moment. ${STILL_THERE}`,
  },
  upstream_busy: {
    status: 503,
    message: 'The notes service is busy right now.',
    recovery: `Try again in a minute. ${STILL_THERE}`,
  },
  upstream_error: {
    status: 502,
    message: 'The notes service had a problem.',
    recovery: `Try again in a moment. ${STILL_THERE}`,
  },
  not_configured: {
    status: 500,
    message: 'Practice notes aren’t set up yet.',
    recovery: STILL_THERE,
  },
  storage_failed: {
    status: 500,
    message: 'The notes couldn’t be saved.',
    recovery: `Try again in a moment. ${STILL_THERE}`,
  },
  internal: {
    status: 500,
    message: 'Something went wrong while writing the notes.',
    recovery: `Try again in a moment. ${STILL_THERE}`,
  },
}

/** Non-2xx body. */
export interface FeedbackErrorBody {
  error: {
    code: FailureCode
    message: string
    recovery: string
    /** Seconds until a retry can work (rate_limited, sometimes upstream_busy). */
    retry_after_s?: number
  }
}

/** "Try again in about 12 minutes." */
export function retryHint(seconds: number): string {
  if (seconds < 90) return 'Try again in about a minute.'
  return `Try again in about ${Math.ceil(seconds / 60)} minutes.`
}

export function errorBody(code: FailureCode, retryAfterS?: number): FeedbackErrorBody {
  const f = FAILURES[code]
  const error: FeedbackErrorBody['error'] = { code, message: f.message, recovery: f.recovery }
  if (retryAfterS !== undefined) {
    error.retry_after_s = retryAfterS
    if (code === 'rate_limited') error.recovery = retryHint(retryAfterS)
  }
  return { error }
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** Structural check of a stored or returned note; the strict checks live in validate.ts. */
export function isFeedbackResponse(v: unknown): v is FeedbackResponse {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (!isText(r.summary) || !isText(r.disclaimer)) return false
  if (!Array.isArray(r.cautions) || !r.cautions.every((c) => typeof c === 'string')) return false
  if (!Array.isArray(r.observations) || r.observations.length < MIN_OBSERVATIONS || r.observations.length > MAX_OBSERVATIONS) {
    return false
  }
  return r.observations.every((o) => {
    if (typeof o !== 'object' || o === null) return false
    const obs = o as Record<string, unknown>
    return (
      (METRIC_KEYS as readonly unknown[]).includes(obs.metric) &&
      isText(obs.observation) &&
      isText(obs.suggestion) &&
      (CONFIDENCE_LEVELS as readonly unknown[]).includes(obs.confidence)
    )
  })
}

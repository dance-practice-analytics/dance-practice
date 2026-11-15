// Supabase Edge Function generate-feedback (FR-3.7.1, SDD 5.6): POST { attempt_id } with
// the caller's JWT → neutral practice notes for that attempt, stored in `feedback`.
//
// - The Supabase client is created with the request's Authorization header, so every
//   query runs under the caller's RLS. The service-role key is never used.
// - The model receives the metrics payload of payload.ts and nothing else.
// - ANTHROPIC_API_KEY is read from the function's secrets only.
//
// The request flow lives in handler.ts; this file wires it to Supabase and Claude.

import Anthropic from '@anthropic-ai/sdk'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { AI_CONSENT_SCOPE, MODEL, RATE_LIMIT_MAX, errorBody, FAILURES, type FailureCode } from './contract.ts'
import { allowedOrigins, corsHeaders } from './cors.ts'
import { handleGenerate, interpretMessage, type Deps, type ModelOutcome, type StoredFeedback } from './handler.ts'
import { MAX_EARLIER_ATTEMPTS, type FeedbackPayload, type MetricsRowLike } from './payload.ts'
import { SYSTEM_PROMPT, buildUserMessage } from './prompt.ts'
import { FEEDBACK_JSON_SCHEMA } from './validate.ts'

/** SDD 5.6: 30-second timeout. One retry on a connection error, 429 or 5xx. */
const TIMEOUT_MS = 30_000
const MAX_RETRIES = 1
/** Room for adaptive thinking plus the notes (a few hundred tokens). */
const MAX_TOKENS = 8000

const METRIC_COLUMNS =
  'attempt_id, movement, trunk_inclination_deg, pelvis_ankle_offset_norm, balance_duration_s, knee_tracking_dev_deg, turn_count, phases, confidence'
const FEEDBACK_COLUMNS = 'id, attempt_id, model, prompt_version, created_at, response'

function retryAfterSeconds(headers: unknown): number | undefined {
  const value = headers instanceof Headers ? headers.get('retry-after') : null
  const seconds = value ? Number(value) : NaN
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined
}

async function callClaude(apiKey: string, payload: FeedbackPayload, fallback: boolean): Promise<ModelOutcome> {
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: MAX_RETRIES })
  try {
    const message = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Thinking is adaptive by default on this model; low effort keeps a short task fast (NFR-8).
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: FEEDBACK_JSON_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(payload) }],
      // Server-side refusal fallback: a decline in a category that can be retried is re-run
      // on the fallback model inside the same call. Set REFUSAL_FALLBACK=off to drop it.
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    })
    return interpretMessage(message)
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, code: 'upstream_timeout' }
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, code: 'upstream_error' }
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, code: 'not_configured' }
    }
    if (e instanceof Anthropic.RateLimitError) {
      return { ok: false, code: 'upstream_busy', retryAfterS: retryAfterSeconds(e.headers) }
    }
    if (e instanceof Anthropic.APIError) {
      console.error('generate-feedback: Claude API error', e.status)
      // 5xx and 529 (overloaded) are temporary; a 4xx means the request itself is wrong.
      return { ok: false, code: typeof e.status === 'number' && e.status >= 500 ? 'upstream_busy' : 'upstream_error' }
    }
    throw e
  }
}

function deps(supabase: SupabaseClient, token: string, apiKey: string | undefined, fallback: boolean): Deps {
  const must = <T>(res: { data: T; error: { message: string } | null }): T => {
    if (res.error) throw new Error('database')
    return res.data
  }

  const metricsFor = async (ids: string[]): Promise<(MetricsRowLike & { attempt_id: string })[]> =>
    must(await supabase.from('attempt_metrics').select(METRIC_COLUMNS).in('attempt_id', ids)) ?? []

  return {
    async userId() {
      const { data, error } = await supabase.auth.getUser(token)
      return error ? null : (data.user?.id ?? null)
    },

    async hasAiConsent() {
      const rows = must(
        await supabase
          .from('consents')
          .select('id')
          .eq('scope', AI_CONSENT_SCOPE)
          .is('subject_id', null)
          .is('revoked_on', null)
          .limit(1),
      )
      return (rows ?? []).length > 0
    },

    async loadMetrics(attemptId) {
      return (await metricsFor([attemptId]))[0] ?? null
    },

    // Comparison values are optional context: a failure here must not block the notes.
    async loadEarlierMetrics(attemptId) {
      try {
        // Only the session and the time are read from `attempts`: never label, clip name or paths.
        const attempt = must(await supabase.from('attempts').select('session_id, created_at').eq('id', attemptId).maybeSingle())
        if (!attempt) return []
        const earlier = must(
          await supabase
            .from('attempts')
            .select('id')
            .eq('session_id', attempt.session_id)
            .lt('created_at', attempt.created_at)
            .order('created_at', { ascending: false })
            .limit(MAX_EARLIER_ATTEMPTS),
        )
        const ids = (earlier ?? []).map((a: { id: string }) => a.id)
        if (ids.length === 0) return []
        const rows = await metricsFor(ids)
        return ids.flatMap((id: string) => rows.filter((r) => r.attempt_id === id))
      } catch {
        return []
      }
    },

    async findCached(attemptId, hash) {
      const rows = must(
        await supabase
          .from('feedback')
          .select(FEEDBACK_COLUMNS)
          .eq('attempt_id', attemptId)
          .eq('input_hash', hash)
          .order('created_at', { ascending: false })
          .limit(1),
      )
      return ((rows ?? [])[0] as StoredFeedback | undefined) ?? null
    },

    async recentFeedbackTimes(sinceIso) {
      const rows = must(
        await supabase
          .from('feedback')
          .select('created_at')
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .limit(RATE_LIMIT_MAX),
      )
      return (rows ?? []).map((r: { created_at: string }) => r.created_at)
    },

    async callModel(payload): Promise<ModelOutcome> {
      if (!apiKey) return { ok: false, code: 'not_configured' }
      return callClaude(apiKey, payload, fallback)
    },

    async saveFeedback(row) {
      // owner_id is filled by the database (default auth.uid()) and checked by RLS.
      const { data, error } = await supabase.from('feedback').insert(row).select('id, created_at').single()
      return error || !data ? null : { id: data.id, created_at: data.created_at }
    },

    now: () => Date.now(),

    // Codes and short reasons only: no metrics, notes or identifiers in the logs.
    log: (code: FailureCode, detail?: string) => console.warn('generate-feedback:', code, detail ?? ''),
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get('origin'), allowedOrigins(Deno.env.get('ALLOWED_ORIGINS')))
  const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, ...extra, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const authorization = req.headers.get('authorization') ?? ''
  const token = authorization.replace(/^Bearer\s+/i, '')
  const url = Deno.env.get('SUPABASE_URL')
  // The public key of the project: the default secret, or the one the client sent.
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? req.headers.get('apikey')
  if (!token) return json(FAILURES.unauthorized.status, errorBody('unauthorized'))
  if (!url || !publicKey) return json(FAILURES.not_configured.status, errorBody('not_configured'))

  const supabase = createClient(url, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let body: unknown = null
  if (req.method === 'POST') {
    try {
      body = await req.json()
    } catch {
      body = null
    }
  }

  const fallback = Deno.env.get('REFUSAL_FALLBACK') !== 'off'
  const result = await handleGenerate(req.method, body, deps(supabase, token, Deno.env.get('ANTHROPIC_API_KEY'), fallback))
  return json(result.status, result.body, result.retryAfterS ? { 'Retry-After': String(result.retryAfterS) } : {})
})

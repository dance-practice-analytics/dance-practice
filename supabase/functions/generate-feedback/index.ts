// Supabase Edge Function generate-feedback (FR-3.7.1, SDD 5.6): POST { attempt_id } with
// the caller's JWT → neutral practice notes for that attempt, stored in `feedback`.
//
// - The Supabase client is created with the request's Authorization header, so every
//   query runs under the caller's RLS. The service-role key is never used.
// - The model receives the metrics payload of payload.ts and nothing else (for a phrase:
//   ../_shared/phrase.ts, with earlier sessions of the same view and the focus themes,
//   loaded by ../_shared/phraseContext.ts).
// - The provider (Gemini or Grok, OpenAI-compatible) and its key come from the function's
//   secrets only: LLM_API_KEY, LLM_BASE_URL, LLM_MODEL (see ../_shared/llm.ts).
//
// The request flow lives in handler.ts; this file wires it to Supabase and the model.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createLlm, llmConfigFromEnv, LlmError, type Llm } from '../_shared/llm.ts'
import { loadPhraseContext } from '../_shared/phraseContext.ts'
import { AI_CONSENT_SCOPE, RATE_LIMIT_MAX, errorBody, FAILURES, type FailureCode } from './contract.ts'
import { allowedOrigins, corsHeaders } from './cors.ts'
import { handleGenerate, interpretCompletion, outcomeFromError, type Deps, type ModelOutcome, type StoredFeedback } from './handler.ts'
import { MAX_EARLIER_ATTEMPTS, type FeedbackPayload, type MetricsRowLike } from './payload.ts'
import { SYSTEM_PROMPT, buildUserMessage } from './prompt.ts'
import { FEEDBACK_JSON_SCHEMA } from './validate.ts'

/** SDD 5.6: 30-second timeout. One retry on a connection error, 429 or 5xx (in llm.ts). */
const TIMEOUT_MS = 30_000
const MAX_RETRIES = 1
/** Room for a thinking model's reasoning plus the notes (a few hundred tokens). */
const MAX_TOKENS = 8000

const METRIC_COLUMNS =
  'attempt_id, movement, trunk_inclination_deg, pelvis_ankle_offset_norm, balance_duration_s, knee_tracking_dev_deg, turn_count, feet_angle_deg, phases, confidence, phrase'
const FEEDBACK_COLUMNS = 'id, attempt_id, model, prompt_version, created_at, response'

async function askModel(llm: Llm, payload: FeedbackPayload): Promise<ModelOutcome> {
  try {
    const completion = await llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(payload) }],
      maxTokens: MAX_TOKENS,
      jsonSchema: { name: 'practice_notes', schema: FEEDBACK_JSON_SCHEMA },
    })
    if (completion.finishReason !== 'stop') {
      console.warn('generate-feedback: model stopped', llm.provider, completion.rawFinishReason ?? 'none')
    }
    return interpretCompletion(completion)
  } catch (e) {
    if (e instanceof LlmError) console.error('generate-feedback: model call failed', llm.provider, e.kind, e.status ?? '')
    return outcomeFromError(e)
  }
}

function deps(supabase: SupabaseClient, token: string, llm: Llm): Deps {
  const must = <T>(res: { data: T; error: { message: string } | null }): T => {
    if (res.error) throw new Error('database')
    return res.data
  }

  const metricsFor = async (ids: string[]): Promise<(MetricsRowLike & { attempt_id: string })[]> =>
    must(await supabase.from('attempt_metrics').select(METRIC_COLUMNS).in('attempt_id', ids)) ?? []

  let uid: string | null = null

  return {
    model: llm.model,

    async userId() {
      const { data, error } = await supabase.auth.getUser(token)
      uid = error ? null : (data.user?.id ?? null)
      return uid
    },

    // Phrase only; the handler treats a failure as "no extra context".
    async loadPhraseContext(attemptId) {
      if (!uid) return {}
      return loadPhraseContext(supabase, uid, attemptId)
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
      if (!llm.configured) return { ok: false, code: 'not_configured' }
      return askModel(llm, payload)
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

  const llm = createLlm(llmConfigFromEnv((name) => Deno.env.get(name)), { timeoutMs: TIMEOUT_MS, maxRetries: MAX_RETRIES })
  const result = await handleGenerate(req.method, body, deps(supabase, token, llm))
  return json(result.status, result.body, result.retryAfterS ? { 'Retry-After': String(result.retryAfterS) } : {})
})

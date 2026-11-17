// Supabase Edge Function mika-chat (FR-3.7.x): Mika, the AI practice chat.
// POST { attempt_id, compare_attempt_id?, scope?, messages } with the caller's JWT → { reply }.
// GET → { ready } (whether LLM_API_KEY, LLM_BASE_URL and LLM_MODEL are set; used by the
// app to show the "not connected" state without asking the model anything).
//
// - The Supabase client is created with the request's Authorization header, so every
//   query runs under the caller's RLS. The service-role key is never used.
// - Only attempt_metrics rows and attempt ids/order are read (for a phrase also the
//   session's view and dancer ids, earlier sessions' theme values and the focus themes):
//   never keypoints, frames, video, titles, notes, file names or subject codes.
// - The provider (Gemini or Grok, OpenAI-compatible) and its key come from the function's
//   secrets only (see ../_shared/llm.ts).
//
// The request flow lives in handler.ts; this file wires it to Supabase and the model.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createLlm, llmConfigFromEnv, LlmError, type Llm } from '../_shared/llm.ts'
import { loadPhraseContext } from '../_shared/phraseContext.ts'
import { AI_CONSENT_SCOPE, MIKA_FAILURES, mikaErrorBody, type ChatMessage, type MikaFailureCode } from './contract.ts'
import { allowedOrigins, corsHeaders } from '../generate-feedback/cors.ts'
import { handleMika, interpretCompletion, outcomeFromError, type Deps, type MetricsRow, type ModelOutcome } from './handler.ts'
import { createRateLimiter } from './rateLimit.ts'

/** A chat answer should come back fast; one retry on a connection error, 429 or 5xx (in llm.ts). */
const TIMEOUT_MS = 30_000
const MAX_RETRIES = 1
/** Room for a thinking model's reasoning plus a short answer. */
const MAX_TOKENS = 8000

const METRIC_COLUMNS =
  'attempt_id, movement, trunk_inclination_deg, pelvis_ankle_offset_norm, balance_duration_s, knee_tracking_dev_deg, turn_count, phases, confidence, phrase'

/** Per instance: see rateLimit.ts for what that means. */
const limiter = createRateLimiter()

async function askModel(llm: Llm, system: { type: 'text'; text: string }[], messages: ChatMessage[]): Promise<ModelOutcome> {
  try {
    // Instructions first, then the measurements block, in one system message.
    const completion = await llm.complete({ system: system.map((b) => b.text), messages, maxTokens: MAX_TOKENS })
    if (completion.finishReason !== 'stop') {
      console.warn('mika-chat: model stopped', llm.provider, completion.rawFinishReason ?? 'none')
    }
    return interpretCompletion(completion)
  } catch (e) {
    if (e instanceof LlmError) console.error('mika-chat: model call failed', llm.provider, e.kind, e.status ?? '')
    return outcomeFromError(e)
  }
}

function deps(supabase: SupabaseClient, token: string, llm: Llm): Deps {
  const must = <T>(res: { data: T; error: { message: string } | null }): T => {
    if (res.error) throw new Error('database')
    return res.data
  }

  return {
    async userId() {
      const { data, error } = await supabase.auth.getUser(token)
      return error ? null : (data.user?.id ?? null)
    },

    hasApiKey: () => llm.configured,

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

    async loadMetrics(ids) {
      return (must(await supabase.from('attempt_metrics').select(METRIC_COLUMNS).in('attempt_id', ids)) ?? []) as MetricsRow[]
    },

    // Only session_id, id and created_at are read from `attempts`: never label, clip name or paths.
    async sessionAttemptIds(attemptId) {
      const attempt = must(await supabase.from('attempts').select('session_id').eq('id', attemptId).maybeSingle())
      if (!attempt) return []
      const rows = must(
        await supabase
          .from('attempts')
          .select('id')
          .eq('session_id', attempt.session_id)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(200),
      )
      return (rows ?? []).map((r: { id: string }) => r.id)
    },

    // Phrase only: earlier sessions of the same view and the focus themes (owner-filtered, under RLS).
    loadPhraseContext: (uid, attemptId) => loadPhraseContext(supabase, uid, attemptId),

    rateLimit: (uid, now) => limiter.take(uid, now),

    async callModel(system, messages) {
      if (!llm.configured) return { ok: false, code: 'not_connected' }
      return askModel(llm, system, messages)
    },

    now: () => Date.now(),

    // Codes and short reasons only: no questions, metrics or answers in the logs.
    log: (code: MikaFailureCode, detail?: string) => console.warn('mika-chat:', code, detail ?? ''),
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get('origin'), allowedOrigins(Deno.env.get('ALLOWED_ORIGINS')))
  // corsHeaders allows POST only; the status probe is a GET.
  cors['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
  const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, ...extra, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const authorization = req.headers.get('authorization') ?? ''
  const token = authorization.replace(/^Bearer\s+/i, '')
  const url = Deno.env.get('SUPABASE_URL')
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? req.headers.get('apikey')
  if (!token) return json(MIKA_FAILURES.unauthorized.status, mikaErrorBody('unauthorized'))
  if (!url || !publicKey) return json(MIKA_FAILURES.internal.status, mikaErrorBody('internal'))

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
  const result = await handleMika(req.method, body, deps(supabase, token, llm))
  return json(result.status, result.body, result.retryAfterS ? { 'Retry-After': String(result.retryAfterS) } : {})
})

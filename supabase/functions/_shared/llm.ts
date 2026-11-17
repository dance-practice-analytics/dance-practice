// Provider-neutral model call for the Edge Functions (generate-feedback, mika-chat). Both
// Google Gemini and xAI Grok expose an OpenAI-compatible Chat Completions endpoint, so one
// small fetch client covers either; which one is used is decided only by Supabase secrets:
//
//   LLM_API_KEY   the provider's key (sent as Authorization: Bearer)
//   LLM_BASE_URL  https://generativelanguage.googleapis.com/v1beta/openai/  or  https://api.x.ai/v1
//   LLM_MODEL     e.g. gemini-3.8-flash  or  grok-4.7
//   LLM_PROVIDER  optional label for logs ("gemini", "grok")
//   LLM_JSON_MODE optional: "json_object" when the provider rejects response_format json_schema
//   LLM_REASONING_EFFORT optional: sent as reasoning_effort (e.g. "low"); omitted by default
//
// Plain TypeScript, no SDK and no Deno API, so Vitest runs it with a fake fetch. The caller
// maps the neutral result to its own error codes. Only what the caller passes is sent: the
// functions pass metrics JSON and the dancer's questions, never keypoints, frames or video.

export type FinishReason = 'stop' | 'length' | 'content_filter' | 'other'

export interface LlmUsage {
  inputTokens: number | null
  outputTokens: number | null
}

export interface LlmCompletion {
  text: string
  finishReason: FinishReason
  /** finish_reason exactly as the provider sent it, for logs. */
  rawFinishReason: string | null
  /** The configured model id (stable across providers' spelling of it in responses). */
  model: string
  usage: LlmUsage
}

export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LlmRequest {
  /** One system prompt, or several blocks joined in order (stable instructions first). */
  system: string | readonly string[]
  messages: readonly LlmMessage[]
  maxTokens: number
  /** Asks for JSON that follows this schema (json_schema mode, or json_object with LLM_JSON_MODE). */
  jsonSchema?: { name: string; schema: unknown }
}

export type LlmErrorKind =
  /** Key, base URL or model missing. */
  | 'not_configured'
  /** 401/403, or a 400 that names the API key: the key was rejected. */
  | 'auth'
  /** 429 after the retry. */
  | 'rate_limited'
  /** 5xx after the retry. */
  | 'unavailable'
  | 'timeout'
  /** Connection failed after the retry. */
  | 'network'
  /** Any other 4xx: the request itself is wrong (bad model id, unsupported parameter). */
  | 'bad_request'
  /** 2xx with a body that is not a chat completion. */
  | 'bad_response'

export class LlmError extends Error {
  readonly kind: LlmErrorKind
  readonly status?: number
  readonly retryAfterS?: number
  constructor(kind: LlmErrorKind, status?: number, retryAfterS?: number) {
    super(`llm ${kind}${status ? ` ${status}` : ''}`)
    this.name = 'LlmError'
    this.kind = kind
    this.status = status
    this.retryAfterS = retryAfterS
  }
}

export interface LlmConfig {
  apiKey: string
  /** Normalised without a trailing slash. */
  baseUrl: string
  model: string
  provider: string
  jsonMode: 'json_schema' | 'json_object'
  reasoningEffort?: string
}

/** Reads the secrets; null when the key, the base URL or the model is missing. */
export function llmConfigFromEnv(get: (name: string) => string | undefined): LlmConfig | null {
  const apiKey = get('LLM_API_KEY')?.trim()
  const baseUrl = get('LLM_BASE_URL')?.trim().replace(/\/+$/, '')
  const model = get('LLM_MODEL')?.trim()
  if (!apiKey || !baseUrl || !model) return null
  if (!/^https:\/\//i.test(baseUrl)) return null
  const reasoningEffort = get('LLM_REASONING_EFFORT')?.trim()
  return {
    apiKey,
    baseUrl,
    model,
    provider: get('LLM_PROVIDER')?.trim() || providerFromUrl(baseUrl),
    jsonMode: get('LLM_JSON_MODE')?.trim() === 'json_object' ? 'json_object' : 'json_schema',
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }
}

function providerFromUrl(url: string): string {
  if (url.includes('generativelanguage.googleapis.com')) return 'gemini'
  if (url.includes('api.x.ai')) return 'grok'
  return 'openai-compatible'
}

/**
 * finish_reason → neutral reason. "stop" is the normal end on both providers; "length" is
 * the token cap. Safety stops are "content_filter" in the OpenAI format; the other names
 * are what Gemini's native API uses, in case the compatibility layer passes one through.
 */
export function normaliseFinishReason(raw: string | null | undefined): FinishReason {
  const r = (raw ?? '').toLowerCase()
  if (r === 'stop' || r === 'end_turn') return 'stop'
  if (r === 'length' || r === 'max_tokens') return 'length'
  if (['content_filter', 'safety', 'refusal', 'recitation', 'prohibited_content', 'blocklist', 'spii', 'image_safety'].includes(r)) {
    return 'content_filter'
  }
  return 'other'
}

export interface LlmOptions {
  fetch?: typeof fetch
  /** Whole budget of one complete() call, retries included. SDD 5.6: 30 s. */
  timeoutMs?: number
  /** Retries after a connection error, a 429 or a 5xx. */
  maxRetries?: number
  sleep?: (ms: number) => Promise<void>
}

export interface Llm {
  readonly configured: boolean
  readonly model: string
  readonly provider: string
  complete(request: LlmRequest): Promise<LlmCompletion>
}

/** A 429 asking to wait longer than this is not retried inside the request. */
const MAX_RETRY_WAIT_MS = 5_000
const DEFAULT_BACKOFF_MS = 1_000

function retryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get('retry-after')
  const seconds = value ? Number(value) : NaN
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  // Some compatible endpoints return content parts.
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'object' && p !== null && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
      .join('')
  }
  return ''
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function buildRequestBody(config: LlmConfig, request: LlmRequest): Record<string, unknown> {
  let system = typeof request.system === 'string' ? request.system : request.system.join('\n\n')
  // json_object mode does not carry the schema, so the model is shown it in the instructions.
  if (request.jsonSchema && config.jsonMode === 'json_object') {
    system += `\n\nReturn only a JSON object, with no other text, that follows this JSON schema:\n${JSON.stringify(request.jsonSchema.schema)}`
  }
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [{ role: 'system', content: system }, ...request.messages.map((m) => ({ role: m.role, content: m.content }))],
    max_tokens: request.maxTokens,
    stream: false,
  }
  if (config.reasoningEffort) body.reasoning_effort = config.reasoningEffort
  if (request.jsonSchema) {
    body.response_format =
      config.jsonMode === 'json_object'
        ? { type: 'json_object' }
        : { type: 'json_schema', json_schema: { name: request.jsonSchema.name, schema: request.jsonSchema.schema, strict: true } }
  }
  return body
}

export function parseCompletion(data: unknown, model: string): LlmCompletion {
  const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  const choice = Array.isArray(d.choices) ? (d.choices[0] as Record<string, unknown> | undefined) : undefined
  if (!choice || typeof choice !== 'object') throw new LlmError('bad_response')
  const message = (typeof choice.message === 'object' && choice.message !== null ? choice.message : {}) as Record<string, unknown>
  const rawFinishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null
  // An OpenAI-style refusal field is a refusal whatever finish_reason says.
  const refused = typeof message.refusal === 'string' && message.refusal.trim().length > 0
  const usage = (typeof d.usage === 'object' && d.usage !== null ? d.usage : {}) as Record<string, unknown>
  return {
    text: messageText(message.content),
    finishReason: refused ? 'content_filter' : normaliseFinishReason(rawFinishReason),
    rawFinishReason,
    model,
    usage: { inputTokens: num(usage.prompt_tokens), outputTokens: num(usage.completion_tokens) },
  }
}

async function isKeyError(res: Response): Promise<boolean> {
  try {
    return /api[\s_-]?key/i.test(await res.text())
  } catch {
    return false
  }
}

export function createLlm(config: LlmConfig | null, options: LlmOptions = {}): Llm {
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const timeoutMs = options.timeoutMs ?? 30_000
  const maxRetries = options.maxRetries ?? 1
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  return {
    configured: config !== null,
    model: config?.model ?? 'not-configured',
    provider: config?.provider ?? 'none',

    async complete(request) {
      if (!config) throw new LlmError('not_configured')
      const url = `${config.baseUrl}/chat/completions`
      const body = JSON.stringify(buildRequestBody(config, request))
      const deadline = Date.now() + timeoutMs

      for (let attempt = 0; ; attempt++) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new LlmError('timeout')
        const controller = new AbortController()
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, remaining)
        const canRetry = attempt < maxRetries

        let res: Response
        try {
          res = await doFetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
            body,
            signal: controller.signal,
          })
        } catch {
          clearTimeout(timer)
          if (timedOut) throw new LlmError('timeout')
          if (canRetry) {
            await sleep(DEFAULT_BACKOFF_MS)
            continue
          }
          throw new LlmError('network')
        }

        try {
          if (res.ok) {
            let data: unknown
            try {
              data = await res.json()
            } catch {
              if (timedOut) throw new LlmError('timeout')
              throw new LlmError('bad_response', res.status)
            }
            return parseCompletion(data, config.model)
          }

          const status = res.status
          if (status === 401 || status === 403) throw new LlmError('auth', status)
          if (status === 429 || status >= 500) {
            const retryAfterS = retryAfterSeconds(res.headers)
            const waitMs = retryAfterS !== undefined ? retryAfterS * 1000 : DEFAULT_BACKOFF_MS
            if (canRetry && waitMs <= MAX_RETRY_WAIT_MS && deadline - Date.now() > waitMs) {
              await sleep(waitMs)
              continue
            }
            throw new LlmError(status === 429 ? 'rate_limited' : 'unavailable', status, retryAfterS)
          }
          // Gemini answers a bad key with 400 INVALID_ARGUMENT "API key not valid".
          if (status === 400 && (await isKeyError(res))) throw new LlmError('auth', status)
          throw new LlmError('bad_request', status)
        } finally {
          clearTimeout(timer)
        }
      }
    },
  }
}

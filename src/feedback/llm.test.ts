// Unit tests of the provider-neutral model adapter shared by the Edge Functions
// (supabase/functions/_shared/llm.ts). No network: fetch is a fake.

import { describe, expect, it } from 'vitest'
import {
  LlmError,
  buildRequestBody,
  createLlm,
  llmConfigFromEnv,
  normaliseFinishReason,
  type LlmConfig,
  type LlmRequest,
} from '../../supabase/functions/_shared/llm'

const GEMINI = {
  LLM_API_KEY: 'test-key',
  LLM_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  LLM_MODEL: 'gemini-3.8-flash',
}
const GROK = { LLM_API_KEY: 'test-key', LLM_BASE_URL: 'https://api.x.ai/v1', LLM_MODEL: 'grok-4.7' }

const env = (vars: Record<string, string>) => (name: string) => vars[name]
const config = (vars: Record<string, string> = GEMINI) => llmConfigFromEnv(env(vars)) as LlmConfig

const REQUEST: LlmRequest = {
  system: ['Instructions.', '<measurements>{}</measurements>'],
  messages: [{ role: 'user', content: 'Write the practice notes.' }],
  maxTokens: 800,
  jsonSchema: { name: 'practice_notes', schema: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] } },
}

const completion = (finish_reason: string | null, content: unknown = '{"a":1}', extra: Record<string, unknown> = {}) => ({
  id: 'x',
  object: 'chat.completion',
  model: 'models/whatever',
  choices: [{ index: 0, message: { role: 'assistant', content, ...extra }, finish_reason }],
  usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
})

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

/** A fetch that answers from a queue and records what it was sent. */
function fakeFetch(...answers: (Response | Error | 'hang')[]) {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} })
    const next = answers.shift()
    if (next === undefined) throw new Error('no more answers')
    if (next === 'hang') {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    }
    if (next instanceof Error) throw next
    return next
  }
  return { fetch: fn as typeof fetch, calls }
}

const noSleep = { sleep: async () => {} }

async function failure(run: Promise<unknown>): Promise<LlmError> {
  try {
    await run
  } catch (e) {
    if (e instanceof LlmError) return e
    throw e
  }
  throw new Error('expected a failure')
}

describe('llmConfigFromEnv', () => {
  it('reads Gemini and Grok settings and labels the provider', () => {
    expect(config(GEMINI)).toEqual({
      apiKey: 'test-key',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-3.8-flash',
      provider: 'gemini',
      jsonMode: 'json_schema',
    })
    expect(config(GROK)).toMatchObject({ baseUrl: 'https://api.x.ai/v1', provider: 'grok', model: 'grok-4.7' })
    expect(config({ ...GROK, LLM_PROVIDER: 'xai', LLM_JSON_MODE: 'json_object', LLM_REASONING_EFFORT: 'low' })).toMatchObject({
      provider: 'xai',
      jsonMode: 'json_object',
      reasoningEffort: 'low',
    })
  })

  it('is null when the key, the base URL or the model is missing', () => {
    for (const missing of ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL']) {
      expect(llmConfigFromEnv(env({ ...GEMINI, [missing]: '  ' }))).toBeNull()
      const partial: Record<string, string> = { ...GEMINI }
      delete partial[missing]
      expect(llmConfigFromEnv(env(partial))).toBeNull()
    }
    expect(llmConfigFromEnv(env({ ...GEMINI, LLM_BASE_URL: 'http://plain.example/v1' }))).toBeNull()
  })
})

describe('buildRequestBody', () => {
  it('sends one system message, the conversation, the token cap and a strict JSON schema', () => {
    expect(buildRequestBody(config(GROK), REQUEST)).toEqual({
      model: 'grok-4.7',
      messages: [
        { role: 'system', content: 'Instructions.\n\n<measurements>{}</measurements>' },
        { role: 'user', content: 'Write the practice notes.' },
      ],
      max_tokens: 800,
      stream: false,
      response_format: { type: 'json_schema', json_schema: { name: 'practice_notes', schema: REQUEST.jsonSchema!.schema, strict: true } },
    })
  })

  it('falls back to json_object with the schema in the instructions, and adds reasoning_effort only when set', () => {
    const body = buildRequestBody(config({ ...GEMINI, LLM_JSON_MODE: 'json_object', LLM_REASONING_EFFORT: 'low' }), REQUEST)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.reasoning_effort).toBe('low')
    expect((body.messages as { content: string }[])[0].content).toContain('"required":["a"]')
    const chat = buildRequestBody(config(GEMINI), { ...REQUEST, jsonSchema: undefined, system: 'Be brief.' })
    expect(chat).not.toHaveProperty('response_format')
    expect(chat).not.toHaveProperty('reasoning_effort')
  })
})

describe('normaliseFinishReason', () => {
  it('maps provider reasons to stop, length, content_filter or other', () => {
    expect(['stop', 'STOP'].map(normaliseFinishReason)).toEqual(['stop', 'stop'])
    expect(['length', 'MAX_TOKENS'].map(normaliseFinishReason)).toEqual(['length', 'length'])
    expect(['content_filter', 'SAFETY', 'PROHIBITED_CONTENT', 'RECITATION'].map(normaliseFinishReason)).toEqual(Array(4).fill('content_filter'))
    expect(['tool_calls', null, undefined, 'weird'].map(normaliseFinishReason)).toEqual(Array(4).fill('other'))
  })
})

describe('createLlm', () => {
  it('posts to {base}/chat/completions with a bearer key and returns text, finish reason and usage', async () => {
    const { fetch, calls } = fakeFetch(json(200, completion('stop')))
    const llm = createLlm(config(GEMINI), { fetch, ...noSleep })
    expect([llm.configured, llm.model, llm.provider]).toEqual([true, 'gemini-3.8-flash', 'gemini'])
    expect(await llm.complete(REQUEST)).toEqual({
      text: '{"a":1}',
      finishReason: 'stop',
      rawFinishReason: 'stop',
      model: 'gemini-3.8-flash',
      usage: { inputTokens: 120, outputTokens: 30 },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer test-key')
    expect(JSON.parse(String(calls[0].init.body)).model).toBe('gemini-3.8-flash')
  })

  it('reports a cut-off answer as length', async () => {
    const { fetch } = fakeFetch(json(200, completion('length', '{"a":')))
    const r = await createLlm(config(GROK), { fetch, ...noSleep }).complete(REQUEST)
    expect([r.finishReason, r.rawFinishReason, r.text]).toEqual(['length', 'length', '{"a":'])
  })

  it('reports a safety stop or a refusal field as content_filter', async () => {
    const { fetch } = fakeFetch(json(200, completion('content_filter', null)), json(200, completion('stop', null, { refusal: 'I can’t help with that.' })))
    const llm = createLlm(config(GROK), { fetch, ...noSleep })
    expect((await llm.complete(REQUEST)).finishReason).toBe('content_filter')
    const refused = await llm.complete(REQUEST)
    expect([refused.finishReason, refused.text]).toEqual(['content_filter', ''])
  })

  it('joins content parts', async () => {
    const { fetch } = fakeFetch(json(200, completion('stop', [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'there.' }])))
    expect((await createLlm(config(GROK), { fetch, ...noSleep }).complete(REQUEST)).text).toBe('Hello there.')
  })

  it('retries a 429 once after Retry-After, then succeeds', async () => {
    const waits: number[] = []
    const { fetch, calls } = fakeFetch(json(429, { error: { message: 'slow down' } }, { 'Retry-After': '2' }), json(200, completion('stop')))
    const r = await createLlm(config(GEMINI), { fetch, sleep: async (ms) => void waits.push(ms) }).complete(REQUEST)
    expect(r.finishReason).toBe('stop')
    expect(calls).toHaveLength(2)
    expect(waits).toEqual([2000])
  })

  it('gives up after one retry and passes Retry-After on', async () => {
    const { fetch, calls } = fakeFetch(json(429, {}, { 'Retry-After': '3' }), json(429, {}, { 'Retry-After': '3' }))
    const e = await failure(createLlm(config(GROK), { fetch, ...noSleep }).complete(REQUEST))
    expect([e.kind, e.status, e.retryAfterS]).toEqual(['rate_limited', 429, 3])
    expect(calls).toHaveLength(2)
  })

  it('does not wait inside the request for a long Retry-After', async () => {
    const { fetch, calls } = fakeFetch(json(429, {}, { 'Retry-After': '60' }))
    const e = await failure(createLlm(config(GROK), { fetch, ...noSleep }).complete(REQUEST))
    expect([e.kind, e.retryAfterS]).toEqual(['rate_limited', 60])
    expect(calls).toHaveLength(1)
  })

  it('retries a 5xx and a connection error once', async () => {
    const a = fakeFetch(json(503, {}), json(200, completion('stop')))
    expect((await createLlm(config(GEMINI), { fetch: a.fetch, ...noSleep }).complete(REQUEST)).finishReason).toBe('stop')
    const b = fakeFetch(json(500, {}), json(502, {}))
    expect((await failure(createLlm(config(GEMINI), { fetch: b.fetch, ...noSleep }).complete(REQUEST))).kind).toBe('unavailable')
    const c = fakeFetch(new TypeError('fetch failed'), new TypeError('fetch failed'))
    expect((await failure(createLlm(config(GEMINI), { fetch: c.fetch, ...noSleep }).complete(REQUEST))).kind).toBe('network')
    expect(c.calls).toHaveLength(2)
  })

  it('treats a rejected key as auth (401, 403, and Gemini’s 400 "API key not valid") without retrying', async () => {
    for (const res of [
      json(401, {}),
      json(403, {}),
      json(400, [{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }]),
    ]) {
      const { fetch, calls } = fakeFetch(res)
      expect((await failure(createLlm(config(GEMINI), { fetch, ...noSleep }).complete(REQUEST))).kind).toBe('auth')
      expect(calls).toHaveLength(1)
    }
    const { fetch } = fakeFetch(json(400, { error: { message: 'Unknown model' } }))
    expect((await failure(createLlm(config(GEMINI), { fetch, ...noSleep }).complete(REQUEST))).kind).toBe('bad_request')
  })

  it('times out when the provider does not answer', async () => {
    const { fetch } = fakeFetch('hang')
    const e = await failure(createLlm(config(GROK), { fetch, timeoutMs: 20, ...noSleep }).complete(REQUEST))
    expect(e.kind).toBe('timeout')
  })

  it('rejects a 200 that is not a chat completion', async () => {
    const { fetch } = fakeFetch(json(200, { hello: 'world' }))
    expect((await failure(createLlm(config(GROK), { fetch, ...noSleep }).complete(REQUEST))).kind).toBe('bad_response')
  })

  it('without configuration says so and sends nothing', async () => {
    const { fetch, calls } = fakeFetch()
    const llm = createLlm(llmConfigFromEnv(env({})), { fetch, ...noSleep })
    expect(llm.configured).toBe(false)
    expect((await failure(llm.complete(REQUEST))).kind).toBe('not_configured')
    expect(calls).toHaveLength(0)
  })
})

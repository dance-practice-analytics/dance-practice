// Validation of the request body. The conversation comes from the client, so it is
// checked and capped here: roles alternate, it starts and ends with the dancer, only the
// last MAX_MESSAGES are kept, questions over MAX_QUESTION_CHARS are refused and earlier
// replies are cut to MAX_REPLY_CHARS.

import {
  MAX_MESSAGES,
  MAX_QUESTION_CHARS,
  MAX_REPLY_CHARS,
  type ChatMessage,
  type ChatScope,
  // @ts-ignore TS5097: Deno needs the .ts extension
} from './contract.ts'

export interface ParsedRequest {
  attemptId: string
  compareAttemptId: string | null
  scope: ChatScope
  messages: ChatMessage[]
}

export type ParseResult = { ok: true; value: ParsedRequest } | { ok: false; code: 'invalid_request' | 'question_too_long' }

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const invalid: ParseResult = { ok: false, code: 'invalid_request' }

/** Keeps the last `max` messages and drops leading replies, so the history starts with the dancer. */
export function trimHistory<T extends { role: string }>(messages: readonly T[], max = MAX_MESSAGES): T[] {
  const tail = messages.slice(-max)
  const first = tail.findIndex((m) => m.role === 'user')
  return first < 0 ? [] : tail.slice(first)
}

export function parseMikaRequest(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return invalid
  const b = body as Record<string, unknown>
  if (typeof b.attempt_id !== 'string' || !UUID_RE.test(b.attempt_id)) return invalid

  let compareAttemptId: string | null = null
  if (b.compare_attempt_id !== undefined && b.compare_attempt_id !== null) {
    if (typeof b.compare_attempt_id !== 'string' || !UUID_RE.test(b.compare_attempt_id)) return invalid
    if (b.compare_attempt_id.toLowerCase() !== b.attempt_id.toLowerCase()) compareAttemptId = b.compare_attempt_id
  }

  if (b.scope !== undefined && b.scope !== 'attempt' && b.scope !== 'session') return invalid
  const scope: ChatScope = b.scope === 'session' ? 'session' : 'attempt'

  if (!Array.isArray(b.messages) || b.messages.length === 0) return invalid
  const raw: ChatMessage[] = []
  for (const m of b.messages) {
    if (typeof m !== 'object' || m === null) return invalid
    const { role, content } = m as Record<string, unknown>
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return invalid
    raw.push({ role, content })
  }

  const messages = trimHistory(raw)
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') return invalid
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (i > 0 && messages[i - 1].role === m.role) return invalid
    const text = m.content.trim()
    if (text.length === 0) return invalid
    if (m.role === 'user') {
      if (text.length > MAX_QUESTION_CHARS) return { ok: false, code: 'question_too_long' }
      messages[i] = { role: 'user', content: text }
    } else {
      messages[i] = { role: 'assistant', content: text.length > MAX_REPLY_CHARS ? `${text.slice(0, MAX_REPLY_CHARS)}…` : text }
    }
  }

  return { ok: true, value: { attemptId: b.attempt_id, compareAttemptId, scope, messages } }
}

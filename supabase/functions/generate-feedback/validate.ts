// Output format sent to the model and validation of what comes back (FR-3.7.3). Nothing
// is stored unless it passes `parseFeedback`.

import {
  CONFIDENCE_LEVELS,
  DISCLAIMER,
  MAX_OBSERVATIONS,
  METRIC_KEYS,
  MIN_OBSERVATIONS,
  SUMMARY_MAX_CHARS,
  type FeedbackObservation,
  type FeedbackResponse,
  type MetricKey,
  // @ts-ignore TS5097: Deno needs the .ts extension
} from './contract.ts'
// @ts-ignore TS5097: Deno needs the .ts extension
import type { FeedbackPayload } from './payload.ts'

/**
 * JSON schema sent as `response_format` (json_schema, strict). Providers do not all enforce
 * lengths or item counts, and some follow a schema only on a best-effort basis, so those
 * limits are stated in the prompt and everything is checked again in `parseFeedback`.
 */
export const FEEDBACK_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    observations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          metric: { type: 'string', enum: [...METRIC_KEYS] },
          observation: { type: 'string' },
          suggestion: { type: 'string' },
          confidence: { type: 'string', enum: [...CONFIDENCE_LEVELS] },
        },
        required: ['metric', 'observation', 'suggestion', 'confidence'],
        additionalProperties: false,
      },
    },
    cautions: { type: 'array', items: { type: 'string' } },
    disclaimer: { type: 'string' },
  },
  required: ['summary', 'observations', 'cautions', 'disclaimer'],
  additionalProperties: false,
} as const

export const MAX_TEXT_CHARS = 600
export const MAX_CAUTIONS = 5

/** Wording the notes must never contain: a score or a grade (CLAUDE.md hard rule, FR-3.7.4). */
const GRADING_PATTERNS: RegExp[] = [
  /\b\d+(\.\d+)?\s*(\/|out of)\s*(5|10|100)\b/i,
  /\b(score|scores|scored|grade|grades|graded|rating|ratings|rated)\b/i,
]

export type ParseResult = { ok: true; value: FeedbackResponse } | { ok: false; reason: string }

const fail = (reason: string): ParseResult => ({ ok: false, reason })

function text(v: unknown, max = MAX_TEXT_CHARS): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 && t.length <= max ? t : null
}

/** Shortens an over-long summary at a sentence end, or at a word with an ellipsis. */
export function clampSummary(summary: string, max = SUMMARY_MAX_CHARS): string {
  if (summary.length <= max) return summary
  const head = summary.slice(0, max)
  const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
  if (sentenceEnd >= max / 3) return head.slice(0, sentenceEnd + 1)
  const cut = head.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '')}…`
}

/**
 * Parses the model's text and checks it against the contract and the payload it was
 * given. Two fields are not left to the model: `confidence` is taken from the payload
 * and `disclaimer` is always the fixed text.
 */
export function parseFeedback(raw: string, payload: FeedbackPayload): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return fail('not JSON')
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return fail('not an object')
  const r = data as Record<string, unknown>

  const summary = text(r.summary, 2 * SUMMARY_MAX_CHARS)
  if (!summary) return fail('summary missing or too long')

  if (!Array.isArray(r.observations)) return fail('observations is not a list')
  if (r.observations.length < MIN_OBSERVATIONS || r.observations.length > MAX_OBSERVATIONS) {
    return fail(`observations must have ${MIN_OBSERVATIONS} to ${MAX_OBSERVATIONS} items`)
  }
  const sent = new Map(payload.metrics.map((m) => [m.metric as string, m]))
  const seen = new Set<MetricKey>()
  const observations: FeedbackObservation[] = []
  for (const o of r.observations) {
    if (typeof o !== 'object' || o === null) return fail('observation is not an object')
    const obs = o as Record<string, unknown>
    const metric = typeof obs.metric === 'string' ? sent.get(obs.metric) : undefined
    if (!metric) return fail('observation about a metric that was not sent')
    if (seen.has(metric.metric)) return fail('two observations about the same metric')
    seen.add(metric.metric)
    const observation = text(obs.observation)
    const suggestion = text(obs.suggestion)
    if (!observation || !suggestion) return fail('observation text missing or too long')
    observations.push({ metric: metric.metric, observation, suggestion, confidence: metric.confidence })
  }

  if (!Array.isArray(r.cautions) || r.cautions.length > MAX_CAUTIONS) return fail('cautions is not a short list')
  const cautions: string[] = []
  for (const c of r.cautions) {
    const caution = text(c)
    if (!caution) return fail('caution text missing or too long')
    cautions.push(caution)
  }

  const all = [summary, ...observations.flatMap((o) => [o.observation, o.suggestion]), ...cautions].join('\n')
  if (GRADING_PATTERNS.some((p) => p.test(all))) return fail('contains a score or a grade')

  return { ok: true, value: { summary: clampSummary(summary), observations, cautions, disclaimer: DISCLAIMER } }
}

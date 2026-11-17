// Output format sent to the model and validation of what comes back (FR-3.7.3). Nothing
// is stored unless it passes `parseFeedback`.

import {
  CONFIDENCE_LEVELS,
  DISCLAIMER,
  MAX_OBSERVATIONS,
  MIN_OBSERVATIONS,
  NOTE_TOPICS,
  SUMMARY_MAX_CHARS,
  type FeedbackObservation,
  type FeedbackResponse,
  type NoteTopic,
  // @ts-ignore TS5097: Deno needs the .ts extension
} from './contract.ts'
// @ts-ignore TS5097: Deno needs the .ts extension
import { noteTopics, type FeedbackPayload } from './payload.ts'

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
          metric: { type: 'string', enum: [...NOTE_TOPICS] },
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

/**
 * Wording the notes must never contain (CLAUDE.md hard rule, FR-3.7.4): a score or a
 * grade, and verdict words that judge the dancing (good/bad, better/worse, correct/
 * incorrect, improved...). Checked on every note, relevé or phrase, in English and in the
 * other languages the notes can be written in. Neutral direction words (higher, lower,
 * longer, further, more, less) are not in the list. A false positive only means the
 * dancer is asked to try again; a verdict that slips through can't be taken back.
 */
export const GRADING_PATTERNS: RegExp[] = [
  /\b\d+(\.\d+)?\s*(\/|out of|de|sur|von|su)\s*(5|10|20|100)\b/i,
  /\b(score|scores|scored|scoring|grade|grades|graded|grading|rating|ratings|rated|rank|ranks|ranked|ranking)\b/i,
  // English verdicts
  /\b(good|bad|better|best|worse|worst|correct|correctly|incorrect|incorrectly|wrong|right way|perfect|perfectly|excellent|great|poor|poorly|ideal|flawless|sloppy|mistake|mistakes|improved|improvement|improvements|regressed|declined|well done|nice work|great job)\b/i,
  // Spanish verdicts
  /(?<![\p{L}])(bien|mal|malo|mala|buen|bueno|buena|mejor|mejores|mejora|mejoras|mejoró|mejorado|mejorada|peor|peores|empeoró|correcto|correcta|correctamente|incorrecto|incorrecta|incorrectamente|perfecto|perfecta|excelente|errores|error|ideal|puntuación|puntaje|calificación)(?![\p{L}])/iu,
]

/** True when the text grades the dancing (see GRADING_PATTERNS). */
export function containsGrading(text: string): boolean {
  return GRADING_PATTERNS.some((p) => p.test(text))
}

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
  // Relevé metrics or phrase themes, whichever this payload carries.
  const sent = noteTopics(payload)
  const seen = new Set<NoteTopic>()
  const observations: FeedbackObservation[] = []
  for (const o of r.observations) {
    if (typeof o !== 'object' || o === null) return fail('observation is not an object')
    const obs = o as Record<string, unknown>
    const topic = typeof obs.metric === 'string' && sent.has(obs.metric) ? (obs.metric as NoteTopic) : null
    if (!topic) return fail('observation about a metric that was not sent')
    if (seen.has(topic)) return fail('two observations about the same metric')
    seen.add(topic)
    const observation = text(obs.observation)
    const suggestion = text(obs.suggestion)
    if (!observation || !suggestion) return fail('observation text missing or too long')
    observations.push({ metric: topic, observation, suggestion, confidence: sent.get(topic)! })
  }

  if (!Array.isArray(r.cautions) || r.cautions.length > MAX_CAUTIONS) return fail('cautions is not a short list')
  const cautions: string[] = []
  for (const c of r.cautions) {
    const caution = text(c)
    if (!caution) return fail('caution text missing or too long')
    cautions.push(caution)
  }

  const all = [summary, ...observations.flatMap((o) => [o.observation, o.suggestion]), ...cautions].join('\n')
  if (containsGrading(all)) return fail('contains a score, a grade or a verdict')

  return { ok: true, value: { summary: clampSummary(summary), observations, cautions, disclaimer: DISCLAIMER } }
}

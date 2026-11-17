// The measurements Mika answers from (FR-3.7.2, NFR-1/2). Built from attempt_metrics rows
// through generate-feedback's buildPayload, so the same allowlist applies: metric id,
// value, unit, phases, confidence and the reason a value is missing. No ids, titles, file
// names, subject codes, keypoints, frames or video ever enter it. Attempts are named only
// by their number in the session ("Attempt 3").

// @ts-ignore TS5097: Deno needs the .ts extension
import type { ConfidenceLevel, MetricKey } from '../generate-feedback/contract.ts'
// @ts-ignore TS5097: Deno needs the .ts extension
import { buildPayload, type MetricNote, type MetricsRowLike, type NullReason, type Phase } from '../generate-feedback/payload.ts'

/**
 * Plain names, as the app shows them (src/insights/catalog.ts; a test keeps them equal),
 * the unit Mika should use and what each metric measures in dance-class words.
 */
export const METRIC_DEFINITIONS: Record<MetricKey, { name: string; unit: string; measures: string }> = {
  trunk_inclination_deg: {
    name: 'Torso lean',
    unit: 'degrees',
    measures: 'How far the torso tips away from straight up, from the hips to the shoulders. 0 degrees is fully upright.',
  },
  pelvis_ankle_offset_norm: {
    name: 'Hips over your foot',
    unit: 'percent of leg length',
    measures: 'How far the hips sit to the side of the supporting foot, as a share of leg length. 0 percent is hips right over the foot.',
  },
  balance_duration_s: {
    name: 'Time on relevé',
    unit: 'seconds',
    measures: 'The longest stretch of the hold with the heel lifted and the hips steady over the supporting foot.',
  },
  knee_tracking_dev_deg: {
    name: 'Knee over toes',
    unit: 'degrees',
    measures: 'The angle between where the knee points and where the toes point, seen from above, while the knee is bent. 0 degrees means they point the same way.',
  },
  turn_count: {
    name: 'Turns',
    unit: 'turns',
    measures: 'Rotations completed, counted in quarter turns (pirouette only).',
  },
}

export const MOVEMENT_NAMES: Record<string, string> = {
  releve_balance: 'Relevé balance (a rise onto the balls of the feet in parallel, held)',
  pirouette: 'Pirouette',
}

export interface MikaMetric {
  metric: MetricKey
  name: string
  /** null = not measured; never zero-filled. */
  value: number | null
  unit: string
  confidence: ConfidenceLevel
  phases: Phase[]
  not_measured_reason?: NullReason
  notes?: MetricNote[]
}

export type AttemptRole = 'asked_about' | 'comparison' | 'same_session'

export interface MikaAttempt {
  /** "Attempt 3", or a neutral name when the number is not known. */
  label: string
  role: AttemptRole
  metrics: MikaMetric[]
  phases: { phase: Phase; duration_s: number }[]
}

export interface MikaContext {
  movement: string
  metric_definitions: { metric: MetricKey; name: string; unit: string; measures: string }[]
  attempts: MikaAttempt[]
}

export interface AttemptInput {
  row: MetricsRowLike
  /** 1-based position in its session (created_at order), when known. */
  number?: number
}

const round = (v: number, decimals: number) => {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

const FALLBACK_LABEL: Record<AttemptRole, string> = {
  asked_about: 'This attempt',
  comparison: 'Comparison attempt',
  same_session: 'Another attempt in this session',
}

function attemptOf(input: AttemptInput, role: AttemptRole): MikaAttempt {
  const payload = buildPayload(input.row)
  const metrics = payload.metrics.map((m): MikaMetric => {
    const def = METRIC_DEFINITIONS[m.metric]
    // The app shows "hips over your foot" as a percentage; Mika uses the same number.
    const value = m.value === null ? null : m.metric === 'pelvis_ankle_offset_norm' ? round(m.value * 100, 1) : m.value
    const out: MikaMetric = { metric: m.metric, name: def.name, value, unit: def.unit, confidence: m.confidence, phases: m.phases }
    if (m.not_measured_reason) out.not_measured_reason = m.not_measured_reason
    if (m.notes) out.notes = m.notes
    return out
  })
  const label = typeof input.number === 'number' && input.number > 0 ? `Attempt ${input.number}` : FALLBACK_LABEL[role]
  return { label, role, metrics, phases: payload.phases }
}

/**
 * `target` is the attempt the dancer asks about. `compare` is one other attempt (scope
 * 'attempt'); `session` are the other analyzed attempts of the same session (scope
 * 'session'). Rows of another movement are left out. Throws when the target's movement
 * is not one the app knows.
 */
export function buildMikaContext(target: AttemptInput, compare: AttemptInput | null = null, session: AttemptInput[] = []): MikaContext {
  const asked = attemptOf(target, 'asked_about')
  const movement = target.row.movement
  const same = (a: AttemptInput) => a.row.movement === movement
  const attempts: MikaAttempt[] = [asked]
  if (compare && same(compare)) attempts.push(attemptOf(compare, 'comparison'))
  const others = session
    .filter(same)
    .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity))
    .map((a) => attemptOf(a, 'same_session'))
  attempts.push(...others)

  const used = new Set(attempts.flatMap((a) => a.metrics.map((m) => m.metric)))
  const metric_definitions = (Object.keys(METRIC_DEFINITIONS) as MetricKey[])
    .filter((k) => used.has(k))
    .map((k) => ({ metric: k, ...METRIC_DEFINITIONS[k] }))

  return { movement: MOVEMENT_NAMES[movement] ?? movement, metric_definitions, attempts }
}

// Analytical export (Development Document 1.9): per-attempt metric samples with
// source timestamps, units, validity flags and quality reasons. Missing values
// stay explicit: null in JSON, an empty cell plus the flag in CSV.

import type { SessionResults } from '../types'
import { phaseAt } from './attempts'
import { appliesIn } from './series'

export interface ExportRow {
  attempt_id: string
  attempt_index: number
  source_time_s: number
  attempt_time_s: number
  phase: string
  metric: string
  metric_version: string
  unit: string
  value: number | null
  valid: boolean
  quality_reason: string | null
}

export function exportRows(results: SessionResults): ExportRow[] {
  const { fps } = results.session
  const rows: ExportRow[] = []
  for (const a of results.attempts) {
    for (let i = Math.round(a.start * fps); i < Math.round(a.end * fps); i++) {
      const t = i / fps
      const phase = phaseAt(a, t)
      for (const m of results.metrics) {
        const s = results.series[m.id][i]
        if (!s) continue
        const applies = appliesIn(m, phase?.id)
        const reason = !applies ? 'not_measured_in_phase' : s.quality === 'missing' ? 'no_pose_tracked' : s.quality === 'low' ? 'low_tracking_confidence' : null
        rows.push({
          attempt_id: a.id,
          attempt_index: a.index,
          source_time_s: +t.toFixed(4),
          attempt_time_s: +(t - a.start).toFixed(4),
          phase: phase?.id ?? 'outside_phases',
          metric: m.id,
          metric_version: m.version,
          unit: m.unit,
          value: applies && s.value !== null ? +s.value.toFixed(4) : null,
          valid: reason === null,
          quality_reason: reason,
        })
      }
    }
  }
  return rows
}

export function exportJson(results: SessionResults, processingRun: string): string {
  const { session } = results
  return JSON.stringify(
    {
      session_id: session.id,
      participant: session.participant,
      movement: session.movement,
      boundary_revision: session.boundaryRevision,
      processing_run: processingRun,
      synthetic: session.synthetic,
      metrics: results.metrics.map(({ id, version, name, unit, reading }) => ({ id, version, name, unit, reading })),
      samples: exportRows(results),
    },
    null,
    1,
  )
}

export function exportCsv(results: SessionResults): string {
  const rows = exportRows(results)
  const cols = Object.keys(rows[0] ?? { attempt_id: '' }) as (keyof ExportRow)[]
  const cell = (v: unknown) => (v === null ? '' : String(v))
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n')
}

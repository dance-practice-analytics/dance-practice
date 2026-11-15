// The researcher's CSV (FR-3.9.2): one row per study attempt, by subject code.
// Built from the export document of src/data/exportData.ts, so the same field rules
// hold: no video, path, hash, email, name or typed text. A value that is not available
// is an empty cell next to its reason; a low-confidence value is written with its
// level, never dropped and never 0.

import { EXPORT_METRICS, csvCell, type ExportDocument } from '../../../data/exportData'

export interface DatasetCsvOptions {
  /** Confidence level and score next to every value. */
  confidence: boolean
  /** Start and end of every phase, in seconds. */
  phases: boolean
}

const PHASES = ['prep', 'rise', 'hold', 'turn', 'finish', 'recovery'] as const

export function datasetCsvColumns(options: DatasetCsvOptions): string[] {
  const cols = ['subject_code', 'clip', 'movement', 'camera_view', 'recorded_on', 'session_id', 'attempt_id', 'attempt_status', 'status_reason', 'duration_s', 'fps']
  for (const { metric } of EXPORT_METRICS) {
    cols.push(metric, `${metric}_unit`, `${metric}_null_reason`)
    if (options.confidence) cols.push(`${metric}_confidence_level`, `${metric}_confidence_score`)
  }
  if (options.phases) for (const p of PHASES) cols.push(`${p}_start_s`, `${p}_end_s`)
  cols.push('algorithm_version', 'computed_at')
  return cols
}

/**
 * `clipOf` maps an attempt id to its place in the grid ('C04'); an attempt that is
 * not in it gets an empty cell. Rows are ordered by subject code, then clip.
 */
export function datasetCsv(document: ExportDocument, clipOf: ReadonlyMap<string, string>, options: DatasetCsvOptions): string {
  const columns = datasetCsvColumns(options)
  const rows: Record<string, unknown>[] = []
  for (const s of document.sessions) {
    for (const a of s.attempts) {
      if (a.source !== 'study_dataset') continue
      const row: Record<string, unknown> = {
        subject_code: s.subject_code,
        clip: clipOf.get(a.id) ?? null,
        movement: a.metrics_run?.movement ?? s.movement_type,
        camera_view: s.camera_view,
        recorded_on: s.recorded_on,
        session_id: s.id,
        attempt_id: a.id,
        attempt_status: a.status,
        status_reason: a.status_reason,
        duration_s: a.duration_s,
        fps: a.fps,
        algorithm_version: a.metrics_run?.algorithm_version ?? null,
        computed_at: a.metrics_run?.computed_at ?? null,
      }
      for (const m of a.metrics) {
        row[m.metric] = m.value
        row[`${m.metric}_unit`] = m.unit
        row[`${m.metric}_null_reason`] = m.null_reason
        row[`${m.metric}_confidence_level`] = m.confidence_level
        row[`${m.metric}_confidence_score`] = m.confidence_score
      }
      for (const p of a.phases ?? []) {
        // The first span of a phase; the engine writes each phase once.
        if (row[`${p.phase}_start_s`] === undefined) {
          row[`${p.phase}_start_s`] = p.start
          row[`${p.phase}_end_s`] = p.end
        }
      }
      rows.push(row)
    }
  }
  const text = (v: unknown) => (v == null ? '￿' : String(v))
  rows.sort((a, b) => text(a.subject_code).localeCompare(text(b.subject_code)) || text(a.clip).localeCompare(text(b.clip)))
  const lines = [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))]
  return lines.join('\r\n') + '\r\n'
}

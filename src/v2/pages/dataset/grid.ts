// View-model of the study dataset grid (FR-3.2.8): subjects by clip, each cell with
// its processing status and, once done, the tracking confidence of the measurement.
// Pure. Rows are always in subject-code order and nothing here reads a metric value,
// so the grid cannot rank anyone. A place without a clip is null, never a zero.

import { SUBJECT_CODE_RE, type CameraView, type MovementType } from '../../../data/schema'
import type { AttemptView } from '../../data'
import { MOVEMENT_LABELS, readMetrics } from '../../format'

/** The study plan: 12 subjects, 10 relevé balances and 5 pirouettes each. */
export const PLANNED_SUBJECTS = 12
export const PLANNED_CLIPS: Record<MovementType, number> = { releve_balance: 10, pirouette: 5 }
export const PLANNED_TOTAL = PLANNED_SUBJECTS * (PLANNED_CLIPS.releve_balance + PLANNED_CLIPS.pirouette)
export const MOVEMENT_ORDER: MovementType[] = ['releve_balance', 'pirouette']
/** Row for study clips whose session has no subject code. */
export const NO_CODE = 'No code'

export type CellKind = 'done-high' | 'done-med' | 'done-low' | 'done-none' | 'processing' | 'queued' | 'failed'
export type StatusGroup = 'done' | 'processing' | 'queued' | 'failed'

export const KIND_TEXT: Record<CellKind, string> = {
  'done-high': 'done, high tracking confidence',
  'done-med': 'done, medium tracking confidence',
  'done-low': 'done, low tracking confidence',
  'done-none': 'done, nothing could be tracked',
  processing: 'processing',
  queued: 'queued',
  failed: 'failed',
}

/** Pill text of the detail panel. */
export const KIND_SHORT: Record<CellKind, string> = {
  'done-high': 'Done · high',
  'done-med': 'Done · medium',
  'done-low': 'Done · low conf.',
  'done-none': 'Done · no tracking',
  processing: 'Processing',
  queued: 'Queued',
  failed: 'Failed',
}

/** The design's `.cell` modifier; "no tracking" is the dashed, hatched cell with a dash in it. */
export const KIND_CLASS: Record<CellKind, string> = {
  'done-high': 'done-high',
  'done-med': 'done-med',
  'done-low': 'done-low',
  'done-none': 'done-low',
  processing: 'processing',
  queued: 'queued',
  failed: 'failed',
}

export const KIND_GLYPH: Partial<Record<CellKind, string>> = { failed: '!', 'done-none': '–' }

export const groupOf = (kind: CellKind): StatusGroup => (kind.startsWith('done') ? 'done' : (kind as StatusGroup))

/**
 * Status and confidence of one clip. Confidence is the lowest level among the values
 * that were measured: it describes how well the recording was tracked, not the dancer.
 * A row still marked 'processing' that this tab isn't working on was left by a closed
 * tab, so it counts as queued.
 */
export function cellKind(attempt: AttemptView, live: ReadonlySet<string> = new Set()): CellKind {
  if (attempt.status === 'failed') return 'failed'
  if (attempt.status === 'processing') return live.has(attempt.id) ? 'processing' : 'queued'
  if (attempt.status === 'queued') return live.has(attempt.id) ? 'processing' : 'queued'
  const levels = readMetrics(attempt.metrics, attempt.session.movement_type)
    .filter((m) => m.value !== null)
    .map((m) => m.confidence)
  if (levels.length === 0) return 'done-none'
  if (levels.includes('low')) return 'done-low'
  return levels.includes('medium') ? 'done-med' : 'done-high'
}

export interface GridCell {
  attempt: AttemptView
  kind: CellKind
  /** 1-based column over the whole grid; the clip label is C01, C02, … */
  slot: number
  clip: string
}

export interface GridRow {
  code: string
  /** One entry per column; null where the subject has no clip. */
  cells: (GridCell | null)[]
  done: number
  clips: number
}

export interface GridGroup {
  movement: MovementType
  label: string
  /** Slots `first` … `first + count - 1`. */
  first: number
  count: number
}

export interface Grid {
  groups: GridGroup[]
  columns: number
  rows: GridRow[]
  counts: Record<StatusGroup, number> & { clips: number }
  /** Clips of this account that are not study clips, and so not in the grid. */
  personal: number
}

export const clipLabel = (slot: number) => `C${String(slot).padStart(2, '0')}`

export function buildGrid(attempts: readonly AttemptView[], live: ReadonlySet<string> = new Set()): Grid {
  const study = attempts.filter((a) => a.source === 'study_dataset')
  const codeOf = (a: AttemptView) => (a.session.subject_code && SUBJECT_CODE_RE.test(a.session.subject_code) ? a.session.subject_code : NO_CODE)

  // Per subject and movement, in import order (oldest session first).
  const bySubject = new Map<string, Record<MovementType, AttemptView[]>>()
  const ordered = [...study].sort(
    (a, b) =>
      a.session.created_at.localeCompare(b.session.created_at) || a.session_id.localeCompare(b.session_id) || a.number - b.number,
  )
  for (const a of ordered) {
    const lists = bySubject.get(codeOf(a)) ?? { releve_balance: [], pirouette: [] }
    lists[a.session.movement_type].push(a)
    bySubject.set(codeOf(a), lists)
  }

  // The planned columns, widened only when a subject has more clips than planned.
  const groups: GridGroup[] = []
  let first = 1
  for (const movement of MOVEMENT_ORDER) {
    let count = PLANNED_CLIPS[movement]
    for (const lists of bySubject.values()) count = Math.max(count, lists[movement].length)
    groups.push({ movement, label: MOVEMENT_LABELS[movement], first, count })
    first += count
  }
  const columns = first - 1

  const planned = Array.from({ length: PLANNED_SUBJECTS }, (_, i) => `S${String(i + 1).padStart(2, '0')}`)
  const extra = [...bySubject.keys()].filter((c) => c !== NO_CODE && !planned.includes(c)).sort()
  const codes = [...planned, ...extra, ...(bySubject.has(NO_CODE) ? [NO_CODE] : [])]

  const counts = { done: 0, processing: 0, queued: 0, failed: 0, clips: study.length }
  const rows = codes.map((code): GridRow => {
    const lists = bySubject.get(code)
    const cells: (GridCell | null)[] = new Array(columns).fill(null)
    let done = 0
    let clips = 0
    for (const g of groups) {
      ;(lists?.[g.movement] ?? []).forEach((attempt, i) => {
        const slot = g.first + i
        const kind = cellKind(attempt, live)
        cells[slot - 1] = { attempt, kind, slot, clip: clipLabel(slot) }
        counts[groupOf(kind)]++
        clips++
        if (groupOf(kind) === 'done') done++
      })
    }
    return { code, cells, done, clips }
  })

  return { groups, columns, rows, counts, personal: attempts.length - study.length }
}

export interface GridFilter {
  status: StatusGroup | 'all'
  view: CameraView | 'all'
}

export function matchesFilter(cell: GridCell, filter: GridFilter): boolean {
  if (filter.status !== 'all' && groupOf(cell.kind) !== filter.status) return false
  return filter.view === 'all' || cell.attempt.session.camera_view === filter.view
}

/** "S04: 9 of 10 clips done, 1 failed" — the words behind a row of small cells. */
export function rowSummary(row: GridRow): string {
  if (row.clips === 0) return `${row.code}: no clips imported`
  const other: Partial<Record<StatusGroup, number>> = {}
  for (const c of row.cells) if (c && groupOf(c.kind) !== 'done') other[groupOf(c.kind)] = (other[groupOf(c.kind)] ?? 0) + 1
  const rest = (['processing', 'queued', 'failed'] as const).filter((k) => other[k]).map((k) => `${other[k]} ${k}`)
  return `${row.code}: ${row.done} of ${row.clips} ${row.clips === 1 ? 'clip' : 'clips'} done${rest.length ? `, ${rest.join(', ')}` : ''}`
}

// Screen 12 — Study dataset overview, researcher only (FR-3.2.8, FR-3.2.9, FR-3.9.2).
// Design: Dataset.dc.html (wide), DatasetMobile.dc.html (phone); patterns in States.dc.html.
// Coverage and processing / tracking status of the account's own study clips (RLS: the
// dataset this researcher imported). Subjects stay in code order; nothing is sorted or
// coloured by a metric value. A subject without a clip in a column has an empty cell.
// Differences from the design: the denominator is the clips really imported (180 is
// shown as the plan), a "no clip" and a "no tracking" cell exist, status / view filters
// were added, and raw keypoints are offered in Settings instead of inside the CSV.

import { useMemo, useState } from 'react'
import type { ApiError } from '../../api/errors'
import { exportAll } from '../../data/exportData'
import { dataError } from '../../data/repo'
import { CAMERA_VIEWS, type CameraView } from '../../data/schema'
import { client, useAuth } from '../auth'
import { hasClip } from '../clips'
import { Alert, EmptyState, ErrorAlert, Icon, PageHeader, Skeleton, Spinner } from '../components'
import { invalidate, useLibrary } from '../data'
import { STATUS_LABELS, VIEW_LABELS, formatMetricWithUnit, readMetrics } from '../format'
import { enqueue, usePipeline } from '../pipeline'
import { href, navigate } from '../router'
import { useIsNarrow } from '../useIsNarrow'
import { datasetCsv } from './dataset/csv'
import {
  KIND_CLASS,
  KIND_GLYPH,
  KIND_SHORT,
  KIND_TEXT,
  NO_CODE,
  PLANNED_TOTAL,
  buildGrid,
  clipLabel,
  groupOf,
  matchesFilter,
  rowSummary,
  type CellKind,
  type Grid,
  type GridCell,
  type GridFilter,
  type GridRow,
  type StatusGroup,
} from './dataset/grid'
import { rerunMetrics } from './dataset/rerun'
import { fileDay, saveText } from './settings/download'
import './dataset/dataset.css'

const STATUS_GROUPS: StatusGroup[] = ['done', 'processing', 'queued', 'failed']
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const LEGEND: { kind: CellKind | 'empty'; label: string }[] = [
  { kind: 'done-high', label: 'High' },
  { kind: 'done-med', label: 'Medium' },
  { kind: 'done-low', label: 'Low conf.' },
  { kind: 'done-none', label: 'No tracking' },
  { kind: 'processing', label: 'Processing' },
  { kind: 'queued', label: 'Queued' },
  { kind: 'failed', label: 'Failed' },
  { kind: 'empty', label: 'No clip' },
]

function Legend({ size = 16 }: { size?: number }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 12px', alignItems: 'center' }} className="t-caption">
      {LEGEND.map(({ kind, label }) => (
        <span key={kind} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          {kind === 'empty' ? (
            <span className="v2-ds-empty" style={{ width: size, height: size }} aria-hidden="true">
              ·
            </span>
          ) : (
            <span className={`cell ${KIND_CLASS[kind]} v2-ds-key`} style={{ width: size, height: size }} aria-hidden="true">
              {KIND_GLYPH[kind]}
            </span>
          )}
          {label}
        </span>
      ))}
    </div>
  )
}

function StatusWord({ kind }: { kind: CellKind }) {
  return (
    <span className={`status st-${groupOf(kind)}`}>
      <span className="dot" aria-hidden="true" />
      {KIND_SHORT[kind]}
    </span>
  )
}

function Filters({ filter, onChange }: { filter: GridFilter; onChange(next: GridFilter): void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', alignItems: 'center' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} role="group" aria-label="Show status">
        {(['all', ...STATUS_GROUPS] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={filter.status === s ? 'chip on' : 'chip'}
            aria-pressed={filter.status === s}
            onClick={() => onChange({ ...filter, status: s })}
          >
            {s === 'all' ? 'All statuses' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <label className="t-caption" htmlFor="ds-view">
          Camera view
        </label>
        <select
          className="input input-sm"
          id="ds-view"
          style={{ width: 'auto' }}
          value={filter.view}
          onChange={(e) => onChange({ ...filter, view: e.target.value as CameraView | 'all' })}
        >
          <option value="all">All views</option>
          {CAMERA_VIEWS.map((v) => (
            <option key={v} value={v}>
              {VIEW_LABELS[v]}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

// ---------- wide: the table of cells ----------

function GridTable(props: { grid: Grid; filter: GridFilter; selectedId: string | null; onPick(cell: GridCell): void }) {
  const { grid, filter } = props
  return (
    <div className="v2-ds-scroll">
      <table className="v2-ds-grid" aria-label={`Processing status and tracking confidence for ${plural(grid.counts.clips, 'clip')}`}>
        <colgroup>
          <col style={{ width: 60 }} />
          {Array.from({ length: grid.columns }, (_, i) => (
            <col key={i} />
          ))}
          <col style={{ width: 56 }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" rowSpan={2}>
              <span className="v2-sr">Subject</span>
            </th>
            {grid.groups.map((g) => (
              <th key={g.movement} scope="colgroup" colSpan={g.count} className="t-caption v2-ds-group">
                {g.label} · {clipLabel(g.first)}–{clipLabel(g.first + g.count - 1)}
              </th>
            ))}
            <th scope="col" rowSpan={2} className="t-caption v2-ds-r">
              Done
            </th>
          </tr>
          <tr>
            {Array.from({ length: grid.columns }, (_, i) => (
              <th key={i} scope="col" className="v2-ds-num">
                <span className="v2-sr">Clip </span>
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.code}>
              <th scope="row">
                {row.code === NO_CODE ? (
                  <span className="subj" title="Study clips whose session has no subject code">
                    <span aria-hidden="true">—</span>
                    <span className="v2-sr">No subject code</span>
                  </span>
                ) : (
                  <span className="subj">{row.code}</span>
                )}
              </th>
              {row.cells.map((cell, i) =>
                cell ? (
                  <td key={i}>
                    <button
                      type="button"
                      className={[
                        'cell',
                        KIND_CLASS[cell.kind],
                        cell.attempt.id === props.selectedId ? 'v2-ds-sel' : '',
                        matchesFilter(cell, filter) ? '' : 'v2-ds-dim',
                      ].join(' ')}
                      aria-label={`${row.code} clip ${cell.clip}: ${KIND_TEXT[cell.kind]}`}
                      aria-pressed={cell.attempt.id === props.selectedId}
                      title={`${row.code} ${cell.clip} · ${KIND_SHORT[cell.kind]}`}
                      onClick={() => props.onPick(cell)}
                    >
                      {KIND_GLYPH[cell.kind]}
                    </button>
                  </td>
                ) : (
                  <td key={i}>
                    <span className="v2-ds-empty" aria-hidden="true">
                      ·
                    </span>
                    <span className="v2-sr">No clip</span>
                  </td>
                ),
              )}
              <td className="t-small num muted v2-ds-r">
                {row.clips > 0 ? (
                  `${row.done}/${row.clips}`
                ) : (
                  <>
                    <span aria-hidden="true">—</span>
                    <span className="v2-sr">No clips</span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- phone: one row per subject ----------

function Strip({ cells, filter }: { cells: (GridCell | null)[]; filter: GridFilter }) {
  return (
    <span className="v2-ds-strip" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }} aria-hidden="true">
      {cells.map((c, i) =>
        c ? (
          <span key={i} className={`cell ${KIND_CLASS[c.kind]} ${matchesFilter(c, filter) ? '' : 'v2-ds-dim'}`}>
            {KIND_GLYPH[c.kind]}
          </span>
        ) : (
          <span key={i} className="v2-ds-empty">
            ·
          </span>
        ),
      )}
    </span>
  )
}

function MiniTable(props: { grid: Grid; filter: GridFilter; openCode: string | null; onOpen(code: string | null): void }) {
  const { grid } = props
  const [rel, pir] = grid.groups
  return (
    <div className="card v2-ds-scroll">
      <table className="v2-ds-mini" aria-label={`Processing status for ${plural(grid.counts.clips, 'clip')} by subject`}>
        <colgroup>
          <col style={{ width: 66 }} />
          <col />
        </colgroup>
        <thead>
          <tr className="t-caption">
            <th scope="col">Code</th>
            <th scope="col">
              <span className="v2-ds-pair">
                <span style={{ flex: rel.count }}>
                  Relevé {clipLabel(rel.first)}–{String(rel.count).padStart(2, '0')}
                </span>
                <span style={{ flex: pir.count }}>
                  Pir. {pir.first}–{pir.first + pir.count - 1}
                </span>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.code}>
              <th scope="row">
                <button
                  type="button"
                  className="subj v2-ds-subjbtn"
                  aria-expanded={props.openCode === row.code}
                  aria-label={rowSummary(row)}
                  disabled={row.clips === 0}
                  onClick={() => props.onOpen(props.openCode === row.code ? null : row.code)}
                >
                  {row.code === NO_CODE ? <span aria-hidden="true">—</span> : row.code}
                </button>
              </th>
              <td>
                <span className="v2-ds-pair">
                  <span style={{ flex: rel.count }}>
                    <Strip cells={row.cells.slice(rel.first - 1, rel.first - 1 + rel.count)} filter={props.filter} />
                  </span>
                  <span style={{ flex: pir.count }}>
                    <Strip cells={row.cells.slice(pir.first - 1, pir.first - 1 + pir.count)} filter={props.filter} />
                  </span>
                </span>
                <span className="v2-sr">{rowSummary(row)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SubjectClips({ row }: { row: GridRow }) {
  const cells = row.cells.filter((c): c is GridCell => c !== null)
  return (
    <section className="card" aria-label={`Clips of ${row.code}`} aria-live="polite">
      <p className="t-caption" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
        {rowSummary(row)}
      </p>
      <ul className="v2-ds-cliplist">
        {cells.map((c) => (
          <li key={c.attempt.id}>
            <a href={c.kind.startsWith('done') ? href({ name: 'review', attemptId: c.attempt.id }) : href({ name: 'library', sessionId: c.attempt.session_id })}>
              <span className="mono t-small" style={{ width: 34 }}>
                {c.clip}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <StatusWord kind={c.kind} />
              </span>
              <span className="t-caption">{c.kind.startsWith('done') ? 'Review' : 'Library'}</span>
              <Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------- detail of the selected clip ----------

function ClipDetail(props: { code: string; cell: GridCell; busy: boolean; onRerun(): void }) {
  const { cell } = props
  const a = cell.attempt
  const done = cell.kind.startsWith('done')
  const readings = done ? readMetrics(a.metrics, a.session.movement_type) : []
  const reason =
    cell.kind === 'failed'
      ? (a.error ?? 'Processing failed. No reason was saved.')
      : done && !a.metrics
        ? 'Processing finished, but no metrics are saved for this clip. Re-run metrics to compute them from the saved keypoints.'
        : (readings.find((m) => m.value === null && m.reason)?.reason ?? null)
  return (
    <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} aria-live="polite" aria-label="Selected clip">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="subj">{props.code === NO_CODE ? 'no code' : props.code}</span>
        <span className="mono t-small">{cell.clip}</span>
        <span style={{ flex: 1 }} />
        <StatusWord kind={cell.kind} />
      </div>
      {a.clip_name && (
        <p className="mono t-small muted" style={{ wordBreak: 'break-all' }}>
          {a.clip_name}
        </p>
      )}
      <p className="t-caption">
        {a.session.camera_view ? VIEW_LABELS[a.session.camera_view] : 'View not recorded'} · attempt {a.number} of its session
      </p>
      <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 12px', margin: 0 }} className="t-small">
        {done ? (
          readings.map((m) => (
            <div key={m.key} style={{ display: 'contents' }}>
              <dt className="muted">{m.def.label}</dt>
              <dd style={{ margin: 0, color: m.value === null || m.confidence === 'low' ? 'var(--text-3)' : undefined }} className="num">
                {m.value === null ? 'not available' : formatMetricWithUnit(m.key, m.value)}
                {m.value !== null && m.confidence !== 'high' && ` · ${m.confidence}`}
              </dd>
            </div>
          ))
        ) : (
          <>
            <dt className="muted">Metrics</dt>
            <dd style={{ margin: 0, color: 'var(--text-3)' }}>{cell.kind === 'failed' ? 'not available' : 'pending'}</dd>
          </>
        )}
      </dl>
      {reason && <p className="reason hatch">{reason}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {done && (
          <a className="btn btn-secondary btn-sm" href={href({ name: 'review', attemptId: a.id })}>
            Open in review
          </a>
        )}
        <a className={done ? 'btn btn-ghost btn-sm' : 'btn btn-secondary btn-sm'} href={href({ name: 'library', sessionId: a.session_id })}>
          Open in library
        </a>
        {done && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={props.onRerun} disabled={props.busy}>
            Re-run metrics
          </button>
        )}
      </div>
    </section>
  )
}

function LoadingGrid() {
  return (
    <>
      <div className="card" style={{ padding: '14px 16px', display: 'flex', gap: 16, alignItems: 'center' }} aria-hidden="true">
        <Skeleton width={90} height={16} />
        <Skeleton width={90} height={16} />
        <Skeleton width={90} height={16} />
        <span style={{ flex: 1 }} />
        <Skeleton width={200} height={8} />
      </div>
      <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }} aria-busy="true" aria-label="Loading the dataset">
        <Skeleton width={160} height={16} style={{ marginBottom: 8 }} />
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Skeleton width={40} height={24} />
            <Skeleton height={28} />
          </div>
        ))}
      </div>
    </>
  )
}

// ---------- the page ----------

export function Dataset() {
  const auth = useAuth()
  const narrow = useIsNarrow()
  const library = useLibrary()
  const { activeId } = usePipeline()
  const grid = useMemo(
    () => buildGrid(library.data?.attempts ?? [], new Set(activeId ? [activeId] : [])),
    [library.data, activeId],
  )
  const cells = useMemo(() => grid.rows.flatMap((r) => r.cells.filter((c): c is GridCell => c !== null).map((cell) => ({ code: r.code, cell }))), [grid])

  const [filter, setFilter] = useState<GridFilter>({ status: 'all', view: 'all' })
  const [selId, setSelId] = useState<string | null>(null)
  const [openCode, setOpenCode] = useState<string | null>(null)
  const selected = cells.find((c) => c.cell.attempt.id === selId) ?? cells[0] ?? null

  const [busy, setBusy] = useState<'csv' | 'rerun' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [withConfidence, setWithConfidence] = useState(true)
  const [withPhases, setWithPhases] = useState(true)

  const queued = cells.filter((c) => c.cell.kind === 'queued')
  const doneCells = cells.filter((c) => c.cell.kind.startsWith('done'))

  const processQueued = () => {
    setError(null)
    const ready = queued.filter((c) => hasClip(c.cell.attempt.id))
    if (ready.length === 0) {
      setNote(
        `The video of ${queued.length === 1 ? 'the queued clip isn’t' : `the ${queued.length} queued clips aren’t`} open in this tab. ` +
          'Open Processing and choose the files again; they stay on this computer.',
      )
      return
    }
    enqueue(
      ready.map((c) => ({ attemptId: c.cell.attempt.id, movement: c.cell.attempt.session.movement_type, clipName: c.cell.attempt.clip_name })),
    )
    navigate({ name: 'processing' })
  }

  const rerun = async (targets: GridCell[]) => {
    setBusy('rerun')
    setError(null)
    let ok = 0
    let failed = 0
    for (const [i, c] of targets.entries()) {
      setNote(`Re-running metrics from saved keypoints: ${i + 1} of ${targets.length}…`)
      try {
        await rerunMetrics(c.attempt)
        ok++
      } catch {
        failed++
      }
    }
    setNote(
      `Metrics recomputed from saved keypoints for ${plural(ok, 'clip')}.` +
        (failed > 0 ? ` ${plural(failed, 'clip')} couldn’t be recomputed (keypoints not readable) and ${failed === 1 ? 'keeps its' : 'keep their'} earlier values.` : ''),
    )
    setBusy(null)
    invalidate()
  }

  const exportCsv = async () => {
    setBusy('csv')
    setError(null)
    try {
      const bundle = await exportAll(client())
      const clipOf = new Map(cells.map((c) => [c.cell.attempt.id, c.cell.clip]))
      const csv = datasetCsv(bundle.document, clipOf, { confidence: withConfidence, phases: withPhases })
      const name = `study-dataset-${fileDay()}.csv`
      saveText(name, csv, 'text/csv;charset=utf-8')
      setNote(`Saved ${name}: ${plural(csv.split('\r\n').length - 2, 'row')}, one per study clip, by subject code.`)
    } catch (e) {
      setError(dataError(e))
    } finally {
      setBusy(null)
    }
  }

  const header = (
    <PageHeader
      title="Dataset overview"
      mobileTitle="Dataset"
      eyebrow="Study dataset"
      subtitle="12 pseudonymous subjects × 15 clips. Video stays on this computer; keypoints and metrics are saved."
      actions={
        auth.role === 'researcher' && grid.counts.clips > 0 ? (
          <>
            <button className="btn btn-primary" type="button" onClick={processQueued} disabled={queued.length === 0}>
              <Icon name="play" />
              Process all queued ({queued.length})
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => void rerun(doneCells.map((c) => c.cell))} disabled={busy !== null || doneCells.length === 0}>
              {busy === 'rerun' ? <Spinner /> : <Icon name="refresh" />}
              Re-run metrics
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => void exportCsv()} disabled={busy !== null}>
              {busy === 'csv' ? <Spinner /> : <Icon name="download" />}
              Export CSV
            </button>
          </>
        ) : undefined
      }
    />
  )

  // The profile decides the role; until it has loaded nothing about the dataset is shown.
  if (auth.profile === null) {
    return (
      <>
        {header}
        <LoadingGrid />
      </>
    )
  }
  if (auth.role !== 'researcher') {
    return (
      <>
        {header}
        <EmptyState
          icon="lock"
          title="Researchers only"
          action={
            <a className="btn btn-secondary" href={href({ name: 'library' })}>
              Open your library
            </a>
          }
        >
          The study dataset overview is for researcher accounts. Your own clips, metrics and notes are in your library.
        </EmptyState>
      </>
    )
  }
  if (library.loading) {
    return (
      <>
        {header}
        <LoadingGrid />
      </>
    )
  }
  if (grid.counts.clips === 0) {
    return (
      <>
        {header}
        {library.error && <ErrorAlert error={library.error} onRetry={library.refetch} />}
        {!library.error && (
          <EmptyState
            icon="dataset"
            title="No study clips yet"
            action={
              <a className="btn btn-primary" href={href({ name: 'import' })}>
                Import clips
              </a>
            }
          >
            Import the study clips from this computer. Subjects appear here by code (S01–S12).
          </EmptyState>
        )}
      </>
    )
  }

  const { counts } = grid
  const donePct = `${((counts.done / counts.clips) * 100).toFixed(1)}%`
  const openRow = grid.rows.find((r) => r.code === openCode && r.clips > 0) ?? null
  const messages = (
    <>
      {library.error && <ErrorAlert error={library.error} onRetry={library.refetch} />}
      {error && <ErrorAlert error={error} />}
      {note && (
        <Alert
          role="status"
          actions={
            <>
              {queued.length > 0 && note.includes('Processing') && (
                <a className="btn btn-secondary btn-sm" href={href({ name: 'processing' })}>
                  Open Processing
                </a>
              )}
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setNote(null)} disabled={busy === 'rerun'}>
                Dismiss
              </button>
            </>
          }
        >
          {note}
        </Alert>
      )}
    </>
  )
  const plan = `${plural(counts.clips, 'clip')} imported of ${PLANNED_TOTAL} planned`
  const footnote = (
    <p className="t-caption">
      Status is shown by shape; tracking confidence of finished clips by shade and hatching, and in words when a clip is
      selected. Confidence describes the recording, not the dancer. Nothing here ranks subjects.
      {grid.personal > 0 && ` ${plural(grid.personal, 'personal clip')} of this account ${grid.personal === 1 ? 'is' : 'are'} not part of the study grid.`}
    </p>
  )

  if (narrow) {
    return (
      <>
        {header}
        <section className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="Processing summary">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <span className="t-h3 num">
              {counts.done} / {counts.clips} done
            </span>
            <span className="t-caption">{PLANNED_TOTAL} planned</span>
          </div>
          <div className="bar" style={{ height: 8 }} role="progressbar" aria-valuenow={counts.done} aria-valuemin={0} aria-valuemax={counts.clips} aria-label="Imported clips processed">
            <i style={{ width: donePct }} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px' }}>
            {(['processing', 'queued', 'failed'] as const).map((s) => (
              <span key={s} className={`status st-${s}`}>
                <span className="dot" aria-hidden="true" />
                {counts[s]} {s}
              </span>
            ))}
          </div>
        </section>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <button className="btn btn-primary btn-lg" type="button" onClick={processQueued} disabled={queued.length === 0}>
            Process {queued.length}
          </button>
          <button className="btn btn-secondary btn-lg" type="button" onClick={() => void exportCsv()} disabled={busy !== null}>
            {busy === 'csv' && <Spinner />}
            Export CSV
          </button>
        </div>
        <p className="t-caption">Large batches run faster on a computer. Clips process on whichever device holds them.</p>
        {messages}
        <Filters filter={filter} onChange={setFilter} />
        <MiniTable grid={grid} filter={filter} openCode={openRow?.code ?? null} onOpen={setOpenCode} />
        {openRow ? <SubjectClips row={openRow} /> : <p className="t-caption">Tap a subject code to list its clips.</p>}
        <Legend size={14} />
        {footnote}
      </>
    )
  }

  return (
    <>
      {header}
      {messages}
      <div className="card" style={{ padding: '14px 16px', display: 'flex', flexWrap: 'wrap', gap: '12px 28px', alignItems: 'center' }}>
        {STATUS_GROUPS.map((s) => (
          <span key={s} className={`status st-${s}`}>
            <span className="dot" aria-hidden="true" />
            <span className="num">{counts[s]}</span> {s}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <div
          className="bar"
          style={{ flex: '0 1 280px', height: 8 }}
          role="progressbar"
          aria-valuenow={counts.done}
          aria-valuemin={0}
          aria-valuemax={counts.clips}
          aria-label="Imported clips processed"
        >
          <i style={{ width: donePct }} />
        </div>
        <span className="t-small muted num">
          {counts.done} / {counts.clips} done · {plan}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <section className="card" style={{ flex: '999 1 640px', minWidth: 0, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }} aria-labelledby="grid-h">
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <h2 className="t-h3" id="grid-h">
              Clips by subject
            </h2>
            <Legend />
          </div>
          <Filters filter={filter} onChange={setFilter} />
          <GridTable grid={grid} filter={filter} selectedId={selected?.cell.attempt.id ?? null} onPick={(c) => setSelId(c.attempt.id)} />
          {footnote}
        </section>

        <aside style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {selected && <ClipDetail code={selected.code} cell={selected.cell} busy={busy !== null} onRerun={() => void rerun([selected.cell])} />}
          <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} aria-labelledby="csv-h">
            <h2 className="t-h3" id="csv-h">
              CSV export
            </h2>
            <label className="check">
              <input type="checkbox" checked disabled readOnly />
              <span className="t-small">Metric values and units (always)</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={withConfidence} onChange={(e) => setWithConfidence(e.target.checked)} />
              <span className="t-small">Confidence per value</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={withPhases} onChange={(e) => setWithPhases(e.target.checked)} />
              <span className="t-small">Phase timings</span>
            </label>
            <label className="check" style={{ cursor: 'default' }}>
              <input type="checkbox" disabled aria-describedby="csv-kp" />
              <span className="t-small muted">Raw keypoints (large · JSON)</span>
            </label>
            <p className="t-caption" id="csv-kp">
              Keypoints aren’t part of the CSV. Download them file by file in{' '}
              <a href={href({ name: 'settings' })}>Settings › Your data</a>.
            </p>
            <p className="t-caption">
              One row per study clip. Low-confidence values are exported with their flag, never dropped or set to 0. Rows
              use subject codes only.
            </p>
          </section>
        </aside>
      </div>
    </>
  )
}

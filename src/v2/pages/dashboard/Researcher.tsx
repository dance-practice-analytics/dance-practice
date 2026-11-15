// Dashboard, researcher variant. Design: Dashboard.dc.html › RESEARCHER.
// System states only: what is processed, what needs attention, what happened. Subjects
// are listed by code — never ranked, never compared by their measurements.

import { useMemo, useState } from 'react'
import type { ApiError } from '../../../api/errors'
import { dataError } from '../../../data/repo'
import { exportMetricsCsv } from '../../../data/exportData'
import { client } from '../../auth'
import { ErrorAlert, Spinner } from '../../components'
import type { Library } from '../../data'
import { formatDateTime } from '../../format'
import { href } from '../../router'
import { PERSONAL_LABEL, plural, tileStatus, type LiveStatus } from '../library/model'
import type { AccountNotes } from '../library/notes'
import { attentionItems, recentActivity, studyProgress, subjectProgress } from './model'

const ATTENTION_PAGE = 8

/** Hands the CSV to the viewer as a file; it is built in the browser from the account's own rows. */
function saveCsv(csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `dance-practice-metrics-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export interface ResearcherProps {
  data: Library
  notes: AccountNotes
  live: LiveStatus
}

export function ResearcherDashboard({ data, notes, live }: ResearcherProps) {
  const { sessions, attempts } = data
  const progress = useMemo(() => studyProgress(sessions, attempts, live), [sessions, attempts, live])
  const attention = useMemo(() => attentionItems(attempts, live), [attempts, live])
  const subjects = useMemo(() => subjectProgress(attempts), [attempts])
  const activity = useMemo(() => recentActivity(sessions, attempts, notes.notes ?? []), [sessions, attempts, notes.notes])
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<ApiError | null>(null)

  const exportCsv = async () => {
    setExporting(true)
    setExportError(null)
    try {
      saveCsv(await exportMetricsCsv(client()))
    } catch (e) {
      setExportError(dataError(e))
    } finally {
      setExporting(false)
    }
  }

  const waiting = progress.queued + progress.processing
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }} aria-labelledby="sp-h">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h2 className="t-h2" id="sp-h">
              <span className="num">{progress.done}</span> of {plural(progress.total, 'clip')} processed
            </h2>
            <span className="t-small muted">
              {plural(progress.subjects, 'subject')} · {plural(progress.sessions, 'session')} ·{' '}
              {progress.lastProcessed ? `last processed ${formatDateTime(progress.lastProcessed)}` : 'nothing processed yet'}
            </span>
          </div>
          {waiting > 0 && (
            <a className="btn btn-primary" href={href({ name: 'processing' })}>
              Process queued ({waiting})
            </a>
          )}
          <button className="btn btn-secondary" type="button" onClick={exportCsv} disabled={exporting || progress.done === 0}>
            {exporting && <Spinner />}
            Export CSV
          </button>
          <a className="btn btn-ghost" href={href({ name: 'dataset' })}>
            Open dataset
          </a>
        </div>
        {exportError && <ErrorAlert error={exportError} onRetry={exportCsv} />}
        <div
          className="bar"
          style={{ height: 8 }}
          role="progressbar"
          aria-valuenow={progress.done}
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-label="Clips processed"
        >
          <i style={{ width: `${progress.percent.toFixed(1)}%` }} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px' }}>
          {(['done', 'processing', 'queued', 'failed'] as const).map((s) => (
            <span key={s} className={`status st-${s}`}>
              <span className="dot" aria-hidden="true" />
              <span className="num">{progress[s]}</span> {s}
            </span>
          ))}
          {progress.flagged > 0 && <span className="t-small muted">· {progress.flagged} finished with low confidence or no tracking</span>}
        </div>
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <section className="card" style={{ flex: '999 1 460px', minWidth: 0, overflow: 'hidden' }} aria-labelledby="na-h">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '16px 16px 10px' }}>
            <h2 className="t-h3" id="na-h">
              Needs attention
            </h2>
            <span className="t-caption">System issues only</span>
          </div>
          {attention.length === 0 ? (
            <p className="t-small muted" style={{ padding: '12px 16px 16px', borderTop: '1px solid var(--line)' }}>
              Nothing needs attention. Failed clips and clips with low tracking confidence are listed here.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {attention.slice(0, ATTENTION_PAGE).map((i) => (
                <li key={i.attemptId} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
                  {i.code ? <span className="subj">{i.code}</span> : <span className="tag">{PERSONAL_LABEL}</span>}
                  <span className="mono t-small v2-clip" style={{ maxWidth: 220 }}>
                    {i.clip}
                  </span>
                  <span className={`status st-${tileStatus(i.kind)}`}>
                    <span className="dot" aria-hidden="true" />
                    {i.status}
                  </span>
                  <span className="t-small muted" style={{ flex: '1 1 220px' }}>
                    {i.reason}
                  </span>
                  <a
                    className="btn btn-ghost btn-sm"
                    href={i.action === 'Retry' ? href({ name: 'processing' }) : href({ name: 'review', attemptId: i.attemptId })}
                    aria-label={`${i.action} ${i.clip}`}
                  >
                    {i.action}
                  </a>
                </li>
              ))}
              {attention.length > ATTENTION_PAGE && (
                <li style={{ padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
                  <a className="t-small" href={href({ name: 'dataset' })}>
                    {attention.length - ATTENTION_PAGE} more in the dataset
                  </a>
                </li>
              )}
            </ul>
          )}
        </section>

        <section className="card" style={{ flex: '1 1 320px', minWidth: 0, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }} aria-labelledby="sj-h">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <h2 className="t-h3" id="sj-h">
              Subjects
            </h2>
            <span className="t-caption">Ordered by code · not a ranking</span>
          </div>
          {subjects.map((s) => (
            <a
              key={s.key}
              href={href({ name: 'dataset' })}
              aria-label={`${s.code ?? PERSONAL_LABEL}: ${s.done} of ${s.total} clips processed`}
              style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'var(--text)', minHeight: 28 }}
            >
              {s.code ? <span className="subj">{s.code}</span> : <span className="tag">Personal</span>}
              <span className="bar" style={{ flex: 1 }}>
                <i style={{ width: `${s.percent.toFixed(0)}%` }} />
              </span>
              <span className="t-small num muted" style={{ width: 72, textAlign: 'right' }}>
                {s.label}
              </span>
            </a>
          ))}
        </section>
      </div>

      <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }} aria-labelledby="ra-h">
        <h2 className="t-h3" id="ra-h" style={{ marginBottom: 6 }}>
          Recent activity
        </h2>
        {activity.length === 0 ? (
          <p className="t-small muted">No activity yet. Imports, processing runs and practice notes are listed here.</p>
        ) : (
          activity.map((e) => (
            <div key={e.key} style={{ display: 'flex', gap: 16, padding: '8px 0', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
              <span className="mono subtle" style={{ fontSize: 12, width: 130 }}>
                {e.when}
              </span>
              <span className="t-small">{e.what}</span>
            </div>
          ))
        )}
      </section>
    </div>
  )
}

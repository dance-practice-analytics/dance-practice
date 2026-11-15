// Screen 13 — Settings & data (FR-3.1.x, FR-3.9.x).
// Design: Settings.dc.html (wide), SettingsMobile.dc.html (phone); patterns in States.dc.html.
// Real: sign out, theme, reduce motion, the optional consents, counts of what is stored,
// JSON / CSV / keypoint-file export, delete one attempt, delete all data.
// Shown but off, with the reason: change password, delete the sign-in account.
// Left out: the design's links to pages that don't exist (privacy notice, licences, …)
// and every size the app doesn't record (metrics, notes, local video).

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { version as APP_VERSION } from '../../../package.json'
import type { ApiError } from '../../api/errors'
import { deleteAttemptData, type DeleteReport } from '../../data/deleteData'
import { exportAll, exportMetricsCsv } from '../../data/exportData'
import { dataError } from '../../data/repo'
import { ALGORITHM_VERSION } from '../../metrics/engine'
import { client, signOut, useAuth } from '../auth'
import { releaseAllClips, releaseClip } from '../clips'
import { ErrorAlert, Icon, NoteBox, PageHeader, Skeleton, Spinner } from '../components'
import { CONSENT_VERSION, setConsent, useConsents, type ConsentScope } from '../consents'
import { invalidate, useLibrary, type AttemptView } from '../data'
import { MOVEMENT_LABELS, formatBytes, formatDate } from '../format'
import { resetPipeline } from '../pipeline'
import { setThemePref, useThemePref, type ThemePref } from '../theme'
import { useIsNarrow } from '../useIsNarrow'
import { fileDay, saveText } from './settings/download'
import { Modal } from './settings/Modal'
import { setReduceMotion, useReduceMotion } from './settings/motion'
import { CONFIRM_WORD, confirmMatches, describeReport, runDeleteAll } from './settings/report'
import { useStorageFacts } from './settings/storage'
import './settings/settings.css'

const THEMES: { pref: ThemePref; label: string; short: string }[] = [
  { pref: 'light', label: 'Light', short: 'Light' },
  { pref: 'dark', label: 'Dark', short: 'Dark' },
  { pref: 'system', label: 'Match system', short: 'System' },
]

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function attemptLabel(a: AttemptView): string {
  const parts = [MOVEMENT_LABELS[a.session.movement_type], a.session.subject_code, formatDate(a.session.recorded_on ?? a.created_at), `Attempt ${a.number}`]
  return parts.filter(Boolean).join(' · ')
}

// ---------- layout pieces ----------

function Section({ id, title, narrow, children }: { id: string; title: string; narrow: boolean; children: ReactNode }) {
  return narrow ? (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-labelledby={id}>
      <h2 className="t-label" id={id}>
        {title}
      </h2>
      {children}
    </section>
  ) : (
    <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }} aria-labelledby={id}>
      <h2 className="t-h3" id={id}>
        {title}
      </h2>
      {children}
    </section>
  )
}

/** Rows split by a hairline in the wide card; the list card on a phone. */
function Rows({ narrow, children }: { narrow: boolean; children: ReactNode }) {
  return <div className={narrow ? 'card v2-set-list' : 'v2-set-rows'}>{children}</div>
}

function SwitchRow(props: {
  title: string
  caption: ReactNode
  checked: boolean
  busy?: boolean
  onChange(next: boolean): void
}) {
  return (
    <label className="v2-set-row">
      <span className="v2-set-text">
        <span>{props.title}</span>
        <span className="t-caption">{props.caption}</span>
      </span>
      {props.busy && <Spinner size={12} />}
      <input
        className="switch"
        type="checkbox"
        role="switch"
        checked={props.checked}
        aria-checked={props.checked}
        disabled={props.busy}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </label>
  )
}

function FixedRow({ title, caption }: { title: string; caption: ReactNode }) {
  return (
    <div className="v2-set-row">
      <span className="v2-set-text">
        <span>{title}</span>
        <span className="t-caption">{caption}</span>
      </span>
      <span className="tag">
        <Icon name="check" />
        Required
      </span>
    </div>
  )
}

function ReportBody({ report }: { report: DeleteReport }) {
  const text = describeReport(report)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} className="t-small muted">
      {text.removed.length > 0 ? (
        <>
          <p>Removed from your account:</p>
          <ul className="v2-set-ul">
            {text.removed.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      ) : (
        text.complete && <p>Nothing was stored, so nothing was removed.</p>
      )}
      {text.notRemoved.length > 0 && (
        <>
          <p style={{ color: 'var(--text)', fontWeight: 600 }}>Not removed:</p>
          <ul className="v2-set-ul">
            {text.notRemoved.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </>
      )}
      {text.kept && <p>{text.kept}</p>}
      {text.remaining && <p>{text.remaining}</p>}
    </div>
  )
}

// ---------- the page ----------

interface KeypointLink {
  name: string
  url: string
  size: number
}

export function Settings() {
  const { user, role } = useAuth()
  const narrow = useIsNarrow()
  const pref = useThemePref()
  const calm = useReduceMotion()
  const consents = useConsents()
  const library = useLibrary()
  const facts = useStorageFacts(library.data)
  const attempts = library.data?.attempts ?? []

  // Privacy choices
  const [busyScope, setBusyScope] = useState<ConsentScope | null>(null)
  const [consentError, setConsentError] = useState<ApiError | null>(null)
  const toggleConsent = async (scope: ConsentScope, next: boolean) => {
    setBusyScope(scope)
    setConsentError(null)
    try {
      await setConsent(scope, next)
    } catch (e) {
      setConsentError(dataError(e))
    } finally {
      setBusyScope(null)
    }
  }
  const since = (scope: ConsentScope) => {
    const day = consents.grantedOn(scope)
    return day ? `accepted ${formatDate(day)}` : 'accepted'
  }

  // Export
  const [exporting, setExporting] = useState<'json' | 'csv' | 'keypoints' | null>(null)
  const [exportError, setExportError] = useState<ApiError | null>(null)
  const [exportNote, setExportNote] = useState<string | null>(null)
  const [withLabels, setWithLabels] = useState(false)
  const [files, setFiles] = useState<{ links: KeypointLink[]; unavailable: number } | null>(null)
  const urls = useRef<string[]>([])
  const dropUrls = () => {
    urls.current.forEach((u) => URL.revokeObjectURL(u))
    urls.current = []
  }
  useEffect(() => dropUrls, [])

  const runExport = async (kind: 'json' | 'csv' | 'keypoints', fn: () => Promise<void>) => {
    setExporting(kind)
    setExportError(null)
    setExportNote(null)
    try {
      await fn()
    } catch (e) {
      setExportError(dataError(e))
    } finally {
      setExporting(null)
    }
  }
  const exportJson = () =>
    runExport('json', async () => {
      const bundle = await exportAll(client(), { includeLabels: withLabels })
      const name = `dance-practice-export-${fileDay()}.json`
      saveText(name, bundle.json, 'application/json')
      const c = bundle.document.counts
      setExportNote(`Saved ${name}: ${plural(c.sessions, 'session')}, ${plural(c.attempts, 'attempt')}, ${plural(c.consents, 'consent record')}.`)
    })
  const exportCsv = () =>
    runExport('csv', async () => {
      const csv = await exportMetricsCsv(client())
      const name = `dance-practice-metrics-${fileDay()}.csv`
      saveText(name, csv, 'text/csv;charset=utf-8')
      // Header line and the trailing line end are not rows.
      setExportNote(`Saved ${name}: ${plural(csv.split('\r\n').length - 2, 'row')}, one per attempt and metric.`)
    })
  const prepareKeypoints = () =>
    runExport('keypoints', async () => {
      const bundle = await exportAll(client(), { includeKeypoints: true })
      dropUrls()
      const links = bundle.keypoints.map((f) => {
        const url = URL.createObjectURL(f.blob)
        urls.current.push(url)
        return { name: f.path.replace('/', '-'), url, size: f.blob.size }
      })
      setFiles({ links, unavailable: bundle.keypointsUnavailable.length })
    })

  // Delete one attempt
  const [pickId, setPickId] = useState('')
  const picked = attempts.find((a) => a.id === pickId) ?? attempts[0] ?? null
  const [confirmAttempt, setConfirmAttempt] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [attemptReport, setAttemptReport] = useState<DeleteReport | null>(null)
  const deleteAttempt = async () => {
    if (!picked) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const report = await deleteAttemptData(client(), picked.id)
      if (report.complete) releaseClip(picked.id)
      setAttemptReport(report)
      setConfirmAttempt(false)
      invalidate()
    } catch (e) {
      setDeleteError(dataError(e))
    } finally {
      setDeleting(false)
    }
  }

  // Delete everything
  const [confirmAll, setConfirmAll] = useState(false)
  const [typed, setTyped] = useState('')
  const [allReport, setAllReport] = useState<DeleteReport | null>(null)
  const canDeleteAll = confirmMatches(typed)
  const closeAll = () => {
    setConfirmAll(false)
    setTyped('')
    setDeleteError(null)
  }
  const deleteAll = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      const report = await runDeleteAll(client(), typed)
      resetPipeline()
      releaseAllClips()
      dropUrls()
      setFiles(null)
      setAllReport(report)
      invalidate()
    } catch (e) {
      setDeleteError(dataError(e))
    } finally {
      setDeleting(false)
    }
  }
  const finishAll = () => {
    setAllReport(null)
    closeAll()
    // The consent records went too, so the app asks for them again from here.
    consents.reload()
  }

  const processed = attempts.filter((a) => a.metrics !== null).length
  const notesCount = facts.data?.feedbackSets ?? 0

  // ---------- sections ----------

  const themeControl = (
    <div className="seg" role="group" aria-label="Theme" style={narrow ? { width: '100%' } : undefined}>
      {THEMES.map((t) => (
        <button
          key={t.pref}
          type="button"
          className={pref === t.pref ? 'on' : undefined}
          aria-pressed={pref === t.pref}
          onClick={() => setThemePref(t.pref)}
          style={narrow ? { flex: 1, justifyContent: 'center', height: 40 } : undefined}
        >
          {narrow ? t.short : t.label}
        </button>
      ))}
    </div>
  )

  const motionRow = (
    <SwitchRow
      title="Reduce motion"
      caption={narrow ? 'Stops loading shimmer and spinners' : 'Stops loading shimmer and spinners; playback is unaffected.'}
      checked={calm}
      onChange={setReduceMotion}
    />
  )

  const privacy = (
    <>
      <Rows narrow={narrow}>
        <SwitchRow
          title="AI practice notes"
          caption={
            narrow
              ? 'Metrics only, when you ask'
              : 'Sends one attempt’s metric values when you press Generate. Never video.'
          }
          checked={consents.has('ai_metrics_only')}
          busy={busyScope === 'ai_metrics_only'}
          onChange={(next) => void toggleConsent('ai_metrics_only', next)}
        />
        <SwitchRow
          title="Back up my own videos"
          caption={narrow ? 'Never study clips' : 'Personal videos only. Study clips can never be uploaded.'}
          checked={consents.has('own_video_upload')}
          busy={busyScope === 'own_video_upload'}
          onChange={(next) => void toggleConsent('own_video_upload', next)}
        />
        <FixedRow
          title="Process study clips on this device"
          caption={`Always on · ${since('on_device_processing')}`}
        />
        <FixedRow
          title="Save keypoints and metrics to my account"
          caption={`Needed to use the app · ${since('keypoints_and_metrics_storage')}. To withdraw it, delete your data.`}
        />
      </Rows>
      <p className="t-caption" role="status">
        {consents.has('ai_metrics_only')
          ? 'AI practice notes are on.'
          : 'AI practice notes are off: nothing is sent, and Generate stays unavailable until you turn them on.'}
      </p>
      {consentError && <ErrorAlert error={consentError} />}
      <NoteBox icon="device">Pose estimation always runs on this device.</NoteBox>
    </>
  )

  const factsBlock = library.error ? (
    <ErrorAlert error={library.error} onRetry={library.refetch} />
  ) : library.loading ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-busy="true" aria-label="Loading your data">
      <Skeleton height={12} width="80%" />
      <Skeleton height={12} width="65%" />
      <Skeleton height={12} width="72%" />
    </div>
  ) : (
    <>
      <dl className="v2-set-facts t-small">
        <dt className="muted">Sessions and attempts</dt>
        <dd className="num">
          {plural(library.data?.sessions.length ?? 0, 'session')} · {plural(attempts.length, 'attempt')}
        </dd>
        <dt className="muted">Keypoints{facts.data ? ` · ${plural(facts.data.keypointFiles, 'file')}` : ''}</dt>
        <dd className="num">
          {facts.data ? (
            <>
              {facts.data.keypointFiles > 0 && `${formatBytes(facts.data.keypointBytes)} · `}saved to account
              {facts.data.keypointUnsized > 0 && ` · size not recorded for ${facts.data.keypointUnsized}`}
            </>
          ) : facts.loading ? (
            'Counting…'
          ) : (
            'Couldn’t be counted'
          )}
        </dd>
        <dt className="muted">Metrics and phase timings · {plural(processed, 'attempt')}</dt>
        <dd>saved to account</dd>
        <dt className="muted">Practice notes{facts.data ? ` · ${plural(notesCount, 'set')}` : ''}</dt>
        <dd>{facts.data ? 'saved to account' : facts.loading ? 'Counting…' : 'Couldn’t be counted'}</dd>
        <dt className="muted">Video clips</dt>
        <dd>this device only · never uploaded</dd>
      </dl>
      {facts.error && <ErrorAlert error={facts.error} onRetry={facts.refetch} />}
      <p className="t-caption">A size is shown only where the app records one (keypoint files).</p>
    </>
  )

  const labelsCheck = (
    <label className="check">
      <input type="checkbox" checked={withLabels} onChange={(e) => setWithLabels(e.target.checked)} />
      <span className="t-small">
        Include session titles, attempt labels and clip file names in the JSON
        <span className="t-caption" style={{ display: 'block' }}>
          Off by default: text you typed can identify someone. Exports never contain video, emails or names.
        </span>
      </span>
    </label>
  )

  const exportStatus = (
    <>
      {exportNote && (
        <p className="t-small muted" role="status">
          {exportNote}
        </p>
      )}
      {exportError && <ErrorAlert error={exportError} />}
      {files && (
        <div className="well" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }} role="status">
          <p className="t-small">
            {files.links.length > 0
              ? `${plural(files.links.length, 'keypoint file')} ready. They download one at a time; this app can’t bundle them into a zip.`
              : 'No keypoint files are saved yet. They appear after a clip is processed.'}
            {files.unavailable > 0 && ` ${plural(files.unavailable, 'file')} couldn’t be read and ${files.unavailable === 1 ? 'is' : 'are'} not listed.`}
          </p>
          {files.links.length > 0 && (
            <ul className="v2-set-files t-small">
              {files.links.map((f) => (
                <li key={f.name}>
                  <a className="mono" href={f.url} download={f.name}>
                    {f.name}
                  </a>
                  <span className="t-caption num" style={{ flex: 'none' }}>
                    {formatBytes(f.size)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="t-caption">Each file is gzipped JSON of body-point coordinates per frame. No images.</p>
        </div>
      )}
    </>
  )

  const busyIcon = (kind: typeof exporting, icon: ReactNode) => (exporting === kind && kind !== null ? <Spinner /> : icon)

  const accountRemains =
    'Not available in this app: removing the sign-in account needs a server-side step. Delete all your data here, then ask the project team to remove the account.'
  const passwordOff =
    'Changing the password is off in this build: account emails are rate-limited on this project.'

  const dataWide = (
    <>
      {factsBlock}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button className="btn btn-secondary" type="button" onClick={() => void exportJson()} disabled={exporting !== null}>
          {busyIcon('json', <Icon name="download" />)}
          Export JSON
        </button>
        <button className="btn btn-secondary" type="button" onClick={() => void exportCsv()} disabled={exporting !== null}>
          {busyIcon('csv', <Icon name="download" />)}
          Export CSV
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => void prepareKeypoints()} disabled={exporting !== null}>
          {busyIcon('keypoints', <Icon name="download" />)}
          Keypoint files…
        </button>
      </div>
      {labelsCheck}
      {exportStatus}
      <div className="hr" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 260px' }}>
          <label className="field-label" htmlFor="del-att">
            Delete one attempt
          </label>
          <select
            className="input"
            id="del-att"
            value={picked?.id ?? ''}
            onChange={(e) => setPickId(e.target.value)}
            disabled={attempts.length === 0}
          >
            {attempts.length === 0 && <option value="">No attempts saved</option>}
            {attempts.map((a) => (
              <option key={a.id} value={a.id}>
                {attemptLabel(a)}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-secondary" type="button" disabled={!picked} onClick={() => setConfirmAttempt(true)}>
          <Icon name="trash" />
          Delete attempt
        </button>
      </div>
      {attemptReportView()}
      <div className="hr" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 600 }}>Delete all my data</span>
          <span className="t-caption">
            Removes keypoints, metrics, notes, sessions and consent choices. Can’t be undone. The sign-in account stays.
          </span>
        </div>
        <button className="btn btn-destructive" type="button" onClick={() => setConfirmAll(true)}>
          Delete all my data…
        </button>
      </div>
      <div className="hr" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 600 }}>Delete account</span>
          <span className="t-caption" id="del-acc-why">
            {accountRemains}
          </span>
        </div>
        <button className="btn btn-secondary" type="button" disabled aria-describedby="del-acc-why">
          Delete account
        </button>
      </div>
    </>
  )

  function attemptReportView() {
    if (!attemptReport) return null
    // The shared Alert puts its children in a <p>; a report has lists, so the markup is spelled out.
    return (
      <div className="alert" role="status">
        <Icon name={attemptReport.complete ? 'check' : 'warning'} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <p>
            <strong>{describeReport(attemptReport).title}.</strong>
          </p>
          <ReportBody report={attemptReport} />
          <div>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setAttemptReport(null)}>
              Dismiss
            </button>
          </div>
        </div>
      </div>
    )
  }

  const chevron = <Icon name="chevron-right" size={18} style={{ color: 'var(--text-3)' }} />

  const dataNarrow = (
    <>
      <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {factsBlock}
      </div>
      <div className="card v2-set-list">
        <button type="button" className="v2-set-rowbtn" onClick={() => void exportJson()} disabled={exporting !== null}>
          <span style={{ flex: 1 }}>Export as JSON</span>
          {exporting === 'json' ? <Spinner /> : <span className="t-caption">everything saved</span>}
        </button>
        <button type="button" className="v2-set-rowbtn" onClick={() => void exportCsv()} disabled={exporting !== null}>
          <span style={{ flex: 1 }}>Export as CSV</span>
          {exporting === 'csv' ? <Spinner /> : <span className="t-caption">metrics only</span>}
        </button>
        <button type="button" className="v2-set-rowbtn" onClick={() => void prepareKeypoints()} disabled={exporting !== null}>
          <span style={{ flex: 1 }}>Keypoint files…</span>
          {exporting === 'keypoints' ? <Spinner /> : <span className="t-caption">one by one</span>}
        </button>
        <button type="button" className="v2-set-rowbtn" onClick={() => setConfirmAttempt(true)} disabled={!picked}>
          <span style={{ flex: 1 }}>Delete an attempt…</span>
          {chevron}
        </button>
        <button type="button" className="v2-set-rowbtn" style={{ fontWeight: 600 }} onClick={() => setConfirmAll(true)}>
          <span style={{ flex: 1 }}>Delete all my data…</span>
          <Icon name="trash" size={18} />
        </button>
        <button type="button" className="v2-set-rowbtn" disabled aria-describedby="del-acc-why">
          <span style={{ flex: 1 }}>Delete account</span>
          <span className="t-caption">not available</span>
        </button>
      </div>
      {labelsCheck}
      {exportStatus}
      {attemptReportView()}
      <p className="t-caption">Video stays on this phone and is never synced.</p>
      <p className="t-caption" id="del-acc-why">
        Delete account: {accountRemains.charAt(0).toLowerCase() + accountRemains.slice(1)}
      </p>
    </>
  )

  const versionLine = `KSU CS 4850 capstone · v${APP_VERSION}`

  return (
    <>
      {/* The header stays a direct child of the shell's <main> so the phone bar is full-bleed. */}
      <PageHeader title="Settings & data" mobileTitle="Settings" />
      <div style={{ maxWidth: 820, width: '100%', display: 'flex', flexDirection: 'column', gap: narrow ? 18 : 20 }}>
        {!narrow && (
          <Section id="s-acc" title="Account" narrow={false}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span className="v2-clip">{user?.email}</span>
                <span className="t-caption">Role: {role} · set by the project team</span>
              </div>
              <button className="btn btn-secondary btn-sm" type="button" disabled aria-describedby="pw-why">
                Change password
              </button>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
            <p className="t-caption" id="pw-why">
              {passwordOff}
            </p>
          </Section>
        )}

        <Section id="s-app" title="Appearance" narrow={narrow}>
          {narrow ? (
            <>
              {themeControl}
              <div className="card v2-set-list">{motionRow}</div>
            </>
          ) : (
            <div className="v2-set-rows">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Theme</span>
                {themeControl}
              </div>
              {motionRow}
            </div>
          )}
        </Section>

        <Section id="s-priv" title={narrow ? 'Privacy' : 'Privacy choices'} narrow={narrow}>
          {privacy}
        </Section>

        <Section id="s-data" title="Your data" narrow={narrow}>
          {narrow ? dataNarrow : dataWide}
        </Section>

        {narrow ? (
          <Section id="s-about" title="Account & about" narrow>
            <div className="card v2-set-list">
              <div className="v2-set-row">
                <span className="v2-set-text">
                  <span className="v2-clip">{user?.email}</span>
                  <span className="t-caption">Role: {role}</span>
                </span>
              </div>
              <button type="button" className="v2-set-rowbtn" disabled aria-describedby="pw-why">
                <span style={{ flex: 1 }}>Change password</span>
                <span className="t-caption">not available</span>
              </button>
              <button type="button" className="v2-set-rowbtn" onClick={() => void signOut()}>
                <span style={{ flex: 1 }}>Sign out</span>
                <Icon name="sign-out" size={18} style={{ color: 'var(--text-3)' }} />
              </button>
            </div>
            <p className="t-caption" id="pw-why">
              {passwordOff}
            </p>
            <p className="t-caption">
              {versionLine} · metrics {ALGORITHM_VERSION}
            </p>
          </Section>
        ) : (
          <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }} aria-labelledby="s-about">
            <h2 className="t-h3" id="s-about">
              About &amp; privacy
            </h2>
            <p className="t-small muted">Dance Practice Analytics · KSU CS 4850 capstone · version {APP_VERSION}</p>
            <p className="t-small muted">
              Metrics engine <span className="mono">{ALGORITHM_VERSION}</span> · consent text{' '}
              <span className="mono">{CONSENT_VERSION}</span>. Values describe a recording; they are not scores and not
              medical advice.
            </p>
          </section>
        )}
      </div>

      {confirmAttempt && picked && (
        <Modal labelledBy="sh-h" describedBy="sh-d" sheet={narrow} busy={deleting} onClose={() => setConfirmAttempt(false)}>
          <h2 className="t-h2" id="sh-h">
            Delete this attempt?
          </h2>
          {narrow && attempts.length > 1 && (
            <div className="field">
              <label className="field-label" htmlFor="sh-att">
                Attempt
              </label>
              <select className="input" id="sh-att" value={picked.id} onChange={(e) => setPickId(e.target.value)} disabled={deleting}>
                {attempts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {attemptLabel(a)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="well" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
            <div className="thumb hatch" style={{ width: 64, height: 40, flex: 'none' }} aria-hidden="true" />
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontWeight: 500 }}>
                {MOVEMENT_LABELS[picked.session.movement_type]} · Attempt {picked.number}
              </span>
              <span className="t-caption">
                {[picked.session.subject_code, formatDate(picked.session.recorded_on ?? picked.created_at), picked.metrics ? 'processed' : 'not processed']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
          </div>
          <p className="t-small muted" id="sh-d">
            Its keypoints, metrics and notes are removed from your account. Progress charts update. The video file on this{' '}
            {narrow ? 'phone' : 'device'} is kept.
          </p>
          {deleteError && <ErrorAlert error={deleteError} />}
          {narrow ? (
            <>
              <button className="btn btn-destructive btn-lg btn-block" type="button" onClick={() => void deleteAttempt()} disabled={deleting}>
                {deleting && <Spinner />}
                Delete attempt
              </button>
              <button className="btn btn-secondary btn-lg btn-block" type="button" onClick={() => setConfirmAttempt(false)} disabled={deleting} data-autofocus>
                Cancel
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" type="button" onClick={() => setConfirmAttempt(false)} disabled={deleting} data-autofocus>
                Cancel
              </button>
              <button className="btn btn-destructive" type="button" onClick={() => void deleteAttempt()} disabled={deleting}>
                {deleting && <Spinner />}
                Delete attempt
              </button>
            </div>
          )}
        </Modal>
      )}

      {confirmAll && !allReport && (
        <Modal labelledBy="dlg-h" describedBy="dlg-d" sheet={narrow} busy={deleting} onClose={closeAll}>
          <h2 className="t-h2" id="dlg-h">
            Delete all your data?
          </h2>
          <div id="dlg-d" style={{ display: 'flex', flexDirection: 'column', gap: 8 }} className="t-small muted">
            <p>This permanently deletes from your account:</p>
            <ul className="v2-set-ul">
              <li>
                Keypoints and metrics for {plural(attempts.length, 'attempt')} in {plural(library.data?.sessions.length ?? 0, 'session')}
              </li>
              {notesCount > 0 && <li>{plural(notesCount, 'set')} of practice notes</li>}
              <li>Your subject codes and consent choices</li>
            </ul>
            <p>
              Video files on this device aren’t touched — remove them yourself if you want. Files you already exported are
              yours to delete.
            </p>
            <p>
              The sign-in account itself stays: this app can’t remove it. Afterwards, ask the project team to remove the
              account.
            </p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="dlg-in">
              Type {CONFIRM_WORD} to confirm
            </label>
            <input
              className="input"
              id="dlg-in"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={deleting}
              data-autofocus
            />
          </div>
          {deleteError && <ErrorAlert error={deleteError} />}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" type="button" onClick={closeAll} disabled={deleting}>
              Cancel
            </button>
            <button className="btn btn-destructive" type="button" disabled={!canDeleteAll || deleting} onClick={() => void deleteAll()}>
              {deleting && <Spinner />}
              Delete everything
            </button>
          </div>
        </Modal>
      )}

      {allReport && (
        <Modal labelledBy="rep-h" describedBy="rep-d" sheet={narrow} busy onClose={finishAll}>
          <h2 className="t-h2" id="rep-h">
            {describeReport(allReport).title}
          </h2>
          <div id="rep-d">
            <ReportBody report={allReport} />
          </div>
          <p className="t-caption">
            {allReport.complete
              ? 'Your consent choices were removed too, so the app asks for them again when you continue.'
              : 'You can run “Delete all my data” again to remove what is left.'}
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" type="button" onClick={() => void signOut()}>
              Sign out
            </button>
            <button className="btn btn-primary" type="button" onClick={finishAll} data-autofocus>
              Continue
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

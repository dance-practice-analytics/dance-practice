// Screen 10 — AI practice notes (FR-3.7.x).
// Design: Notes.dc.html, NotesMobile.dc.html; empty / generating / limit / offline in States.dc.html.
// The notes are written by the Edge Function generate-feedback from one attempt's
// metrics. This screen never calls a model itself, never sends anything before the AI
// consent is on, and never sends a request when no metric has a value. Every failure of
// the service is a system state with its recovery — including "not set up yet", which
// is what the prototype shows until the function is deployed.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AI_CONSENT_SCOPE,
  DISCLAIMER,
  FeedbackError,
  generateFeedbackNote,
  listFeedback,
  type FeedbackNote,
} from '../../feedback/client'
import { client, signOut } from '../auth'
import { Alert, ConfBadge, EmptyState, ErrorAlert, Icon, NoteBox, PageHeader, Skeleton, SkeletonList, Spinner } from '../components'
import { setConsent, useConsents } from '../consents'
import { latestProcessed, useAttempts, type AttemptView } from '../data'
import { formatDate, formatDateTime, formatMetricWithUnit, MOVEMENT_LABELS, PHASE_LABELS, readMetric, readMetrics, withUnit } from '../format'
import { href, navigate, useRoute } from '../router'
import { useIsNarrow } from '../useIsNarrow'
import { useFocusThemes } from '../focus'
import { noteLanguage } from '../../../supabase/functions/generate-feedback/contract'
import { phraseOf, readTheme, THEME_KEYS } from './phrase/model'
import { AttemptPicker } from './notes/AttemptPicker'
import {
  attemptDay,
  attemptLine,
  attemptTitle,
  formatClock,
  hasMeasurements,
  historyMeta,
  historyTitle,
  isPhrasePayload,
  isThemeTopic,
  focusLine,
  noteAlert,
  noteText,
  payloadFor,
  payloadLines,
  phraseShare,
  progressLine,
  sentCount,
  topicLabel,
  type FeedbackPayload,
  type NoteAlert,
} from './notes/model'
import './notes/notes.css'

export function Notes() {
  const route = useRoute()
  const attempts = useAttempts()
  const narrow = useIsNarrow()
  const routeId = route.name === 'notes' ? route.attemptId : undefined

  const all = attempts.data
  const attempt = useMemo(
    () => (routeId ? (all?.find((a) => a.id === routeId) ?? null) : latestProcessed(all)),
    [all, routeId],
  )
  const pick = (attemptId: string) => navigate({ name: 'notes', attemptId })

  if (attempts.loading || !all) {
    return (
      <>
        <PageHeader title="Practice notes" />
        {attempts.error ? <ErrorAlert error={attempts.error} onRetry={attempts.refetch} /> : <SkeletonList label="Loading practice notes" />}
      </>
    )
  }

  if (!attempt) {
    const missing = Boolean(routeId)
    return (
      <>
        <PageHeader title="Practice notes" />
        {attempts.error && <ErrorAlert error={attempts.error} onRetry={attempts.refetch} />}
        {missing && latestProcessed(all) && <AttemptPicker id="notes-attempt" attempts={all} value={null} onChange={pick} />}
        <EmptyState
          icon="notes"
          title={missing ? 'That attempt is no longer here' : 'No attempt to write notes about yet'}
          action={
            <a className="btn btn-secondary" href={href(missing ? { name: 'library' } : { name: 'import' })}>
              {missing ? 'Open library' : 'Import clips'}
            </a>
          }
        >
          {missing
            ? 'It may have been deleted, or it belongs to another account. Pick another attempt to see its notes.'
            : 'Notes are written from one analyzed attempt’s metrics only — never from the video. Import and analyze a clip first.'}
        </EmptyState>
      </>
    )
  }

  const eyebrowWide = (
    <>
      {MOVEMENT_LABELS[attempt.session.movement_type]}
      {attempt.session.title ? ` · ${attempt.session.title}` : ''} · {formatDate(attemptDay(attempt))} ·{' '}
      <a href={href({ name: 'review', attemptId: attempt.id })}>{attemptTitle(attempt)}</a>
    </>
  )

  // Keyed by attempt: notes, errors and a running request belong to one attempt.
  return (
    <NotesFor
      key={attempt.id}
      attempt={attempt}
      all={all}
      narrow={narrow}
      eyebrow={narrow ? attemptLine(attempt) : eyebrowWide}
      onPick={pick}
      libraryError={attempts.error ? <ErrorAlert error={attempts.error} onRetry={attempts.refetch} /> : null}
    />
  )
}

interface NotesForProps {
  attempt: AttemptView
  all: readonly AttemptView[]
  narrow: boolean
  eyebrow: ReactNode
  onPick(attemptId: string): void
  libraryError: ReactNode
}

type History =
  | { status: 'loading'; notes: FeedbackNote[]; error: null }
  | { status: 'ready'; notes: FeedbackNote[]; error: null }
  | { status: 'error'; notes: FeedbackNote[]; error: FeedbackError }

type Gen = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: FeedbackError; at: number }

const asFeedbackError = (e: unknown): FeedbackError =>
  e instanceof FeedbackError
    ? e
    : new FeedbackError(0, 'internal', 'Something went wrong while writing the notes.', 'Try again in a moment. Your video and measurements are not affected.')

function NotesFor({ attempt, all, narrow, eyebrow, onPick, libraryError }: NotesForProps) {
  const consents = useConsents()
  const [history, setHistory] = useState<History>({ status: 'loading', notes: [], error: null })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [gen, setGen] = useState<Gen>({ status: 'idle' })
  const [consentBusy, setConsentBusy] = useState(false)
  const [consentError, setConsentError] = useState<{ message: string; recovery?: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // A newer request, a cancel or leaving the screen makes an older answer irrelevant.
  const seq = useRef(0)
  const live = useRef(true)

  const focus = useFocusThemes()
  const language = typeof navigator !== 'undefined' ? noteLanguage(navigator.language) : 'en'
  // Phrase attempts also carry earlier sessions of the same view and the dancer's focus themes.
  const payload = useMemo(() => payloadFor(attempt, all, focus.themes, language), [attempt, all, focus.themes, language])
  const measured = payload !== null && hasMeasurements(payload)
  const values = sentCount(payload)
  const aiAllowed = consents.status === 'ready' && consents.has(AI_CONSENT_SCOPE)
  const notes = history.notes
  const shown = notes.find((n) => n.id === selectedId) ?? notes[0] ?? null

  const loadHistory = useCallback(() => {
    setHistory((h) => ({ status: 'loading', notes: h.notes, error: null }))
    listFeedback(client(), attempt.id).then(
      (list) => live.current && setHistory((h) => ({ status: 'ready', notes: mergeNotes(list, h.notes), error: null })),
      (e) => live.current && setHistory((h) => ({ status: 'error', notes: h.notes, error: asFeedbackError(e) })),
    )
  }, [attempt.id])

  useEffect(() => {
    live.current = true
    loadHistory()
    return () => {
      live.current = false
      seq.current++
    }
  }, [loadHistory])

  const alert: NoteAlert | null = gen.status === 'error' ? noteAlert(gen.error, gen.at, notes.length > 0) : null
  const waitUntil = alert?.retryAt && alert.retryAt > now ? alert.retryAt : null

  // When the rate-limit time passes, the button comes back and the alert goes.
  useEffect(() => {
    if (!alert?.retryAt) return
    const ms = alert.retryAt - Date.now()
    if (ms <= 0) return setNow(Date.now())
    const t = setTimeout(() => {
      setNow(Date.now())
      setGen({ status: 'idle' })
    }, ms + 250)
    return () => clearTimeout(t)
  }, [alert?.retryAt])

  // Back online: the "you're offline" note no longer describes anything.
  useEffect(() => {
    const online = () => setGen((g) => (g.status === 'error' && g.error.code === 'offline' ? { status: 'idle' } : g))
    window.addEventListener('online', online)
    return () => window.removeEventListener('online', online)
  }, [])

  const generate = async () => {
    // Nothing leaves the device without the consent, or when there is nothing measured.
    if (!aiAllowed || !measured || gen.status === 'loading') return
    const mine = ++seq.current
    setGen({ status: 'loading' })
    try {
      const note = await generateFeedbackNote(client(), attempt.id, { regenerate: notes.length > 0 })
      if (mine !== seq.current) return
      setHistory((h) => ({ status: 'ready', notes: mergeNotes([note], h.notes), error: null }))
      setSelectedId(note.id)
      setGen({ status: 'idle' })
    } catch (e) {
      if (mine !== seq.current) return
      const error = asFeedbackError(e)
      setNow(Date.now())
      setGen({ status: 'error', error, at: Date.now() })
    }
  }

  const cancel = () => {
    seq.current++
    setGen({ status: 'idle' })
  }

  const allowAi = async () => {
    setConsentBusy(true)
    setConsentError(null)
    try {
      await setConsent(AI_CONSENT_SCOPE, true)
      if (live.current && gen.status === 'error' && gen.error.code === 'consent_required') setGen({ status: 'idle' })
    } catch (e) {
      const err = e as { message?: string; recovery?: string }
      if (live.current) setConsentError({ message: err.message ?? 'The choice couldn’t be saved.', recovery: err.recovery ?? 'Try again.' })
    } finally {
      if (live.current) setConsentBusy(false)
    }
  }

  const loading = gen.status === 'loading'
  const canGenerate = aiAllowed && measured && !loading && !waitUntil
  const caption = !attempt.metrics
    ? 'This attempt has no measurements yet.'
    : !measured
      ? 'No metric values to send for this attempt.'
      : consents.status === 'ready' && !aiAllowed
        ? 'AI practice notes are off. Nothing is sent.'
        : `Sends ${values} ${payload && isPhrasePayload(payload) ? 'theme' : 'metric'} ${values === 1 ? 'value' : 'values'}. Never video.`

  const generateButton = (block: boolean) => {
    const cls = `btn btn-primary${block ? ' btn-lg btn-block' : ''}`
    if (loading) {
      return (
        <button className={cls} type="button" disabled aria-busy="true">
          <Spinner />
          Generating…
        </button>
      )
    }
    const label = waitUntil
      ? block
        ? `Available at ${formatClock(waitUntil)}`
        : `Generate again at ${formatClock(waitUntil)}`
      : notes.length > 0
        ? 'Generate new notes'
        : 'Generate notes'
    return (
      <button className={cls} type="button" disabled={!canGenerate} onClick={generate}>
        {label}
      </button>
    )
  }

  const reviewHref = href({ name: 'review', attemptId: attempt.id })
  const showGate = consents.status === 'ready' && !aiAllowed
  // The consent alert and the gate say the same thing; the gate carries the action.
  const showAlert = alert && !(alert.action === 'allow_consent' && showGate)

  return (
    <>
      <PageHeader
        title="Practice notes"
        eyebrow={eyebrow}
        backHref={reviewHref}
        actions={
          <div className="v2-notes-gen">
            {generateButton(false)}
            <span className="t-caption">{caption}</span>
          </div>
        }
      />
      {libraryError}
      <AttemptPicker id="notes-attempt" attempts={all} value={attempt.id} onChange={onPick} />

      <div className="v2-notes-cols">
        <section className="v2-notes-main" aria-live="polite">
          {consents.status === 'error' && consents.error && <ErrorAlert error={consents.error} onRetry={consents.reload} />}

          {showAlert && alert && (
            <NotesAlert
              alert={alert}
              reviewHref={reviewHref}
              onRetry={generate}
              onAllow={allowAi}
              busy={consentBusy}
              canRetry={aiAllowed && measured}
            />
          )}

          {showGate && (
            <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }} aria-labelledby="notes-gate-h">
              <h2 className="t-h3" id="notes-gate-h" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Icon name="lock" size={18} />
                AI practice notes are turned off
              </h2>
              <p className="t-small muted">
                Nothing has been sent, and nothing is sent until you allow it. If you do, pressing Generate sends this attempt’s metrics — exactly
                the lines under “{measured ? 'What is sent' : 'What would be sent'}” — to the notes service. Never video, images, keypoints, your
                name or email. Not medical advice. You can turn it off again in Settings.
              </p>
              {consentError && <ErrorAlert error={consentError} onRetry={allowAi} />}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" type="button" onClick={allowAi} disabled={consentBusy} aria-busy={consentBusy || undefined}>
                  {consentBusy && <Spinner />}
                  Allow AI practice notes (metrics only)
                </button>
                <a className="btn btn-ghost" href={href({ name: 'settings' })}>
                  Open Settings
                </a>
              </div>
            </section>
          )}

          {!attempt.metrics ? (
            <Alert
              role="status"
              title="This attempt has no measurements yet."
              actions={
                <a className="btn btn-secondary btn-sm" href={href({ name: 'processing' })}>
                  Open processing
                </a>
              }
            >
              Notes are written from an attempt’s metrics, so no request is sent. Analyze the clip first; your clip stays on this device.
            </Alert>
          ) : (
            !measured && <NothingMeasured attempt={attempt} reviewHref={reviewHref} />
          )}

          {loading && (
            <div className="card" style={{ padding: narrow ? 16 : 24, display: 'flex', flexDirection: 'column', gap: 14 }} aria-busy="true" aria-label="Generating notes">
              <span className="t-caption" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                <Spinner size={12} />
                Writing from {values} {values === 1 ? 'metric' : 'metrics'} · usually under 10 s
              </span>
              <Skeleton height={16} width="92%" />
              <Skeleton height={16} width="70%" />
              <Skeleton height={110} />
              <Skeleton height={110} />
              <button className="btn btn-ghost btn-sm" type="button" onClick={cancel} style={{ alignSelf: 'flex-start' }}>
                Cancel
              </button>
            </div>
          )}

          {!loading && shown && <NoteArticle attempt={attempt} note={shown} latest={shown.id === notes[0]?.id} narrow={narrow} />}

          {!loading && !shown && history.status === 'loading' && (
            <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }} aria-busy="true" aria-label="Loading saved notes">
              <Skeleton height={14} width="40%" />
              <Skeleton height={16} width="90%" />
              <Skeleton height={72} />
            </div>
          )}

          {!loading && !shown && history.status !== 'loading' && measured && (
            <EmptyState
              icon="notes"
              title="No practice notes for this attempt"
              action={
                canGenerate ? (
                  <button className="btn btn-secondary" type="button" onClick={generate}>
                    Generate notes
                  </button>
                ) : undefined
              }
            >
              Notes are written from this attempt’s metrics only — never from the video.
            </EmptyState>
          )}
        </section>

        <aside className="v2-notes-aside">
          <WhatIsSent payload={payload} measured={measured} />
          <section className="card" style={{ overflow: 'hidden' }} aria-labelledby="notes-hist-h">
            <h2 className="t-h3" id="notes-hist-h" style={{ padding: '16px 16px 8px' }}>
              History
            </h2>
            {history.status === 'error' && (
              <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p className="t-small muted">
                  <strong style={{ color: 'var(--text)' }}>{history.error.message}</strong> {history.error.recovery}
                </p>
                <button className="btn btn-secondary btn-sm" type="button" onClick={loadHistory} style={{ alignSelf: 'flex-start' }}>
                  Try again
                </button>
              </div>
            )}
            {history.status === 'loading' && notes.length === 0 && (
              <div style={{ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }} aria-busy="true" aria-label="Loading history">
                <Skeleton height={12} width="70%" />
                <Skeleton height={10} width="45%" />
              </div>
            )}
            {history.status === 'ready' && notes.length === 0 && (
              <p className="t-small muted" style={{ padding: '0 16px 16px' }}>
                No notes have been written for this attempt.
              </p>
            )}
            {notes.length > 0 && (
              <ul>
                {notes.map((n, i) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className="v2-notes-hist"
                      aria-current={n.id === shown?.id ? 'true' : undefined}
                      onClick={() => setSelectedId(n.id)}
                    >
                      <span className="t-small" style={{ fontWeight: 500 }}>
                        {historyTitle(attempt, n)}
                      </span>
                      <span className="t-caption">{historyMeta(n, i)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {narrow && (
        <div className="v2-notes-bar">
          {generateButton(true)}
          <p className="t-caption">{caption}</p>
        </div>
      )}
    </>
  )
}

/** Newest first, one entry per id (a cached answer returns a note that is already listed). */
function mergeNotes(a: readonly FeedbackNote[], b: readonly FeedbackNote[]): FeedbackNote[] {
  const byId = new Map<string, FeedbackNote>()
  for (const n of [...a, ...b]) if (!byId.has(n.id)) byId.set(n.id, n)
  return [...byId.values()].sort((x, y) => y.createdAt.localeCompare(x.createdAt))
}

interface NotesAlertProps {
  alert: NoteAlert
  reviewHref: string
  onRetry(): void
  onAllow(): void
  busy: boolean
  canRetry: boolean
}

/** The designed alert: what happened, what still works, one next step. */
function NotesAlert({ alert, reviewHref, onRetry, onAllow, busy, canRetry }: NotesAlertProps) {
  const action =
    alert.action === 'retry' ? (
      canRetry && (
        <button className="btn btn-secondary btn-sm" type="button" onClick={onRetry}>
          Try again
        </button>
      )
    ) : alert.action === 'allow_consent' ? (
      <button className="btn btn-secondary btn-sm" type="button" onClick={onAllow} disabled={busy}>
        Allow AI practice notes (metrics only)
      </button>
    ) : alert.action === 'sign_in' ? (
      <button className="btn btn-secondary btn-sm" type="button" onClick={() => void signOut().catch(() => {})}>
        Sign in again
      </button>
    ) : alert.action === 'open_review' ? (
      <a className="btn btn-secondary btn-sm" href={reviewHref}>
        Open this attempt in review
      </a>
    ) : alert.action === 'open_processing' ? (
      <a className="btn btn-secondary btn-sm" href={href({ name: 'processing' })}>
        Open processing
      </a>
    ) : null

  return (
    <div className={alert.tone === 'note' ? 'note-box' : 'alert'} role={alert.tone === 'note' ? 'status' : 'alert'} data-code={alert.code}>
      <Icon name={alert.icon} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        <p>
          <strong style={{ color: 'var(--text)' }}>{alert.title}</strong> {alert.body}
        </p>
        {action && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{action}</div>}
      </div>
    </div>
  )
}

/** Every metric is a gap: say why, send nothing. */
function NothingMeasured({ attempt, reviewHref }: { attempt: AttemptView; reviewHref: string }) {
  const readings =
    attempt.session.movement_type === 'phrase'
      ? THEME_KEYS.map((k) => {
          const r = readTheme(phraseOf(attempt.metrics), k)
          return { key: k, def: { label: r.info.label }, reason: r.reason }
        })
      : readMetrics(attempt.metrics, attempt.session.movement_type)
  return (
    <div className="alert" role="status" data-code="nothing_measured">
      <Icon name="warning" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        <p>
          <strong>Nothing could be measured in this attempt, so there is nothing to write notes about.</strong> No request is sent. Check the
          tracking in the review screen, or record again with your whole body in frame.
        </p>
        <ul className="t-small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {readings.map((r) => (
            <li key={r.key}>
              <span style={{ color: 'var(--text)', fontWeight: 500 }}>{r.def.label}:</span> {r.reason ?? 'Not available for this attempt.'}
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="btn btn-secondary btn-sm" href={reviewHref}>
            Open this attempt in review
          </a>
        </div>
      </div>
    </div>
  )
}

function WhatIsSent({ payload, measured }: { payload: FeedbackPayload | null; measured: boolean }) {
  const title = measured ? 'What is sent' : 'What would be sent'
  return (
    <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }} aria-labelledby="notes-sent-h">
      <h2 className="t-h3" id="notes-sent-h">
        {title}
      </h2>
      {payload && isPhrasePayload(payload) && <PhraseIncluded payload={payload} />}
      {payload ? (
        <pre className="well mono v2-notes-pre">{payloadLines(payload).join('\n')}</pre>
      ) : (
        <p className="t-small muted">This attempt has no measurements, so there is nothing to send.</p>
      )}
      <p className="t-caption">
        {payload && !measured ? 'No metric has a value, so no request is made for this attempt. ' : ''}
        No video, images, keypoints, name or email.
      </p>
    </section>
  )
}

/** Phrase: which earlier sessions and focus themes go along, in words. */
function PhraseIncluded({ payload }: { payload: Parameters<typeof phraseShare>[0] }) {
  const share = phraseShare(payload)
  return (
    <ul className="t-small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }} aria-label="Also included">
      <li>
        <span style={{ fontWeight: 500 }}>This attempt:</span> six theme values and an event summary
        {share.earlierAttempts ? `, plus ${share.earlierAttempts} earlier attempt${share.earlierAttempts === 1 ? '' : 's'} of this session` : ''}.
      </li>
      <li>
        <span style={{ fontWeight: 500 }}>Progress:</span> {progressLine(share)}
      </li>
      <li>
        <span style={{ fontWeight: 500 }}>Focus:</span> {focusLine(share)}
      </li>
    </ul>
  )
}

interface NoteArticleProps {
  attempt: AttemptView
  note: FeedbackNote
  latest: boolean
  narrow: boolean
}

function NoteArticle({ attempt, note, latest, narrow }: NoteArticleProps) {
  const r = note.response
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(noteText(attempt, note))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  const n = r.observations.length
  return (
    <article className="card" style={{ padding: narrow ? 16 : 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span className="t-caption">
          Generated {formatDateTime(note.createdAt)} · {n} {n === 1 ? 'observation' : 'observations'}
          {latest ? '' : ' · earlier version'}
        </span>
        <button className="btn btn-ghost btn-sm" type="button" onClick={copy}>
          <Icon name={copied ? 'check' : 'copy'} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 className="t-label">Summary</h2>
        <p style={{ fontSize: narrow ? 14 : 16, lineHeight: narrow ? '22px' : '26px' }}>{r.summary}</p>
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 className="t-label">Observations</h2>
        {r.observations.map((o, i) => {
          const topic = o.metric
          // A phrase note is about themes: their value comes from attempt_metrics.phrase.
          const theme = isThemeTopic(topic) ? readTheme(phraseOf(attempt.metrics), topic) : null
          const reading = isThemeTopic(topic) ? null : readMetric(attempt.metrics, topic)
          const valueText = theme ? (theme.value === null ? '—' : withUnit(theme.text, theme.info.unit)) : formatMetricWithUnit(topic as Parameters<typeof formatMetricWithUnit>[0], reading!.value)
          return (
            <div key={`${o.metric}-${i}`} className="well v2-notes-obs">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="mono subtle" style={{ fontSize: 12 }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span style={{ fontWeight: 600 }}>{topicLabel(topic)}</span>
                <span className="num" title="Measured in this attempt">
                  {valueText}
                </span>
                {reading && reading.phases.length > 0 && (
                  <span className="tag" style={{ background: 'var(--surface)' }}>
                    {reading.phases.map((p) => PHASE_LABELS[p] ?? p).join(' + ')}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <ConfBadge level={o.confidence} />
              </div>
              <div className="v2-notes-obs-grid">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="t-caption">Observed</span>
                  <p className="t-small">{o.observation}</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="t-caption">Practice suggestion</span>
                  <p className="t-small">{o.suggestion}</p>
                </div>
              </div>
            </div>
          )
        })}
      </section>
      {r.cautions.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 className="t-label">Cautions</h2>
          <ul className="t-small muted" style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 18, listStyle: 'disc' }}>
            {r.cautions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}
      <NoteBox title="Not medical advice.">{DISCLAIMER}</NoteBox>
    </article>
  )
}

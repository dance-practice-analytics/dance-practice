// Screen 6 — Processing (FR-3.3.1–3.3.6).
// Design: Processing.dc.html, ProcessingMobile.dc.html; error patterns in States.dc.html.
// The queue itself lives in ../pipeline.ts (memory of this tab). This screen shows it,
// drives pause / resume / cancel / retry, and lists attempts that are still waiting in
// the database without their file (after a reload) so the file can be chosen again.
// The pipeline does not expose frames while a clip is running, so the preview shows the
// last finished clip with the skeleton from its saved pose data — never a made-up one.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { baseName } from '../../data/clipFile'
import { attemptTrim } from '../../data/repo'
import { getClip, hasClip, relink, useClip } from '../clips'
import { Alert, EmptyState, ErrorAlert, Icon, PageHeader, PrivacyPill, SkeletonList, StatusPill, VideoStage } from '../components'
import { useAttempts, type AttemptView } from '../data'
import { MOVEMENT_LABELS, PHASE_LABELS, phaseAt, VIEW_LABELS } from '../format'
import { cancel, enqueue, getCachedSeries, pause, resume, usePipeline, type PipelineItem, type PipelineJob } from '../pipeline'
import { href } from '../router'
import { useOfflineQueue } from '../offline/uploadQueue'
import { useIsNarrow } from '../useIsNarrow'
import { useThumb } from './import/probe'
import { useBackups } from '../videoBackup'
import { BackupNotice } from './processing/BackupNotice'
import { OfflineNotice } from './processing/OfflineNotice'
import {
  batchCounts,
  batchPercent,
  entryTimeLeft,
  estimateTimeLeft,
  formatClock,
  formatTimeLeft,
  measuredFps,
  measureSpeed,
  trackingFacts,
  trackingNote,
  type QueueEntry,
} from './processing/model'

// ---------- rows removed from the list (the pipeline has no single-item remove) ----------

const dismissedAt = new Map<string, number | null>()
const dismissListeners = new Set<() => void>()
let dismissVersion = 0

function dismiss(item: PipelineItem) {
  dismissedAt.set(item.attemptId, item.finishedAt)
  dismissVersion++
  dismissListeners.forEach((l) => l())
}

/** A dismissal only covers the run it was made on: a re-run brings the row back. */
const isDismissed = (item: PipelineItem) =>
  item.status !== 'queued' && item.status !== 'processing' && dismissedAt.has(item.attemptId) && dismissedAt.get(item.attemptId) === item.finishedAt

const subscribeDismissed = (cb: () => void) => {
  dismissListeners.add(cb)
  return () => {
    dismissListeners.delete(cb)
  }
}

// The preview switch survives leaving and coming back to the screen.
let previewOn = true

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

const jobOf = (a: AttemptView): PipelineJob => ({ attemptId: a.id, movement: a.session.movement_type, clipName: a.clip_name, trim: attemptTrim(a) })

function metaOf(attempt: AttemptView | undefined, item?: PipelineItem): string {
  if (!attempt) return item ? MOVEMENT_LABELS[item.movement] : ''
  const s = attempt.session
  return [s.subject_code, MOVEMENT_LABELS[s.movement_type], s.camera_view ? VIEW_LABELS[s.camera_view].replace(' view', '').toLowerCase() : null]
    .filter(Boolean)
    .join(' · ')
}

export function Processing() {
  const narrow = useIsNarrow()
  const pipe = usePipeline()
  const backups = useBackups()
  const attempts = useAttempts()
  useSyncExternalStore(subscribeDismissed, () => dismissVersion)
  const [show, setShow] = useState(previewOn)
  const [relinkNote, setRelinkNote] = useState<string | null>(null)
  const [relinking, setRelinking] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const byId = useMemo(() => new Map((attempts.data ?? []).map((a) => [a.id, a])), [attempts.data])
  const items = pipe.items.filter((it) => !isDismissed(it))
  // Waiting in the database but not in this tab's queue: the page was reloaded (or the
  // tab closed mid-clip, which leaves a stale 'processing'). They need their file again.
  // Results waiting in the offline queue already have everything but the upload.
  const offline = useOfflineQueue()
  const orphans = (attempts.data ?? []).filter(
    (a) =>
      (a.status === 'queued' || a.status === 'processing') &&
      !pipe.items.some((it) => it.attemptId === a.id) &&
      !offline.ids.includes(a.id),
  )

  const open = items.some((it) => it.status === 'queued' || it.status === 'processing')
  const now = useNow(open)

  // Leaving the page stops the queue: the clips only exist in this tab.
  useEffect(() => {
    if (!open) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [open])

  const entries: QueueEntry[] = items.map((it) => ({
    status: it.status,
    fraction: it.fraction,
    durationS: byId.get(it.attemptId)?.duration_s ?? null,
    startedAt: it.startedAt,
    finishedAt: it.finishedAt,
    frames: it.frames,
  }))
  const counts = batchCounts(entries)
  const percent = batchPercent(entries)
  const speed = measureSpeed(entries, now)
  const left = estimateTimeLeft(entries, now)
  const fps = measuredFps(entries)

  const doneItems = items.filter((it) => it.status === 'done').sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
  const previewId = doneItems.find((it) => getCachedSeries(it.attemptId))?.attemptId ?? null
  const latestDone = doneItems[0]?.attemptId ?? null

  async function onFilesChosen(files: File[]) {
    if (files.length === 0) return
    setRelinking(true)
    setRelinkNote(null)
    // Any waiting or failed attempt whose video isn't open here can take its file back.
    const failedHere = items.filter((it) => it.status === 'failed' && !hasClip(it.attemptId)).map((it) => byId.get(it.attemptId))
    const candidates = [...orphans, ...failedHere.filter((a): a is AttemptView => !!a)]
    const jobs: PipelineJob[] = []
    const missed: string[] = []
    try {
      for (const file of files) {
        const id = await relink(file, candidates)
        const attempt = id ? byId.get(id) : null
        if (attempt) jobs.push({ ...jobOf(attempt), clipName: attempt.clip_name ?? baseName(file.name) })
        else missed.push(baseName(file.name))
      }
    } finally {
      setRelinking(false)
    }
    if (jobs.length > 0) enqueue(jobs)
    if (missed.length > 0) {
      setRelinkNote(
        `${missed.join(', ')} ${missed.length === 1 ? 'isn’t' : 'aren’t'} the file of a waiting clip. Choose exactly the file that was imported; it is matched by its fingerprint.`,
      )
    }
  }
  const chooseAgain = () => fileInput.current?.click()

  // With the opt-in backup on, the videos of this queue are uploaded after processing.
  const backingUp = backups.length > 0
  const header = (
    <PageHeader
      title="Processing"
      subtitle="Pose estimation runs in this browser. Keep this tab open; it pauses if the computer sleeps."
      actions={<PrivacyPill>{backingUp ? 'Processed on this device · video backup on' : undefined}</PrivacyPill>}
      backHref={href({ name: 'import' })}
    />
  )

  if (items.length === 0 && orphans.length === 0) {
    return (
      <>
        {header}
        <OfflineNotice />
        <BackupNotice />
        {attempts.error && <ErrorAlert error={attempts.error} onRetry={attempts.refetch} />}
        {attempts.loading ? (
          <SkeletonList rows={3} label="Loading queue" />
        ) : (
          <EmptyState
            icon="processing"
            title="Nothing in the queue"
            action={
              <a className="btn btn-primary" href={href({ name: 'import' })}>
                Import clips
              </a>
            }
          >
            Imported clips wait here while pose estimation runs on this device.
          </EmptyState>
        )}
      </>
    )
  }

  const actions: ReactNode = open ? (
    <>
      <button
        className={narrow ? 'btn btn-secondary btn-lg' : 'btn btn-secondary'}
        type="button"
        aria-pressed={pipe.paused}
        onClick={() => (pipe.paused ? resume() : pause())}
      >
        <Icon name={pipe.paused ? 'play' : 'pause'} />
        {pipe.paused ? 'Resume' : narrow ? 'Pause' : 'Pause all'}
      </button>
      <button className={narrow ? 'btn btn-ghost btn-lg' : 'btn btn-ghost'} type="button" onClick={() => cancel()}>
        {narrow ? 'Cancel' : 'Cancel remaining'}
      </button>
    </>
  ) : items.length > 0 ? (
    <>
      {latestDone && (
        <a className={narrow ? 'btn btn-primary btn-lg' : 'btn btn-primary'} href={href({ name: 'review', attemptId: latestDone })}>
          Review latest clip
          <Icon name="arrow-right" />
        </a>
      )}
      <a className={narrow ? 'btn btn-secondary btn-lg' : 'btn btn-secondary'} href={href({ name: 'library' })}>
        Open library
      </a>
    </>
  ) : null

  const pausedText = pipe.paused ? (pipe.activeId ? 'Pausing after the clip in progress' : 'Paused') : null
  const detail = open
    ? [
        pausedText ?? (left === null ? 'Estimating time left…' : formatTimeLeft(left)),
        '1 at a time',
        pipe.delegate ? (pipe.delegate === 'GPU' ? 'GPU' : 'CPU (slower)') : 'loading the pose model',
        fps ? `~${Math.round(fps)} frames/s` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : items.length > 0
      ? ['Nothing left in the queue', counts.failed ? `${counts.failed} failed` : null, counts.cancelled ? `${counts.cancelled} cancelled` : null]
          .filter(Boolean)
          .join(' · ')
      : 'No clip is running in this tab.'

  const batch = items.length > 0 && (
    <section className="card" style={{ padding: narrow ? 16 : 20, display: 'flex', flexDirection: 'column', gap: narrow ? 10 : 14 }} aria-label="Batch progress">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px', alignItems: 'center' }}>
        <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 2 }} role="status">
          <span className={narrow ? 't-h3' : 't-h2'}>
            {counts.done} of {counts.total} {counts.total === 1 ? 'clip' : 'clips'} done
          </span>
          <span className="t-small muted">{detail}</span>
        </div>
        {!narrow && actions}
      </div>
      <div className="bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Batch progress" style={{ height: 8 }}>
        <i style={{ width: `${percent}%` }} />
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <StatusPill status="done" label={`${counts.done} done`} />
        {counts.processing > 0 && <StatusPill status="processing" label={`${counts.processing} processing`} />}
        {counts.queued > 0 && <StatusPill status="queued" label={`${counts.queued} queued`} />}
        {counts.failed > 0 && <StatusPill status="failed" label={`${counts.failed} failed`} />}
        {counts.cancelled > 0 && <StatusPill status="cancelled" label={`${counts.cancelled} cancelled`} />}
      </div>
      {narrow && open && <p className="t-caption">Keep the app open. It pauses if the screen locks.</p>}
    </section>
  )

  let queuedSeen = 0
  const queue = (
    <section className="card" style={{ flex: narrow ? 'none' : '999 1 560px', minWidth: 0, overflow: 'hidden' }} aria-labelledby="v2-proc-q">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
        <h2 className="t-h3" id="v2-proc-q">
          Queue
        </h2>
        <a href={href({ name: 'library' })} className="t-small">
          {counts.done > 0 ? `${counts.done} done · view in library` : 'View library'}
        </a>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((item) => {
          const position = item.status === 'queued' ? ++queuedSeen : 0
          return (
            <QueueRow
              key={item.attemptId}
              item={item}
              attempt={byId.get(item.attemptId)}
              position={position}
              paused={pipe.paused}
              timeLeft={entryTimeLeft(
                { ...item, durationS: byId.get(item.attemptId)?.duration_s ?? null },
                speed,
              )}
              narrow={narrow}
              onChooseAgain={chooseAgain}
            />
          )
        })}
        {orphans.map((a) => (
          <li
            key={a.id}
            data-orphan={a.id}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}
          >
            <div className="thumb" style={{ width: 56, height: 34, flex: 'none' }} />
            <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="mono" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
                {a.clip_name ?? `Attempt ${a.number}`}
              </span>
              <span className="t-caption">{metaOf(a)}</span>
            </div>
            <StatusPill status="queued" label="Waiting for its file" />
            <button className="btn btn-secondary btn-sm" type="button" disabled={relinking} onClick={chooseAgain}>
              Choose the file again
            </button>
          </li>
        ))}
      </ul>
    </section>
  )

  const preview = <PreviewCard attemptId={previewId} attempt={previewId ? byId.get(previewId) : undefined} show={show} narrow={narrow} running={open} onShow={(on) => setShow((previewOn = on))} />

  const notices = (
    <>
      <OfflineNotice />
      <BackupNotice />
      {attempts.error && <ErrorAlert error={attempts.error} onRetry={attempts.refetch} />}
      {orphans.length > 0 && (
        <Alert
          role="status"
          title={`${orphans.length} ${orphans.length === 1 ? 'clip is' : 'clips are'} waiting for ${orphans.length === 1 ? 'its' : 'their'} video file.`}
          actions={
            <button className="btn btn-secondary btn-sm" type="button" disabled={relinking} onClick={chooseAgain}>
              {relinking ? 'Matching files…' : orphans.length === 1 ? 'Choose the file again' : 'Choose the files again'}
            </button>
          }
        >
          The page was reloaded or closed before {orphans.length === 1 ? 'it was' : 'they were'} processed, and videos are never stored. Choose the
          same {orphans.length === 1 ? 'file' : 'files'} to continue; {orphans.length === 1 ? 'it stays' : 'they stay'} on this device.
        </Alert>
      )}
      {relinkNote && <Alert title="No match.">{relinkNote}</Alert>}
      <input
        ref={fileInput}
        type="file"
        accept="video/*"
        multiple
        className="v2-sr"
        tabIndex={-1}
        aria-label="Choose the video files again"
        data-testid="processing-files"
        onChange={(e) => {
          void onFilesChosen([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
    </>
  )

  if (narrow) {
    return (
      <>
        {header}
        <PrivacyPill style={{ alignSelf: 'flex-start' }}>{backingUp ? 'Processing on this phone · video backup on' : 'Processing on this phone · video not uploaded'}</PrivacyPill>
        {preview}
        {batch}
        {notices}
        {queue}
        {actions && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>{actions}</div>}
      </>
    )
  }

  return (
    <>
      {header}
      {batch}
      {notices}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        {queue}
        {preview}
      </div>
    </>
  )
}

// ---------- one queue row ----------

const STEP_LABEL = {
  loading_model: 'Loading the pose model…',
  pose: null,
  saving_keypoints: 'Saving keypoints…',
  metrics: 'Computing measurements…',
} as const

interface QueueRowProps {
  item: PipelineItem
  attempt: AttemptView | undefined
  /** 1-based place among the queued clips; 0 when not queued. */
  position: number
  paused: boolean
  timeLeft: number | null
  narrow: boolean
  onChooseAgain(): void
}

function QueueRow({ item, attempt, position, paused, timeLeft, narrow, onChooseAgain }: QueueRowProps) {
  const file = item.clipName ?? attempt?.clip_name ?? 'Clip'
  const thumb = useThumb(getClip(item.attemptId)?.file)
  const pct = item.status === 'done' ? 100 : item.status === 'processing' ? Math.round(item.fraction * 100) : 0
  const idle = item.status !== 'processing' && item.status !== 'done'
  const hasFile = hasClip(item.attemptId)
  const job: PipelineJob = { attemptId: item.attemptId, movement: item.movement, clipName: item.clipName, trim: item.trim }

  let label: string | undefined
  let eta = ''
  if (item.status === 'processing') {
    label = (item.step && STEP_LABEL[item.step]) ?? `Processing ${pct}%`
    eta = item.step === 'pose' && timeLeft !== null ? `${formatClock(timeLeft)} left` : ''
  } else if (item.status === 'queued') {
    eta = paused ? 'paused' : position === 1 ? 'next' : `#${position}`
  } else if (item.status === 'done') {
    if (item.pendingUpload) label = 'Done · waiting to upload'
    eta = item.frames !== null && item.trackedFrames !== null ? `${item.trackedFrames} of ${item.frames} frames` : ''
  } else {
    eta = 'stopped'
  }

  const note = item.status === 'done' ? trackingNote(item.frames, item.trackedFrames) : null
  const remove =
    item.status === 'processing'
      ? { label: `Cancel ${file}`, run: () => cancel(item.attemptId) }
      : item.status === 'queued'
        ? { label: `Remove ${file} from queue`, run: () => cancel(item.attemptId) }
        : { label: `Remove ${file} from this list`, run: () => dismiss(item) }

  return (
    <li
      data-status={item.status}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '10px 16px',
        alignItems: 'center',
        padding: '14px 16px',
        borderBottom: '1px solid var(--line)',
        background: item.status === 'failed' ? 'var(--surface-2)' : undefined,
      }}
    >
      <div className="thumb" style={{ width: 56, height: 34, flex: 'none' }}>
        {thumb && <img src={thumb} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />}
      </div>
      <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="mono" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
          {file}
        </span>
        <span className="t-caption">{metaOf(attempt, item)}</span>
      </div>
      <div style={{ flex: narrow ? '1 1 200px' : '0 1 260px', minWidth: 160, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <StatusPill status={item.status} label={label} />
          <span className="mono subtle" style={{ fontSize: 12 }}>
            {eta}
          </span>
        </div>
        <div
          className={idle ? 'bar is-idle' : 'bar'}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progress of ${file}`}
        >
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {item.status === 'done' && (
          <a className="btn btn-ghost btn-sm" href={href({ name: 'review', attemptId: item.attemptId })}>
            Review
          </a>
        )}
        {item.status === 'cancelled' &&
          (hasFile ? (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => enqueue([job])}>
              <Icon name="refresh" />
              Process
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm" type="button" onClick={onChooseAgain}>
              Choose the file again
            </button>
          ))}
        <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={remove.label} onClick={remove.run}>
          <Icon name="close" />
        </button>
      </div>

      {note && (
        <p className="t-caption hatch" style={{ flex: '1 1 100%', marginLeft: narrow ? 0 : 72, padding: '8px 10px', borderRadius: 8 }}>
          {note}
        </p>
      )}

      {item.status === 'failed' && (
        <div className="alert" role="alert" style={{ flex: '1 1 100%', marginLeft: narrow ? 0 : 72, padding: '12px 14px' }}>
          <Icon name="warning" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <p>
              <strong>{item.reason ?? 'Processing stopped unexpectedly.'}</strong> {item.recovery}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {hasFile ? (
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => enqueue([job])}>
                  <Icon name="refresh" />
                  Retry
                </button>
              ) : (
                <button className="btn btn-secondary btn-sm" type="button" onClick={onChooseAgain}>
                  Choose the file again
                </button>
              )}
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => dismiss(item)}>
                Skip clip
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  )
}

// ---------- preview ----------

interface PreviewCardProps {
  /** The last finished clip whose pose data is in memory, if any. */
  attemptId: string | null
  attempt: AttemptView | undefined
  show: boolean
  narrow: boolean
  /** True while the queue still has work. */
  running: boolean
  onShow(on: boolean): void
}

function PreviewCard({ attemptId, attempt, show, narrow, running, onShow }: PreviewCardProps) {
  const series = attemptId ? getCachedSeries(attemptId) : null
  const facts = useMemo(() => (series ? trackingFacts(series) : null), [series])
  const phases = attempt?.metrics?.phases ?? null
  const phaseNames = phases ? [...new Set(phases.map((p) => PHASE_LABELS[p.phase].toLowerCase()))] : null
  const name = attempt?.clip_name ?? null

  return (
    <aside className="card" style={{ flex: narrow ? 'none' : '1 1 320px', minWidth: 0, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} aria-label="Preview">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="t-h3">Preview</h2>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }} className="t-small muted">
          Show
          <input className="switch" type="checkbox" role="switch" checked={show} onChange={(e) => onShow(e.target.checked)} />
        </label>
      </div>

      {!show ? (
        <VideoStage chrome={false} placeholder={<span className="t-small">Preview is off. Processing continues.</span>} />
      ) : attemptId && series ? (
        <PreviewPlayer attemptId={attemptId} attempt={attempt} narrow={narrow} />
      ) : (
        <VideoStage
          chrome={false}
          placeholder={
            <span className="t-small">
              {running ? 'The first finished clip appears here with its skeleton.' : 'No finished clip from this tab to show.'}
            </span>
          }
        />
      )}

      {show && series && facts && (
        <>
          <p className="mono t-small" style={{ overflowWrap: 'anywhere' }}>
            {name ?? 'Last finished clip'}
          </p>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 12px', margin: 0 }} className="t-small">
            <dt className="muted">Frames tracked</dt>
            <dd style={{ margin: 0 }} className="num">
              {facts.tracked} of {facts.frames}
            </dd>
            <dt className="muted">Phases found</dt>
            <dd style={{ margin: 0 }}>{phaseNames === null ? '…' : phaseNames.length > 0 ? phaseNames.join(', ') : 'none'}</dd>
            <dt className="muted">Low-confidence frames</dt>
            <dd style={{ margin: 0 }} className="num">
              {facts.lowConfidence}
              {facts.weakest ? ` · ${facts.weakest}` : ''}
            </dd>
          </dl>
        </>
      )}
      <p className="t-caption">
        Shows the last finished clip; a clip in progress has no skeleton yet. Preview uses extra battery. Turning it off doesn’t change results.
      </p>
    </aside>
  )
}

/** Plays the finished clip in a loop with the skeleton of the frame on screen. */
function PreviewPlayer({ attemptId, attempt, narrow }: { attemptId: string; attempt: AttemptView | undefined; narrow: boolean }) {
  const clip = useClip(attemptId)
  const series = getCachedSeries(attemptId)
  const video = useRef<HTMLVideoElement>(null)
  const [index, setIndex] = useState(0)
  const count = series?.frames.length ?? 0
  const fps = series?.fps ?? 30

  // The frame index follows the video's own clock, so picture and skeleton can't drift.
  useEffect(() => {
    if (count === 0) return
    let raf = 0
    const tick = () => {
      const v = video.current
      if (v) {
        const i = Math.min(count - 1, Math.max(0, Math.floor(v.currentTime * fps + 1e-6)))
        setIndex((prev) => (prev === i ? prev : i))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [count, fps])

  if (!series) return null
  const frame = series.frames[Math.min(index, count - 1)] ?? null
  const phase = phaseAt(attempt?.metrics?.phases, frame?.t ?? 0)
  const view = attempt?.session.camera_view
  return (
    <VideoStage
      src={clip?.objectUrl}
      frame={frame}
      width={series.width}
      height={series.height}
      videoRef={video}
      videoProps={{ autoPlay: true, loop: true }}
      view={view ? VIEW_LABELS[view].replace(' view', '') : undefined}
      timecode={`f ${Math.min(index, count - 1) + 1} / ${count}`}
      phase={phase ? PHASE_LABELS[phase.phase] : undefined}
      privacy={narrow ? undefined : false}
      ariaLabel="Pose skeleton of the last finished clip"
    />
  )
}

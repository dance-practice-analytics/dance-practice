// Screen 7 — Review workspace (FR-3.5.x).
// Design: Review.dc.html, ReviewMobile.dc.html, VideoStage.dc.html; empty / loading /
// error patterns in States.dc.html. See ../README.md.
//
// One attempt: the local video (when it is on this device) with the tracked skeleton,
// one clock for stage, transport and timelines, the phases, where tracking is missing
// or weak, and the measurements. Values only — nothing here grades.
// The page itself renders on user actions; only the stage, the playhead, the readouts
// and the ribbon follow the clock (see review/useClock.ts).

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { compareAttempts, type MetricComparison } from '../../insights'
import type { MetricKey, PhaseSpan } from '../../metrics/types'
import type { PoseSeries } from '../../pose/types'
import { useClip } from '../clips'
import { Alert, AttemptThumb, CompactGap, EmptyState, ErrorAlert, Icon, MetricCard, metricCardProps, PageHeader, SkeletonWorkspace } from '../components'
import { latestProcessed, useAttempt, useAttempts, type AttemptView } from '../data'
import {
  differenceText,
  formatDateTime,
  formatNumber,
  formatSeconds,
  formatTimecode,
  isCompactGap,
  MOVEMENT_LABELS,
  readMetrics,
  STATUS_LABELS,
} from '../format'
import { href, navigate, useRoute } from '../router'
import { useIsNarrow } from '../useIsNarrow'
import { useViewMode, ViewModeSwitch } from '../viewMode'
import { AttemptNote } from './review/AttemptNote'
import { referenceFor } from './compare/pick'
import { createClock, type Clock } from './review/clock'
import { attemptName, comparisonInput, describeAttempt, neighbourInSession, sessionName } from './review/labels'
import { ReferenceTag, ReferenceToggle } from './review/ReferenceToggle'
import { RelinkOverlay } from './review/Relink'
import { CAMERA_WORDS, StageInfo } from './review/StageInfo'
import { CameraSwitch, DIAGONAL_HINT, NOT_FILMED } from './review/CameraSwitch'
import { cameraCount, clampTime, handOff, takeHandoff, viewsOfTake } from './review/takes'
import { usePrefetchSeries } from './review/prefetchTake'
import type { CameraView } from '../../data/schema'
import { isSampleAttempt } from '../sampleMarkers'
import './review/review.css'
import { SyncedStage } from './review/SyncedStage'
import { buildTrace, countBands, niceMax, seriesEnd, traceMax, trackingBands, trunkAt, visibilityAt } from './review/timeline'
import { BandLayer, PhaseRibbon, ScrubTrack, TimeAxis, TraceLayer, TraceTrack, TrackingReadout, TrunkReadout } from './review/Tracks'
import { Switch, Transport } from './review/Transport'
import { countRender, useClockValue, useTransportKeys } from './review/useClock'
import type { PhraseResult } from '../../metrics/phrase'
import { saveFocus, useFocusThemes } from '../focus'
import { eventSummary, labelDoubtText, phraseOf, toggleFocus } from './phrase/model'
import { PhraseTimeline } from './phrase/PhraseTimeline'
import { ThemeCards } from './phrase/ThemeCards'

const NO_PHASES: readonly PhaseSpan[] = []
const NARROW_UNIT: Record<MetricKey, string> = {
  trunk_inclination_deg: '°',
  pelvis_ankle_offset_norm: '% of leg',
  balance_duration_s: 's',
  knee_tracking_dev_deg: '°',
  turn_count: 'turns',
}

export function Review() {
  const route = useRoute()
  const all = useAttempts()
  const routeId = route.name === 'review' ? route.attemptId : undefined
  // `#/review` without an id opens the latest processed attempt.
  const latest = useMemo(() => latestProcessed(all.data), [all.data])
  const id = routeId ?? latest?.id ?? null
  const detail = useAttempt(id)

  if (all.loading || (id !== null && detail.loading && !detail.error)) {
    return (
      <>
        <PageHeader title="Review" backHref={href({ name: 'library' })} />
        <SkeletonWorkspace caption="Loading saved keypoints…" label="Loading review workspace" />
      </>
    )
  }
  const error = all.error ?? detail.error
  if (error && !detail.data) {
    return (
      <>
        <PageHeader title="Review" backHref={href({ name: 'library' })} />
        <ErrorAlert error={error} onRetry={detail.refetch} />
      </>
    )
  }
  if (id === null) {
    return (
      <>
        <PageHeader title="Review" subtitle="One attempt: video with the tracked skeleton, phases and measurements." />
        <EmptyState
          icon="review"
          title="No processed clips yet"
          action={
            <a className="btn btn-primary" href={href({ name: 'import' })}>
              Import clips
            </a>
          }
        >
          Once a clip has been processed on this device, its skeleton, phases and measurements open here.
        </EmptyState>
      </>
    )
  }
  if (!detail.data) {
    return (
      <>
        <PageHeader title="Review" backHref={href({ name: 'library' })} />
        <EmptyState
          icon="review"
          title="That attempt isn’t in your library"
          action={
            <a className="btn btn-secondary" href={href({ name: 'library' })}>
              Open library
            </a>
          }
        >
          It may have been deleted, or the link belongs to another account. Your other attempts are in the library.
        </EmptyState>
      </>
    )
  }
  const { attempt, series } = detail.data
  return <Workspace key={attempt.id} attempt={attempt} series={series} attempts={all.data ?? []} />
}

// ---------- the workspace of one attempt ----------

interface WorkspaceProps {
  attempt: AttemptView
  series: PoseSeries | null
  attempts: readonly AttemptView[]
}

function Workspace({ attempt, series, attempts }: WorkspaceProps) {
  countRender('Review')
  const narrow = useIsNarrow()
  const simple = useViewMode() === 'simple'
  const clip = useClip(attempt.id)
  const [videoFailed, setVideoFailed] = useState(false)
  const [skeletonOn, setSkeletonOn] = useState(true)
  const [loopOn, setLoopOn] = useState(false)

  const usable = series !== null && series.frames.length > 0
  const duration = usable ? seriesEnd(series) : (attempt.duration_s ?? 0)
  const fps = usable ? series.fps : (attempt.fps ?? 0)
  const clock = useMemo(() => {
    const c = createClock()
    c.load(duration, fps)
    return c
  }, [duration, fps])
  useEffect(() => () => clock.pause(), [clock])
  // Arrived from the camera switch: the same moment of the take, playing if it was.
  useEffect(() => {
    const h = takeHandoff(attempt.id)
    if (!h) return
    clock.setRate(h.rate)
    clock.seek(clampTime(h.time, duration))
    if (h.playing) clock.play()
  }, [clock, attempt.id, duration])
  const [correcting, setCorrecting] = useState(false)

  const session = attempt.session
  const inSession = useMemo(() => attempts.filter((a) => a.session_id === attempt.session_id), [attempts, attempt.session_id])
  const other = useMemo(() => neighbourInSession(attempt, inSession), [attempt, inSession])
  const phases = attempt.metrics?.phases?.length ? attempt.metrics.phases : NO_PHASES
  const readings = readMetrics(attempt.metrics, session.movement_type)
  // Phrase attempts (movement 'phrase') show events and theme measures instead of phases and the relevé measures.
  const isPhrase = session.movement_type === 'phrase'
  const phrase = isPhrase ? phraseOf(attempt.metrics) : null
  const focus = useFocusThemes()
  const otherName = other ? `attempt ${other.number}` : ''
  // This attempt against its neighbour: `b − a` = this − the other.
  const rows = useMemo(() => {
    if (!other) return new Map<string, MetricComparison>()
    const cmp = compareAttempts(comparisonInput(other), comparisonInput(attempt), { a: `attempt ${other.number}`, b: 'this attempt' })
    return new Map(cmp.rows.map((r) => [r.metric as string, r]))
  }, [other, attempt])

  const onPhase = useCallback(
    (direction: -1 | 1) => {
      const t = clock.get().time
      const starts = phases.map((p) => p.start)
      const target = direction > 0 ? starts.find((s) => s > t + 1e-3) : [...starts].reverse().find((s) => s < t - 1e-3)
      if (target !== undefined) clock.seek(target)
    },
    [clock, phases],
  )
  useTransportKeys(clock, { onPhase: phases.length ? onPhase : undefined })

  const src = clip && !videoFailed ? clip.objectUrl : null
  // FR-3.6.6: with a reference of this movement (another attempt), Compare opens on it as A.
  const reference = useMemo(() => {
    const ref = referenceFor(attempt, attempts.filter((a) => a.status === 'done'))
    return ref && ref.id !== attempt.id ? ref : null
  }, [attempt, attempts])
  const compareHref = href(
    reference
      ? { name: 'compare', a: reference.id, b: attempt.id }
      : other
        ? { name: 'compare', a: attempt.id, b: other.id }
        : { name: 'compare', a: attempt.id },
  )
  const compareLabel = reference ? 'Compare with reference' : other ? `Compare with attempt ${other.number}` : 'Compare'
  const notesHref = href({ name: 'notes', attemptId: attempt.id })
  const chatHref = href({ name: 'chat', attemptId: attempt.id })
  // Where the camera stood (set at import); other cameras of the same take are one switch away.
  const view = session.camera_view ? `${CAMERA_WORDS[session.camera_view]} camera` : null
  const takeViews = useMemo(() => viewsOfTake(attempt, attempts), [attempt, attempts])
  const cameras = cameraCount(takeViews)
  usePrefetchSeries(Object.values(takeViews).flatMap((x) => (x && x.id !== attempt.id && x.status === 'done' ? [x.id] : [])))
  const switchTo = (v: CameraView) => {
    const target = takeViews[v]
    if (!target || target.id === attempt.id) return
    const { time, playing, rate } = clock.get()
    handOff({ time, playing, rate, target: target.id })
    navigate({ name: 'review', attemptId: target.id }, { replace: true })
  }
  const unavailable: Partial<Record<CameraView, string>> = {}
  for (const v of ['front', 'side', 'diagonal'] as const) {
    if (!takeViews[v]) unavailable[v] = session.camera_view ? NOT_FILMED : 'Set where this camera stood first'
  }
  const sourceNote =
    session.camera_view && cameras > 1 ? (
      <p className="v2-cam-source">
        <Icon name="camera" size={14} />
        Values from the {CAMERA_WORDS[session.camera_view].toLowerCase()} camera of this take.
      </p>
    ) : null

  const subtitle = [
    view,
    duration > 0 ? formatSeconds(duration) : null,
    series?.trim ? `processed ${formatTimecode(series.trim.startS)}–${formatTimecode(series.trim.endS)} (trimmed)` : null,
    fps > 0 ? `${formatNumber(fps, Number.isInteger(fps) ? 0 : 1)} fps` : null,
    attempt.metrics ? `processed ${formatDateTime(attempt.metrics.computed_at)}` : STATUS_LABELS[attempt.status].toLowerCase(),
  ]
    .filter(Boolean)
    .join(' · ')

  const header = (
    <PageHeader
      title={attemptName(attempt)}
      backHref={href({ name: 'library', sessionId: attempt.session_id })}
      eyebrow={
        narrow ? (
          [MOVEMENT_LABELS[session.movement_type], sessionName(session), view?.toLowerCase()].filter(Boolean).join(' · ')
        ) : (
          <nav aria-label="Breadcrumb" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <a href={href({ name: 'library', sessionId: attempt.session_id })}>Library</a>
            {session.subject_code && (
              <>
                <span aria-hidden="true">/</span>
                <span className="mono">{session.subject_code}</span>
              </>
            )}
            <span aria-hidden="true">/</span>
            <span>{MOVEMENT_LABELS[session.movement_type]}</span>
            <span aria-hidden="true">/</span>
            <span>{sessionName(session)}</span>
          </nav>
        )
      }
      subtitle={subtitle}
      actions={
        <>
          <a className="btn btn-secondary" href={compareHref}>
            <Icon name="compare" />
            {compareLabel}
          </a>
          <a className="btn btn-secondary" href={notesHref}>
            <Icon name="notes" />
            Practice notes
          </a>
          <a className="btn btn-secondary" href={chatHref}>
            <Icon name="mika" />
            Ask Mika
          </a>
        </>
      }
    />
  )

  const strip = (
    <section aria-label="Attempts in this session" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 className="t-label">
        {sessionName(session)} · {inSession.length} {inSession.length === 1 ? 'attempt' : 'attempts'}
      </h2>
      <div className="v2-rev-strip">
        {inSession.map((a) => {
          const on = a.id === attempt.id
          return (
            <a
              key={a.id}
              href={href({ name: 'review', attemptId: a.id })}
              className={on ? 'attempt on' : 'attempt'}
              aria-current={on ? 'page' : undefined}
              title={a.clip_name ?? undefined}
              style={narrow ? { width: 96, minWidth: 96 } : { width: 132 }}
            >
              <AttemptThumb attempt={a} className={a.status === 'done' ? 'thumb' : 'thumb hatch'} style={{ height: narrow ? 44 : 56 }} />
              <span className="t-small" style={{ fontWeight: 600 }}>
                {narrow ? `#${a.number}` : attemptName(a)}
              </span>
              {a.is_reference && <ReferenceTag compact />}
              {!narrow && <span className="t-caption mono">{a.status === 'done' ? formatTimecode(a.duration_s) : STATUS_LABELS[a.status]}</span>}
            </a>
          )
        })}
      </div>
    </section>
  )

  // A metric with nothing to measure in this clip (no plié) is a slim row after the cards.
  const compact = (r: (typeof readings)[number]) => r.value === null && isCompactGap(r.reason)
  const cards = [...readings.filter((r) => !compact(r)), ...readings.filter(compact)].map((r) => {
    if (compact(r)) return <CompactGap key={r.key} name={r.def.label} reason={r.reason} />
    const row = rows.get(r.key)
    // A difference only where both values can be compared; otherwise the reason, in words.
    const difference = row?.comparable ? differenceText(r.key, row.b.value, row.a.value, otherName) : null
    const delta: ReactNode =
      !row || r.value === null ? undefined : !row.comparable ? row.sentence : narrow ? difference?.replace(` than ${otherName}`, '') : difference
    // The phone cards are half as wide: short units, and "vs attempt n" is said once above them.
    const props = metricCardProps(r)
    // The simple view leaves out which phases a value comes from.
    return <MetricCard key={r.key} {...props} phase={simple ? undefined : props.phase} unit={narrow ? NARROW_UNIT[r.key] : r.def.unit} delta={delta ?? undefined} askHref={chatHref} />
  })

  const doubt = phrase ? labelDoubtText(phrase) : null
  const metrics = isPhrase ? (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h2 className="t-h3" id="rev-metrics">
          Themes
        </h2>
        <ViewModeSwitch />
      </div>
      {sourceNote}
      <p className="t-caption">
        {focus.themes.length ? 'Your focus themes come first. ' : 'Tick “My focus” on up to three themes to see them first. '}
        {other ? `Each one next to attempt ${other.number}.` : ''}
      </p>
      {focus.error && <p className="t-caption">Your focus couldn’t be saved: {focus.error.message}</p>}
      {doubt && <p className="t-caption">{doubt}</p>}
      <ThemeCards
        phrase={phrase}
        view={session.camera_view}
        focus={focus.themes}
        focusBusy={focus.saving || focus.status === 'loading'}
        onToggleFocus={(k) => void saveFocus(toggleFocus(focus.themes, k))}
        other={other ? { phrase: phraseOf(other.metrics), name: `Attempt ${other.number}` } : null}
        detail={!simple}
        narrow={narrow}
        askHref={chatHref}
      />
      <p className="t-caption">Values describe this clip only; they are not scores.</p>
    </>
  ) : (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h2 className="t-h3" id="rev-metrics">
          Measurements
        </h2>
        <ViewModeSwitch />
      </div>
      {sourceNote}
      {other && <p className="t-caption">Each one next to attempt {other.number}.</p>}
      {narrow ? <div className="v2-rev-mgrid">{cards}</div> : cards}
      {session.movement_type === 'releve_balance' && <p className="t-caption">Turns are counted for pirouettes only.</p>}
    </>
  )

  const disclaimer = (
    <p className="disclaimer">
      <Icon name="device" />
      {narrow ? 'Processed on this device, not uploaded.' : 'Video processed on this device, not uploaded. Only keypoints and these metrics are saved.'}
    </p>
  )

  const note = (
    <>
      {attempt.status === 'done' && (
        <ReferenceToggle attemptId={attempt.id} on={attempt.is_reference} movementLabel={MOVEMENT_LABELS[session.movement_type].toLowerCase()} />
      )}
      <AttemptNote attemptId={attempt.id} note={attempt.note} />
    </>
  )

  const mobileLinks = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
      <a className="btn btn-secondary btn-lg" href={compareHref} style={{ padding: '0 8px' }}>
        Compare
      </a>
      <a className="btn btn-secondary btn-lg" href={notesHref} style={{ padding: '0 8px' }}>
        Notes
      </a>
      <a className="btn btn-secondary btn-lg" href={chatHref} style={{ padding: '0 8px' }}>
        Ask Mika
      </a>
    </div>
  )

  if (!usable) {
    // No keypoints to show: say why and what to do; the measurements (if any) stay visible.
    const failed = attempt.status === 'failed'
    return (
      <>
        {header}
        {failed && attempt.error && <Alert title="Processing didn’t finish for this attempt.">{attempt.error}</Alert>}
        <EmptyState
          icon="processing"
          title={attempt.status === 'done' ? 'No keypoints are saved for this attempt' : 'This attempt hasn’t been processed yet'}
          action={
            <a className="btn btn-primary" href={href({ name: 'processing' })}>
              Open processing
            </a>
          }
        >
          {attempt.status === 'done'
            ? 'The skeleton and the timelines need the keypoints of this clip. Process the clip again on this device to save them.'
            : 'The skeleton, the phases and the measurements appear here once the clip has been processed on this device.'}
        </EmptyState>
        {attempt.metrics && <section aria-labelledby="rev-metrics" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{metrics}</section>}
        {note}
        {strip}
      </>
    )
  }

  const stage = (
    <SyncedStage
      clock={clock}
      series={series}
      src={src}
      role="lead"
      phases={phases}
      showSkeleton={skeletonOn}
      ariaLabel={`Tracked pose skeleton of ${attemptName(attempt).toLowerCase()}${src ? ', drawn over the video' : ', shown without the video'}`}
      onVideoError={() => setVideoFailed(true)}
      style={{ maxHeight: narrow ? '56vh' : 'min(64vh, 640px)' }}
    >
      {!clip && !videoFailed && <RelinkOverlay missing={[{ attempt, name: 'this attempt' }]} attempts={attempts} describe={describeAttempt} />}
    </SyncedStage>
  )

  const sample = isSampleAttempt(attempt)
  const cameraSwitch = (
    <CameraSwitch
      current={session.camera_view}
      unavailable={unavailable}
      onPick={switchTo}
      onCorrect={sample ? undefined : () => setCorrecting((c) => !c)}
      correctLabel={session.camera_view ? 'Correct' : 'Set camera'}
      hint={
        !session.camera_view
          ? `Where the camera stood wasn’t set at import. ${DIAGONAL_HINT}`
          : cameras > 1
            ? `Same take and moment from ${cameras} cameras. ${DIAGONAL_HINT}`
            : `This take was filmed from one camera. ${DIAGONAL_HINT}`
      }
      narrow={narrow}
    />
  )
  const stageInfo = (
    <StageInfo
      sessionId={session.id}
      view={session.camera_view}
      attemptCount={inSession.length}
      videoMissing={!clip && !videoFailed && !sample}
      editing={correcting && !sample}
      onEditingChange={setCorrecting}
    />
  )

  const relink = videoFailed && (
    <Alert title="This browser can’t play that video file." role="status">
      The skeleton is shown on its own. Export the clip as MP4 (H.264) to see it here.
    </Alert>
  )

  const transport = (
    <Transport clock={clock} narrow={narrow}>
      <Switch
        label={narrow ? 'Loop' : 'Loop phase'}
        ariaLabel="Loop phase"
        checked={loopOn && phases.length > 0}
        disabled={phases.length === 0}
        title={phases.length === 0 ? 'No phases were found in this clip' : 'Repeat the phase under the playhead'}
        onChange={setLoopOn}
      />
      <Switch label="Skeleton" checked={skeletonOn} onChange={setSkeletonOn} />
    </Transport>
  )

  const timelines = (
    <Timelines
      clock={clock}
      series={series}
      phases={phases}
      duration={duration}
      narrow={narrow}
      noPhaseReason={noPhaseReason(readings)}
      detail={!simple}
      phrase={isPhrase ? phrase : undefined}
    />
  )

  return (
    <>
      {header}
      {loopOn && phases.length > 0 && <LoopBinder clock={clock} phases={phases} />}
      {narrow ? (
        <>
          {cameraSwitch}
          {stage}
          {stageInfo}
          {relink}
          {transport}
          {timelines}
          <section aria-labelledby="rev-metrics" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {metrics}
          </section>
          {note}
          {strip}
          {mobileLinks}
          {disclaimer}
        </>
      ) : (
        <div className="v2-rev-cols">
          <section className="v2-rev-main" aria-label="Video and timelines">
            {cameraSwitch}
            {stage}
            {stageInfo}
            {relink}
            {transport}
            {timelines}
            {strip}
          </section>
          <aside className="v2-rev-side" aria-labelledby="rev-metrics">
            {metrics}
            {note}
            {disclaimer}
          </aside>
        </div>
      )}
    </>
  )
}

/** Why there are no phases, when every measurement gives the same reason. */
function noPhaseReason(readings: { value: number | null; reason: string | null; key: string }[]): string | null {
  const reasons = new Set(readings.filter((r) => r.key !== 'turn_count' && r.value === null && r.reason).map((r) => r.reason as string))
  return reasons.size === 1 ? [...reasons][0] : null
}

/** While "Loop phase" is on, the clock repeats the phase under the playhead. */
function LoopBinder({ clock, phases }: { clock: Clock; phases: readonly PhaseSpan[] }) {
  const index = useClockValue(clock, (s) => phases.findIndex((p) => s.time >= p.start && s.time < p.end))
  useEffect(() => {
    const p = index >= 0 ? phases[index] : null
    clock.setLoop(p ? { start: p.start, end: p.end } : null)
    return () => clock.setLoop(null)
  }, [clock, phases, index])
  return null
}

// ---------- phases, tracking and the per-frame trace ----------

interface TimelinesProps {
  clock: Clock
  series: PoseSeries
  phases: readonly PhaseSpan[]
  duration: number
  narrow: boolean
  noPhaseReason: string | null
  /** Detail view: the tracking and torso-lean traces under the phases. */
  detail: boolean
  /** Phrase attempt: the events strip replaces the phase ribbon (null = not processed as a phrase yet). */
  phrase?: PhraseResult | null
}

function Timelines({ clock, series, phases, duration, narrow, noPhaseReason, detail, phrase }: TimelinesProps) {
  const bands = useMemo(() => trackingBands(series), [series])
  const count = useMemo(() => countBands(series, bands), [series, bands])
  const visibility = useMemo(() => buildTrace(series, visibilityAt), [series])
  const trunk = useMemo(() => buildTrace(series, trunkAt), [series])
  const trunkTop = useMemo(() => niceMax(traceMax(trunk)), [trunk])

  const tracked = count.totalFrames - count.gapFrames
  const trackingText =
    count.gapFrames === 0 && count.lowFrames === 0
      ? `All ${count.totalFrames} frames tracked`
      : [
          `${tracked} of ${count.totalFrames} frames tracked`,
          count.gapFrames > 0 ? `${count.gapFrames} without tracking` : null,
          count.lowFrames > 0 ? `${count.lowFrames} with low confidence` : null,
        ]
          .filter(Boolean)
          .join(' · ')
  const bandWords = bands.length
    ? bands
        .slice(0, 6)
        .map((b) => `${b.kind === 'gap' ? 'no tracking' : 'low confidence'} from ${formatTimecode(b.start)} to ${formatTimecode(b.end)}`)
        .join('; ') + (bands.length > 6 ? `; and ${bands.length - 6} more stretches` : '')
    : 'tracked throughout'

  const ribbon = phrase !== undefined ? (
    phrase ? (
      <>
        <PhraseTimeline clock={clock} phrase={phrase} duration={duration} label="Events of this attempt" compact={narrow} />
        <p className="t-caption">{eventSummary(phrase)}. {narrow ? 'Tap' : 'Click'} an event to jump to it; the thick border marks the main leg extension.</p>
      </>
    ) : (
      <p className="t-caption">This attempt hasn’t been processed as a phrase yet, so no events are listed. Process it again on this device.</p>
    )
  ) : (
    <>
      <PhaseRibbon clock={clock} phases={phases} duration={duration} compact={narrow} minLabelShare={narrow ? 0.11 : undefined} style={narrow ? { height: 44 } : undefined} />
      {phases.length === 0 && (
        <p className="t-caption">
          {noPhaseReason ?? 'The phases couldn’t be placed in this clip.'} The timelines below still show the whole clip.
        </p>
      )}
    </>
  )

  const tracks = !detail ? null : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span className="t-small" style={{ fontWeight: 500 }}>
            Tracking{' '}
            <span className="subtle" style={{ fontWeight: 400 }}>
              joint visibility 0–1 · drag to scrub
            </span>
          </span>
          <TrackingReadout clock={clock} series={series} />
        </div>
        <ScrubTrack clock={clock} duration={duration} label="Playhead" height={narrow ? 48 : 44}>
          <BandLayer bands={bands} duration={duration} />
          <TraceLayer segments={visibility} duration={duration} max={1} />
        </ScrubTrack>
        <p className="t-caption" id="rev-tracking">
          {trackingText}.{' '}
          {count.gapFrames > 0 && (
            <>
              <span className="v2-rev-key v2-rev-gap" aria-hidden="true" />
              no tracking{' '}
            </>
          )}
          {count.lowFrames > 0 && (
            <>
              <span className="v2-rev-key" aria-hidden="true" />
              low confidence (mean joint visibility under 0.6){' '}
            </>
          )}
          {(count.gapFrames > 0 || count.lowFrames > 0) && '— shown as they are, never filled in.'}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span className="t-small" style={{ fontWeight: 500 }}>
            Torso lean{' '}
            <span className="subtle" style={{ fontWeight: 400 }}>
              0–{trunkTop}° · each frame
            </span>
          </span>
          <TrunkReadout clock={clock} series={series} />
        </div>
        <TraceTrack
          clock={clock}
          duration={duration}
          height={narrow ? 56 : 52}
          ariaLabel={`Torso lean in each frame of the clip, from 0 to ${trunkTop} degrees; ${bandWords}.`}
        >
          <BandLayer bands={bands} duration={duration} />
          <TraceLayer segments={trunk} duration={duration} max={trunkTop} />
        </TraceTrack>
      </div>
      <TimeAxis duration={duration} />
    </div>
  )

  if (narrow) {
    return (
      <>
        {ribbon}
        {tracks && (
          <div className="card" style={{ padding: 12 }}>
            {tracks}
          </div>
        )}
      </>
    )
  }
  return (
    <div className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 className="t-label">{phrase !== undefined ? 'Events · click to jump' : phases.length ? 'Phases · click to jump' : 'Phases'}</h2>
        <span className="t-caption">
          <span className="kbd">Space</span> play · <span className="kbd">←</span>
          <span className="kbd">→</span> frame
          {phases.length > 0 && (
            <>
              {' '}
              · <span className="kbd">[</span>
              <span className="kbd">]</span> phase
            </>
          )}
        </span>
      </div>
      {ribbon}
      {tracks}
    </div>
  )
}

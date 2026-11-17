// Screen 8 — Compare attempts (FR-3.6.1, FR-3.6.2).
// Design: Compare.dc.html, CompareMobile.dc.html, VideoStage.dc.html; empty / loading /
// error patterns in States.dc.html. See ../README.md.
//
// Two of the dancer's own attempts on one clock. The clock runs on A's time; B is placed
// by a TimeMap (compare/align.ts): phase by phase when both have phases, otherwise by
// share of clip length — and the screen says which. Every value, difference and sentence
// in the table comes from `compareAttempts`. Descriptive only: no better or worse.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { compareAttempts, type AttemptComparison, type MetricComparison } from '../../insights'
import type { PhaseSpan } from '../../metrics/types'
import type { PoseSeries } from '../../pose/types'
import { useAttemptVideo } from '../videoBackup'
import { CompactGap, ConfBadge, EmptyState, Icon, ErrorAlert, NoteBox, PageHeader, SkeletonWorkspace } from '../components'
import { useAttempt, useAttempts, type AttemptView } from '../data'
import { compactGapReason, formatSeconds, formatTimecode, isCompactGap, MOVEMENT_LABELS, PHASE_LABELS, readMetric } from '../format'
import { href, navigate, useRoute } from '../router'
import { useIsNarrow } from '../useIsNarrow'
import { useViewMode, ViewModeSwitch } from '../viewMode'
import { alignmentText, buildEventTimeMap, buildTimeMap, type AlignMode, type TimeMap } from './compare/align'
import { alignPhrases, type PhraseAlignment } from '../../metrics/phraseAlign'
import type { PhraseResult } from '../../metrics/phrase'
import { useFocusThemes } from '../focus'
import { phraseOf } from './phrase/model'
import { PhraseDifferences } from './phrase/PhraseDifferences'
import { PhraseTimeline } from './phrase/PhraseTimeline'
import { choosePair } from './compare/pick'
import { createClock, type Clock } from './review/clock'
import { attemptName, comparisonInput, describeAttempt, sessionName } from './review/labels'
import { RelinkOverlay } from './review/Relink'
import { CAMERA_WORDS, filmedFromLabel } from './review/StageInfo'
import { CameraSwitch, DIAGONAL_HINT, NOT_FILMED } from './review/CameraSwitch'
import { clampTime, handOff, sharedViews, takeHandoff, viewsOfTake } from './review/takes'
import { usePrefetchSeries } from './review/prefetchTake'
import type { CameraView } from '../../data/schema'
import { isSampleAttempt } from '../sampleMarkers'
import './review/review.css'
import { SyncedStage } from './review/SyncedStage'
import { buildTrace, niceMax, seriesEnd, traceMax, trackingBands, trunkAt } from './review/timeline'
import { BandLayer, PhaseRibbon, ScrubTrack, TimeAxis, TraceLayer, TraceTrack, TrunkReadout } from './review/Tracks'
import { PlayButton, SpeedControl, StepButton } from './review/Transport'
import { countRender, useClockValue, useTransportKeys } from './review/useClock'

const NO_PHASES: readonly PhaseSpan[] = []
const LABELS = { a: 'A', b: 'B' }

/**
 * 'A' or 'B' as a pill in that attempt's series colour, with its line style inside (A dashed,
 * B solid), so every label on the page matches what is drawn for it. Colours carry no judgement.
 */
function AttemptChip({ side }: { side: 'a' | 'b' }) {
  return (
    <span className={`v2-chip v2-chip-${side}`}>
      {side === 'a' ? 'A' : 'B'}
      <span className="v2-chip-line" aria-hidden="true" />
    </span>
  )
}

export function Compare() {
  const route = useRoute()
  const narrow = useIsNarrow()
  const all = useAttempts()
  const processed = useMemo(() => (all.data ?? []).filter((a) => a.status === 'done'), [all.data])
  const wantA = route.name === 'compare' ? route.a : undefined
  const wantB = route.name === 'compare' ? route.b : undefined
  const pair = useMemo(() => choosePair(processed, wantA, wantB), [processed, wantA, wantB])
  const a = useAttempt(pair.a)
  const b = useAttempt(pair.b)

  // The address always names the pair on screen, so a reload or a shared link shows the same two.
  const loaded = all.data !== null
  useEffect(() => {
    if (!loaded || route.name !== 'compare') return
    if ((pair.a ?? undefined) !== wantA || (pair.b ?? undefined) !== wantB) {
      navigate({ name: 'compare', a: pair.a ?? undefined, b: pair.b ?? undefined }, { replace: true })
    }
  }, [loaded, route.name, pair.a, pair.b, wantA, wantB])

  const setPair = (next: { a?: string | null; b?: string | null }) => {
    const na = next.a ?? pair.a
    let nb = next.b ?? pair.b
    if (na && nb === na) nb = null
    navigate({ name: 'compare', a: na ?? undefined, b: nb ?? undefined }, { replace: true })
  }

  const plainHeader = <PageHeader title="Compare attempts" mobileTitle="Compare" subtitle="Two of your own attempts side by side, aligned by phase." />

  if (all.loading) {
    return (
      <>
        {plainHeader}
        <SkeletonWorkspace caption="Loading saved keypoints…" label="Loading compare" />
      </>
    )
  }
  if (all.error && !all.data) {
    return (
      <>
        {plainHeader}
        <ErrorAlert error={all.error} onRetry={all.refetch} />
      </>
    )
  }
  if (processed.length < 2) {
    return (
      <>
        {plainHeader}
        <EmptyState
          icon="compare"
          title="Compare needs two processed attempts"
          action={
            processed.length === 0 ? (
              <a className="btn btn-primary" href={href({ name: 'import' })}>
                Import clips
              </a>
            ) : (
              <a className="btn btn-secondary" href={href({ name: 'library' })}>
                Open library
              </a>
            )
          }
        >
          Process two attempts of the same movement, then pick them here to see the difference between them.
        </EmptyState>
      </>
    )
  }

  const attemptA = processed.find((x) => x.id === pair.a) ?? null
  const attemptB = processed.find((x) => x.id === pair.b) ?? null
  const pickers = <Pickers processed={processed} a={attemptA} b={attemptB} narrow={narrow} onPick={setPair} />
  const eyebrow = pairContext(attemptA, attemptB)
  const backHref = attemptA ? href({ name: 'review', attemptId: attemptA.id }) : href({ name: 'review' })

  if (!attemptA || !attemptB) {
    return (
      <>
        <PageHeader title="Compare attempts" mobileTitle="Compare" eyebrow={<span>{eyebrow}</span>} actions={pickers} backHref={backHref} />
        {narrow && pickers}
        <NoteBox title="Pick a second attempt.">
          {attemptA ? `${attemptName(attemptA)} is the only processed attempt of its session. ` : ''}Choose attempt B above to see the two side by side.
        </NoteBox>
      </>
    )
  }

  const error = a.error ?? b.error
  if (error && (!a.data || !b.data)) {
    return (
      <>
        <PageHeader title="Compare attempts" mobileTitle="Compare" eyebrow={<span>{eyebrow}</span>} actions={pickers} backHref={backHref} />
        {narrow && pickers}
        <ErrorAlert
          error={error}
          onRetry={() => {
            a.refetch()
            b.refetch()
          }}
        />
      </>
    )
  }
  if (!a.data || !b.data) {
    return (
      <>
        <PageHeader title="Compare attempts" mobileTitle="Compare" eyebrow={<span>{eyebrow}</span>} actions={pickers} backHref={backHref} />
        {narrow && pickers}
        <SkeletonWorkspace caption="Loading saved keypoints…" label="Loading compare" />
      </>
    )
  }

  return (
    <Workspace
      key={`${a.data.attempt.id}:${b.data.attempt.id}`}
      a={a.data.attempt}
      b={b.data.attempt}
      seriesA={a.data.series}
      seriesB={b.data.series}
      attempts={all.data ?? []}
      pickers={pickers}
      eyebrow={eyebrow}
      backHref={backHref}
    />
  )
}

/** 'S01 · Relevé balance · Session · Nov 4 · side view', or both when the sessions differ. */
function pairContext(a: AttemptView | null, b: AttemptView | null): string {
  const one = (x: AttemptView) =>
    [x.session.subject_code, MOVEMENT_LABELS[x.session.movement_type], sessionName(x.session), x.session.camera_view && `${CAMERA_WORDS[x.session.camera_view].toLowerCase()} camera`]
      .filter(Boolean)
      .join(' · ')
  if (!a) return 'Two of your own attempts'
  if (!b || b.session_id === a.session_id) return one(a)
  return `A: ${one(a)}  ·  B: ${one(b)}`
}

// ---------- pickers ----------

interface PickersProps {
  processed: readonly AttemptView[]
  a: AttemptView | null
  b: AttemptView | null
  narrow: boolean
  onPick(next: { a?: string; b?: string }): void
}

function Pickers({ processed, a, b, narrow, onPick }: PickersProps) {
  // One group per session, sessions in library order (newest first).
  const groups = useMemo(() => {
    const map = new Map<string, AttemptView[]>()
    for (const x of processed) map.set(x.session_id, [...(map.get(x.session_id) ?? []), x])
    return [...map.values()]
  }, [processed])

  const select = (side: 'a' | 'b') => {
    const value = (side === 'a' ? a : b)?.id ?? ''
    const taken = (side === 'a' ? b : a)?.id
    return (
      <select
        className="input input-sm"
        id={`cmp-${side}`}
        value={value}
        onChange={(e) => e.target.value && onPick(side === 'a' ? { a: e.target.value } : { b: e.target.value })}
      >
        {!value && <option value="">Choose an attempt</option>}
        {groups.map((g) => (
          <optgroup
            key={g[0].session_id}
            label={[g[0].session.subject_code, MOVEMENT_LABELS[g[0].session.movement_type], sessionName(g[0].session)].filter(Boolean).join(' · ')}
          >
            {g.map((x) => (
              <option key={x.id} value={x.id} disabled={x.id === taken}>
                {x.is_reference ? `${attemptName(x)} · Reference` : attemptName(x)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    )
  }

  if (narrow) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        <div className="card v2-cmp-pick">
          <label className="t-caption" htmlFor="cmp-a" aria-label="Attempt A">
            <AttemptChip side="a" />
          </label>
          {select('a')}
        </div>
        <div className="card v2-cmp-pick" style={{ borderColor: 'var(--series-b)' }}>
          <label className="t-caption" htmlFor="cmp-b" aria-label="Attempt B">
            <AttemptChip side="b" />
          </label>
          {select('b')}
        </div>
      </div>
    )
  }
  return (
    <>
      <div className="field" style={{ width: 170 }}>
        <label className="field-label" htmlFor="cmp-a" aria-label="Attempt A">
          <AttemptChip side="a" />
        </label>
        {select('a')}
      </div>
      <div className="field" style={{ width: 170 }}>
        <label className="field-label" htmlFor="cmp-b" aria-label="Attempt B">
          <AttemptChip side="b" />
        </label>
        {select('b')}
      </div>
    </>
  )
}

// ---------- the pair ----------

interface WorkspaceProps {
  a: AttemptView
  b: AttemptView
  seriesA: PoseSeries | null
  seriesB: PoseSeries | null
  attempts: readonly AttemptView[]
  pickers: ReactNode
  eyebrow: string
  backHref: string
}

type StageMode = 'a' | 'overlay' | 'b'

function Workspace({ a, b, seriesA, seriesB, attempts, pickers, eyebrow, backHref }: WorkspaceProps) {
  countRender('Compare')
  const narrow = useIsNarrow()
  const simple = useViewMode() === 'simple'
  const clipA = useAttemptVideo(a)
  const clipB = useAttemptVideo(b)
  const [failed, setFailed] = useState<{ a: boolean; b: boolean }>({ a: false, b: false })
  const [asked, setAsked] = useState<AlignMode>('phases')
  const [mode, setMode] = useState<StageMode>('overlay')

  const sA = seriesA && seriesA.frames.length > 0 ? seriesA : null
  const sB = seriesB && seriesB.frames.length > 0 ? seriesB : null
  const durA = sA ? seriesEnd(sA) : (a.duration_s ?? 0)
  const durB = sB ? seriesEnd(sB) : (b.duration_s ?? 0)
  const fpsA = sA?.fps ?? a.fps ?? 30
  const phasesA = a.metrics?.phases?.length ? a.metrics.phases : NO_PHASES
  const phasesB = b.metrics?.phases?.length ? b.metrics.phases : NO_PHASES

  const clock = useMemo(() => {
    const c = createClock()
    c.load(durA, fpsA)
    return c
  }, [durA, fpsA])
  useEffect(() => () => clock.pause(), [clock])
  useTransportKeys(clock)
  // Arrived from the camera switch: the same moment of both takes, playing if it was.
  useEffect(() => {
    const h = takeHandoff(`${a.id}:${b.id}`)
    if (!h) return
    clock.setRate(h.rate)
    clock.seek(clampTime(h.time, durA))
    if (h.playing) clock.play()
  }, [clock, a.id, b.id, durA])

  // One camera switch for both: a camera is offered when A's and B's takes both have it.
  const sameView = a.session.camera_view && a.session.camera_view === b.session.camera_view ? a.session.camera_view : null
  const shared = useMemo(() => sharedViews(a, b, attempts), [a, b, attempts])
  const unavailable = useMemo(() => {
    const va = viewsOfTake(a, attempts)
    const vb = viewsOfTake(b, attempts)
    const out: Partial<Record<CameraView, string>> = {}
    for (const v of ['front', 'side', 'diagonal'] as const) {
      if (shared[v]) continue
      out[v] = !va[v] && !vb[v] ? NOT_FILMED : !va[v] ? `${NOT_FILMED} for A` : !vb[v] ? `${NOT_FILMED} for B` : 'A and B would be the same clip'
    }
    return out
  }, [a, b, attempts, shared])
  usePrefetchSeries(Object.values(shared).flatMap((p) => (p ? [p.a, p.b].filter((x) => x.id !== a.id && x.id !== b.id && x.status === 'done').map((x) => x.id) : [])))
  const switchTo = (v: CameraView) => {
    const pair = shared[v]
    if (!pair) return
    const { time, playing, rate } = clock.get()
    handOff({ time, playing, rate, target: `${pair.a.id}:${pair.b.id}` })
    navigate({ name: 'compare', a: pair.a.id, b: pair.b.id }, { replace: true })
  }

  // Two phrase attempts are lined up on their matched events instead of phases.
  const phrasePair = a.session.movement_type === 'phrase' && b.session.movement_type === 'phrase'
  const phraseA = phrasePair ? phraseOf(a.metrics) : null
  const phraseB = phrasePair ? phraseOf(b.metrics) : null
  const alignment = useMemo(() => (phraseA && phraseB ? alignPhrases(phraseA, phraseB) : null), [phraseA, phraseB])
  const focus = useFocusThemes()
  const map = useMemo(
    () =>
      phrasePair
        ? buildEventTimeMap(durA, durB, alignment?.anchors ?? [], asked)
        : buildTimeMap({ duration: durA, phases: phasesA }, { duration: durB, phases: phasesB }, asked),
    [phrasePair, alignment, durA, durB, phasesA, phasesB, asked],
  )
  const comparison = useMemo(() => compareAttempts(comparisonInput(a), comparisonInput(b), LABELS), [a, b])

  const srcA = clipA && !failed.a ? clipA.objectUrl : null
  const srcB = clipB && !failed.b ? clipB.objectUrl : null
  const showA = !narrow || mode === 'a'
  const showB = !narrow || mode !== 'a'
  const ghostOnB = !narrow || mode === 'overlay'
  // One video keeps time: A's when it is on screen, otherwise B's.
  const aLeads = showA && srcA !== null
  // Each stage names its camera only when A and B were filmed from different ones; otherwise the switch says it.
  const view = (x: AttemptView) => (sameView ? undefined : filmedFromLabel(x.session.camera_view, narrow))
  const stageStyle = { maxHeight: narrow ? '50vh' : 'min(56vh, 520px)' }
  // "Choose the file again" sits on each stage; when A's stage is hidden (phone, B or
  // Overlay mode) B's stage asks for A's file too.
  const missingA = !clipA ? [{ attempt: a, name: 'A' }] : []
  const missingB = [...(!clipA && !showA ? missingA : []), ...(!clipB ? [{ attempt: b, name: 'B' }] : [])]

  const stageA = showA && (
    <SyncedStage
      clock={clock}
      series={sA}
      src={srcA}
      role="lead"
      phases={phasesA}
      label={`A · ${attemptName(a)}`}
      view={view(a)}
      privacy={clipA?.remote ? 'Backed up · only you can see it' : undefined}
      ariaLabel={`Tracked pose skeleton of A, ${attemptName(a).toLowerCase()}${srcA ? ', drawn over its video' : ', shown without the video'}`}
      placeholder={<span className="t-small">No keypoints are saved for A.</span>}
      onVideoError={() => setFailed((f) => ({ ...f, a: true }))}
      style={stageStyle}
    >
      <RelinkOverlay missing={missingA} attempts={attempts} describe={describeAttempt} />
    </SyncedStage>
  )
  const stageB = showB && (
    <SyncedStage
      clock={clock}
      series={sB}
      src={srcB}
      role={aLeads ? 'follower' : 'lead'}
      toLocal={map.toB}
      toClock={map.toA}
      slopeAt={map.slopeAt}
      ghost={ghostOnB && sA ? { series: sA } : null}
      phases={phasesB}
      label={ghostOnB && sA ? (narrow ? 'B + A ghost' : `B · ${attemptName(b)} + A ghost`) : `B · ${attemptName(b)}`}
      view={view(b)}
      privacy={clipB?.remote ? 'Backed up · only you can see it' : undefined}
      ariaLabel={`Tracked pose skeleton of B, ${attemptName(b).toLowerCase()}${ghostOnB && sA ? ', with A dashed behind it' : ''}${srcB ? ', drawn over its video' : ', shown without the video'}`}
      placeholder={<span className="t-small">No keypoints are saved for B.</span>}
      onVideoError={() => setFailed((f) => ({ ...f, b: true }))}
      style={stageStyle}
    >
      <RelinkOverlay missing={missingB} attempts={attempts} describe={describeAttempt} />
    </SyncedStage>
  )

  const alignControl = (
    <div className="field">
      <span className="field-label" id="cmp-align">
        Align by
      </span>
      <div className="seg" role="group" aria-labelledby="cmp-align">
        <button
          type="button"
          className={map.mode === 'phases' || map.mode === 'events' ? 'on' : undefined}
          aria-pressed={map.mode === 'phases' || map.mode === 'events'}
          disabled={map.unavailable !== null}
          title={map.unavailable ? (phrasePair ? 'Needs events found in both attempts' : 'Needs phases in both attempts') : undefined}
          style={map.unavailable ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          onClick={() => setAsked('phases')}
        >
          {phrasePair ? 'Each event' : 'Each phase'}
        </button>
        <button type="button" className={map.mode === 'proportional' ? 'on' : undefined} aria-pressed={map.mode === 'proportional'} onClick={() => setAsked('proportional')}>
          Clip length
        </button>
      </div>
    </div>
  )

  return (
    <>
      <PageHeader
        title="Compare attempts"
        mobileTitle="Compare"
        backHref={backHref}
        eyebrow={
          narrow ? (
            `${MOVEMENT_LABELS[a.session.movement_type]} · ${map.mode === 'phases' ? 'aligned phase by phase' : map.mode === 'events' ? 'aligned event by event' : 'matched by clip length'}`
          ) : (
            <span>{eyebrow}</span>
          )
        }
        actions={
          <>
            {pickers}
            {alignControl}
            {!narrow && (
              <div className="field">
                <span className="field-label">View</span>
                <ViewModeSwitch />
              </div>
            )}
          </>
        }
      />
      {narrow && pickers}
      {narrow && (
        <div className="seg" role="tablist" aria-label="Video mode" style={{ width: '100%' }}>
          {(['a', 'overlay', 'b'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'on' : undefined}
              onClick={() => setMode(m)}
              style={{ flex: 1, justifyContent: 'center', height: 40 }}
            >
              {m === 'overlay' ? 'Overlay' : <AttemptChip side={m} />}
            </button>
          ))}
        </div>
      )}

      <CameraSwitch
        current={sameView}
        unavailable={unavailable}
        onPick={switchTo}
        hint={
          sameView
            ? `A and B switch camera together, at the same moment. ${DIAGONAL_HINT}`
            : `A and B were filmed from different cameras. ${DIAGONAL_HINT}`
        }
        narrow={narrow}
      />
      {narrow ? (
        <>
          {stageA}
          {stageB}
        </>
      ) : (
        <div className="v2-cmp-stages">
          {stageA}
          {stageB}
        </div>
      )}
      {[...missingA, ...missingB].some((m) => !isSampleAttempt(m.attempt)) && (
        <p className="v2-rev-stageinfo-line" style={{ marginTop: -4 }}>
          <Icon name="device" size={16} />
          <span className="muted">Videos stay on your device and aren’t stored. Add the same file again to see it under the skeleton.</span>
        </p>
      )}
      {(failed.a || failed.b) && (
        <NoteBox title="This browser can’t play one of the video files.">Its skeleton is shown on its own.</NoteBox>
      )}

      <Timelines
        clock={clock}
        a={a}
        b={b}
        sA={sA}
        sB={sB}
        durA={durA}
        phasesA={phasesA}
        phasesB={phasesB}
        map={map}
        asked={asked}
        narrow={narrow}
        alignControl={narrow ? alignControl : null}
        detail={!simple}
        phrase={phrasePair ? { a: phraseA, b: phraseB, alignment } : null}
      />

      {sameView && Object.values(shared).some(Boolean) && (
        <p className="v2-cam-source" style={{ marginBottom: -12 }}>
          <Icon name="camera" size={14} />
          Values below come from the {CAMERA_WORDS[sameView].toLowerCase()} camera of A and B.
        </p>
      )}
      {phrasePair ? (
        <PhraseDifferences
          a={phraseA}
          b={phraseB}
          viewA={a.session.camera_view}
          viewB={b.session.camera_view}
          alignment={alignment}
          focus={focus.themes}
          simple={simple}
        />
      ) : (
        <Differences comparison={comparison} a={a} b={b} narrow={narrow} simple={simple} />
      )}
    </>
  )
}

// ---------- one transport, both timelines ----------

function PairTime({ clock, map, durB }: { clock: Clock; map: TimeMap; durB: number }) {
  const t = useClockValue(clock, (s) => s.time)
  const playing = useClockValue(clock, (s) => s.playing)
  return (
    <span className="mono" style={{ fontSize: 13, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }} aria-live={playing ? 'off' : 'polite'}>
      <AttemptChip side="a" /> {formatTimecode(t)}
      <span aria-hidden="true">·</span>
      <AttemptChip side="b" /> {formatTimecode(Math.min(map.toB(t), durB))}
    </span>
  )
}

interface TimelinesProps {
  clock: Clock
  a: AttemptView
  b: AttemptView
  sA: PoseSeries | null
  sB: PoseSeries | null
  durA: number
  phasesA: readonly PhaseSpan[]
  phasesB: readonly PhaseSpan[]
  map: TimeMap
  asked: AlignMode
  narrow: boolean
  alignControl: ReactNode
  /** Detail view: the torso-lean traces of both attempts. */
  detail: boolean
  /** Two phrase attempts: event strips instead of phase ribbons. */
  phrase?: { a: PhraseResult | null; b: PhraseResult | null; alignment: PhraseAlignment | null } | null
}

/**
 * Phone: the ribbons stay on one time axis, so a short phase (rise, finish) is only a few
 * pixels wide there. This list names every phase with A's and B's length; a tap puts the
 * playhead at its start in A (or B's, mapped onto A's time, when only B has it).
 */
function PhaseList({ clock, phasesA, phasesB, map }: { clock: Clock; phasesA: readonly PhaseSpan[]; phasesB: readonly PhaseSpan[]; map: TimeMap }) {
  const keys = [...new Set([...phasesA, ...phasesB].map((p) => p.phase))]
  if (keys.length === 0) return null
  const len = (p: PhaseSpan | undefined) => formatSeconds(p ? p.end - p.start : null)
  return (
    <ul className="v2-cmp-phases" aria-label="Phases of A and B">
      {keys.map((k) => {
        const a = phasesA.find((p) => p.phase === k)
        const b = phasesB.find((p) => p.phase === k)
        const start = a ? a.start : map.toA(b!.start)
        return (
          <li key={k}>
            <button type="button" className="v2-cmp-phase" onClick={() => clock.seek(start)}>
              <span className="v2-cmp-phase-name">{PHASE_LABELS[k]}</span>
              <span className="mono">A {len(a)}</span>
              <span className="mono">B {len(b)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Timelines({ clock, a, b, sA, sB, durA, phasesA, phasesB, map, asked, narrow, alignControl, detail, phrase }: TimelinesProps) {
  const bandsA = useMemo(() => (sA ? trackingBands(sA) : []), [sA])
  const bandsB = useMemo(() => (sB ? trackingBands(sB) : []), [sB])
  const trunkA = useMemo(() => (sA ? buildTrace(sA, trunkAt) : []), [sA])
  const trunkB = useMemo(() => (sB ? buildTrace(sB, trunkAt) : []), [sB])
  const top = useMemo(() => niceMax(Math.max(traceMax(trunkA) ?? 0, traceMax(trunkB) ?? 0)), [trunkA, trunkB])
  const durB = sB ? seriesEnd(sB) : (b.duration_s ?? 0)
  const half = { position: 'absolute', left: 0, right: 0, height: '50%' } as const
  const gaps = bandsA.length + bandsB.length > 0
  const minShare = narrow ? 0.11 : 0.04

  return (
    <section className="card" style={{ padding: narrow ? 12 : '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="Timelines of both attempts">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <StepButton clock={clock} direction={-1} />
        <PlayButton clock={clock} label="Play both" />
        <StepButton clock={clock} direction={1} />
        <PairTime clock={clock} map={map} durB={durB} />
        <span style={{ flex: 1 }} />
        <SpeedControl clock={clock} dense={narrow} />
      </div>
      {alignControl}
      <p className="t-caption">{phrase ? phraseAlignmentText(map, asked) : alignmentText(map, asked)}</p>

      {phrase && <PhraseRows clock={clock} durA={durA} map={map} phrase={phrase} narrow={narrow} />}
      <div className="v2-cmp-rows">
        {!phrase && (
          <>
        <div className="v2-cmp-row">
          <span className="v2-cmp-rowlabel">
            <AttemptChip side="a" />
          </span>
          <PhaseRibbon clock={clock} phases={phasesA} duration={durA} small compact minLabelShare={minShare} label="Phases of A" emptyText="No phases found in A" />
        </div>
        <div className="v2-cmp-row">
          <span className="v2-cmp-rowlabel">
            <AttemptChip side="b" />
          </span>
          <PhaseRibbon
            clock={clock}
            phases={phasesB}
            duration={durA}
            small
            compact
            minLabelShare={minShare}
            mapT={map.toA}
            seekTo={(p) => map.toA(p.start)}
            label="Phases of B, placed on A’s time"
            emptyText="No phases found in B"
          />
        </div>
          </>
        )}
        <ScrubTrack clock={clock} duration={durA} label="Playhead of both attempts" height={32}>
          <div style={{ ...half, top: 0 }}>
            <BandLayer bands={bandsA} duration={durA} />
          </div>
          <div style={{ ...half, bottom: 0 }}>
            <BandLayer bands={bandsB} duration={durA} mapT={map.toA} />
          </div>
        </ScrubTrack>
      </div>
      {narrow && !phrase && <PhaseList clock={clock} phasesA={phasesA} phasesB={phasesB} map={map} />}
      <p className="t-caption">
        Drag the bar to scrub both.{' '}
        {gaps ? (
          <>
            <span className="v2-rev-key" aria-hidden="true" />
            Hatched: frames with no or low-confidence tracking (A in the top half, B in the bottom half), shown as they are.
          </>
        ) : (
          'Both clips are tracked in every frame.'
        )}
      </p>

      {detail && (sA || sB) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
            <span className="t-small" style={{ fontWeight: 500 }}>
              Torso lean{' '}
              <span className="subtle" style={{ fontWeight: 400 }}>
                0–{top}° · each frame
              </span>
            </span>
            <span className="t-caption" style={{ display: 'inline-flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span>
                <AttemptChip side="a" /> {attemptName(a).toLowerCase()} {sA && <TrunkReadout clock={clock} series={sA} />}
              </span>
              <span>
                <AttemptChip side="b" /> {attemptName(b).toLowerCase()} {sB && <TrunkReadout clock={clock} series={sB} toLocal={map.toB} />}
              </span>
            </span>
          </div>
          <TraceTrack
            clock={clock}
            duration={durA}
            height={narrow ? 80 : 96}
            ariaLabel={`Torso lean of A (dashed line) and B (solid line) in each frame, from 0 to ${top} degrees, on A’s time; B is placed ${map.mode === 'phases' ? 'phase by phase' : 'by share of clip length'}.`}
          >
            <TraceLayer segments={trunkA} duration={durA} max={top} height={96} stroke="var(--series-a)" dash="5 4" lowDash="1 4" />
            <TraceLayer segments={trunkB} duration={durA} max={top} height={96} stroke="var(--series-b)" strokeWidth={2.25} lowDash="1 4" mapT={map.toA} />
          </TraceTrack>
          <TimeAxis duration={durA} />
        </div>
      )}
    </section>
  )
}

// ---------- phrase attempts ----------

function phraseAlignmentText(map: TimeMap, asked: AlignMode): string {
  if (map.mode === 'events') return alignmentText(map, asked)
  const rule = 'Matched by share of clip length: both clips start and end together.'
  return map.unavailable ? `No events were found in both attempts, so the clips can’t be aligned by event. ${rule}` : rule
}

function PhraseRows({ clock, durA, map, phrase, narrow }: { clock: Clock; durA: number; map: TimeMap; phrase: NonNullable<TimelinesProps['phrase']>; narrow: boolean }) {
  const matchedA = useMemo(() => new Set(phrase.alignment?.pairs.map((p) => p.a) ?? []), [phrase.alignment])
  const matchedB = useMemo(() => new Set(phrase.alignment?.pairs.map((p) => p.b) ?? []), [phrase.alignment])
  const empty = (name: string) => <p className="t-caption">{name} hasn’t been processed as a phrase yet, so its events aren’t listed.</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <AttemptChip side="a" />
        <span className="t-small">Events of A</span>
      </div>
      {phrase.a ? <PhraseTimeline clock={clock} phrase={phrase.a} duration={durA} label="Events of A" matched={matchedA} axis={false} compact={narrow} /> : empty('A')}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <AttemptChip side="b" />
        <span className="t-small">Events of B, placed on A’s time</span>
      </div>
      {phrase.b ? <PhraseTimeline clock={clock} phrase={phrase.b} duration={durA} mapT={map.toA} label="Events of B, placed on A’s time" matched={matchedB} compact={narrow} /> : empty('B')}
      <p className="t-caption">Underlined events were matched with the other attempt. {narrow ? 'Tap' : 'Click'} an event to jump to it.</p>
    </div>
  )
}

// ---------- differences ----------

function pairExplanation(comparison: AttemptComparison): ReactNode {
  if (comparison.reason?.code === 'different_movement') {
    return (
      <NoteBox title="These are different movements.">
        Their measurements aren’t compared: each movement is measured in its own way. Pick two attempts of the same movement to see differences.
      </NoteBox>
    )
  }
  if (comparison.reason?.code === 'different_camera_view') {
    return (
      <NoteBox title="These attempts were filmed from different camera views.">
        The same pose reads differently from the front and from the side, so their measurements aren’t compared. Switch both to one camera above, or pick two attempts with the same view, to see differences.
      </NoteBox>
    )
  }
  return null
}

/** The reasons a side has no value, in the dancer's words: 'A: …', 'B: …' (once when both say the same). */
function nullReasons(row: MetricComparison, a: AttemptView, b: AttemptView): string[] {
  const ra = row.a.value === null ? readMetric(a.metrics, row.metric).reason : null
  const rb = row.b.value === null ? readMetric(b.metrics, row.metric).reason : null
  if (ra && rb && ra === rb) return [ra]
  return [ra ? `A: ${ra}` : null, rb ? `B: ${rb}` : null].filter((x): x is string => x !== null)
}

/** Neither clip had anything to measure for this row (e.g. no plié in either): a slim row below the differences. */
function bothCompact(row: MetricComparison, a: AttemptView, b: AttemptView): boolean {
  return (
    row.a.value === null &&
    row.b.value === null &&
    isCompactGap(readMetric(a.metrics, row.metric).reason) &&
    isCompactGap(readMetric(b.metrics, row.metric).reason)
  )
}

function CompactRows({ rows, a }: { rows: MetricComparison[]; a: AttemptView }) {
  return rows.map((row) => {
    const reason = readMetric(a.metrics, row.metric).reason
    const detail = compactGapReason(reason) === 'knee_not_bent' ? 'no plié in either clip' : undefined
    return <CompactGap key={row.metric} name={row.info.label} reason={reason} detail={detail} />
  })
}

function phasesOf(row: MetricComparison, a: AttemptView, b: AttemptView): string {
  const pa = readMetric(a.metrics, row.metric).phases
  const pb = readMetric(b.metrics, row.metric).phases
  return (pa.length ? pa : pb).map((p) => PHASE_LABELS[p]).join(' + ')
}

function Differences({ comparison, a, b, narrow, simple }: { comparison: AttemptComparison; a: AttemptView; b: AttemptView; narrow: boolean; simple: boolean }) {
  const explanation = pairExplanation(comparison)
  const fullRows = comparison.rows.filter((row) => !bothCompact(row, a, b))
  const compactRows = comparison.rows.filter((row) => bothCompact(row, a, b))
  const sentence = (row: MetricComparison) => (
    <>
      {row.sentence}
      {!simple && row.comparable && row.difference !== 0 && (
        <span className="t-caption num" style={{ marginLeft: 8, whiteSpace: 'nowrap' }}>
          B − A = {row.differenceText}
        </span>
      )}
      {/* The pair-level reason is explained once, above the table. */}
      {!row.comparable &&
        comparison.comparable &&
        nullReasons(row, a, b).map((r) => (
          <span key={r} className="t-caption" style={{ display: 'block', marginTop: 2 }}>
            {r}
          </span>
        ))}
    </>
  )

  if (narrow) {
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <h2 className="t-h3">Differences</h2>
          <ViewModeSwitch />
        </div>
        <p className="t-caption">B compared with A.</p>
        {explanation}
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, listStyle: 'none', margin: 0, padding: 0 }}>
          {fullRows.map((row) => {
            const phase = phasesOf(row, a, b)
            return (
              <li
                key={row.metric}
                className={row.comparable ? 'card' : 'card v2-cmp-nc'}
                style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, borderStyle: row.comparable ? undefined : 'dashed' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{row.info.label}</span>
                  {!simple && phase && <span className="tag">{phase}</span>}
                </div>
                <p style={{ color: row.comparable ? 'var(--text)' : 'var(--text-2)' }}>{sentence(row)}</p>
                <div style={{ display: 'flex', gap: '8px 16px', flexWrap: 'wrap', alignItems: 'center' }} className="t-small num muted">
                  {/* Each value keeps its badge on the same line when the row wraps. */}
                  <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                    <span>
                      <AttemptChip side="a" /> {row.a.text}
                    </span>
                    <ConfBadge level={row.a.confidence ?? 'none'} />
                  </span>
                  <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                    <span>
                      <AttemptChip side="b" /> {row.b.text}
                    </span>
                    <ConfBadge level={row.b.confidence ?? 'none'} />
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
        <CompactRows rows={compactRows} a={a} />
        <p className="t-caption">Differences are descriptive. They don’t say which attempt is better.</p>
      </>
    )
  }

  return (
    <section className="card" style={{ overflow: 'hidden' }} aria-labelledby="cmp-diff">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 16px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap', gap: 8 }}>
        <h2 className="t-h3" id="cmp-diff">
          Differences
        </h2>
        <span style={{ display: 'inline-flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="t-caption">Descriptive only — a difference is not better or worse.</span>
        </span>
      </div>
      {explanation && <div style={{ padding: '12px 16px 0' }}>{explanation}</div>}
      <div className="tbl-wrap">
        <table className="tbl v2-cmp-tbl">
          <thead>
            <tr>
              <th scope="col">Measurement</th>
              {!simple && <th scope="col">Phase</th>}
              <th scope="col" className="r">
                <AttemptChip side="a" />
              </th>
              <th scope="col" className="r">
                <AttemptChip side="b" />
              </th>
              <th scope="col">B compared with A</th>
              <th scope="col">How well seen, A / B</th>
            </tr>
          </thead>
          <tbody>
            {fullRows.map((row) => {
              const phase = phasesOf(row, a, b)
              return (
                <tr key={row.metric} className={row.comparable ? undefined : 'v2-cmp-nc'}>
                  <th scope="row">{row.info.label}</th>
                  {!simple && <td>{phase ? <span className="tag">{phase}</span> : <span className="subtle">—</span>}</td>}
                  <td className="r num" style={{ whiteSpace: 'nowrap' }}>
                    {row.a.text}
                  </td>
                  <td className="r num" style={{ whiteSpace: 'nowrap', color: row.comparable ? undefined : 'var(--text-3)' }}>
                    {row.b.text}
                  </td>
                  <td style={{ color: row.comparable ? 'var(--text)' : 'var(--text-2)' }}>{sentence(row)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <ConfBadge level={row.a.confidence ?? 'none'} />
                      <ConfBadge level={row.b.confidence ?? 'none'} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {compactRows.length > 0 && (
        <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <CompactRows rows={compactRows} a={a} />
        </div>
      )}
    </section>
  )
}

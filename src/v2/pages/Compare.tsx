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
import { useClip } from '../clips'
import { CompactGap, ConfBadge, EmptyState, ErrorAlert, NoteBox, PageHeader, SkeletonWorkspace } from '../components'
import { useAttempt, useAttempts, type AttemptView } from '../data'
import { compactGapReason, formatTimecode, isCompactGap, MOVEMENT_LABELS, PHASE_LABELS, readMetric, VIEW_LABELS } from '../format'
import { href, navigate, useRoute } from '../router'
import { useIsNarrow } from '../useIsNarrow'
import { useViewMode, ViewModeSwitch } from '../viewMode'
import { alignmentText, buildTimeMap, type AlignMode, type TimeMap } from './compare/align'
import { choosePair } from './compare/pick'
import { createClock, type Clock } from './review/clock'
import { attemptName, comparisonInput, describeAttempt, sessionName } from './review/labels'
import { RelinkOverlay } from './review/Relink'
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
    [x.session.subject_code, MOVEMENT_LABELS[x.session.movement_type], sessionName(x.session), x.session.camera_view && VIEW_LABELS[x.session.camera_view].toLowerCase()]
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
                {attemptName(x)}
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
        <div className="card v2-cmp-pick" style={{ borderColor: 'var(--accent)' }}>
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
  const clipA = useClip(a.id)
  const clipB = useClip(b.id)
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

  const map = useMemo(() => buildTimeMap({ duration: durA, phases: phasesA }, { duration: durB, phases: phasesB }, asked), [durA, durB, phasesA, phasesB, asked])
  const comparison = useMemo(() => compareAttempts(comparisonInput(a), comparisonInput(b), LABELS), [a, b])

  const srcA = clipA && !failed.a ? clipA.objectUrl : null
  const srcB = clipB && !failed.b ? clipB.objectUrl : null
  const showA = !narrow || mode === 'a'
  const showB = !narrow || mode !== 'a'
  const ghostOnB = !narrow || mode === 'overlay'
  // One video keeps time: A's when it is on screen, otherwise B's.
  const aLeads = showA && srcA !== null
  const view = (x: AttemptView) => (x.session.camera_view ? (narrow ? VIEW_LABELS[x.session.camera_view].replace(' view', '') : VIEW_LABELS[x.session.camera_view]) : undefined)
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
          className={map.mode === 'phases' ? 'on' : undefined}
          aria-pressed={map.mode === 'phases'}
          disabled={map.unavailable !== null}
          title={map.unavailable ? 'Needs phases in both attempts' : undefined}
          style={map.unavailable ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          onClick={() => setAsked('phases')}
        >
          Each phase
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
        eyebrow={narrow ? `${MOVEMENT_LABELS[a.session.movement_type]} · ${map.mode === 'phases' ? 'aligned phase by phase' : 'matched by clip length'}` : <span>{eyebrow}</span>}
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
      {(failed.a || failed.b) && (
        <NoteBox title="This browser can’t play one of the video files.">Its skeleton is shown on its own.</NoteBox>
      )}

      <Timelines clock={clock} a={a} b={b} sA={sA} sB={sB} durA={durA} phasesA={phasesA} phasesB={phasesB} map={map} asked={asked} narrow={narrow} alignControl={narrow ? alignControl : null} detail={!simple} />

      <Differences comparison={comparison} a={a} b={b} narrow={narrow} simple={simple} />
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
}

function Timelines({ clock, a, b, sA, sB, durA, phasesA, phasesB, map, asked, narrow, alignControl, detail }: TimelinesProps) {
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
      <p className="t-caption">{alignmentText(map, asked)}</p>

      <div className="v2-cmp-rows">
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
        <ScrubTrack clock={clock} duration={durA} label="Playhead of both attempts" height={32}>
          <div style={{ ...half, top: 0 }}>
            <BandLayer bands={bandsA} duration={durA} />
          </div>
          <div style={{ ...half, bottom: 0 }}>
            <BandLayer bands={bandsB} duration={durA} mapT={map.toA} />
          </div>
        </ScrubTrack>
      </div>
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
            <TraceLayer segments={trunkA} duration={durA} max={top} height={96} dash="5 4" lowDash="1 4" />
            <TraceLayer segments={trunkB} duration={durA} max={top} height={96} stroke="var(--accent)" strokeWidth={2.25} lowDash="1 4" mapT={map.toA} />
          </TraceTrack>
          <TimeAxis duration={durA} />
        </div>
      )}
    </section>
  )
}

// ---------- differences ----------

function pairExplanation(comparison: AttemptComparison): ReactNode {
  if (comparison.reason?.code === 'different_movement') {
    return (
      <NoteBox title="These are different movements.">
        Their measurements aren’t compared: a relevé balance and a pirouette are measured in different phases. Pick two attempts of the same movement to see differences.
      </NoteBox>
    )
  }
  if (comparison.reason?.code === 'different_camera_view') {
    return (
      <NoteBox title="These attempts were filmed from different camera views.">
        The same pose reads differently from the front and from the side, so their measurements aren’t compared. Pick two attempts with the same view to see differences.
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

import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Attempt } from '../types'
import { useStudio } from '../state/studio'
import { clock } from '../state/clock'
import { mapTime, phaseAt } from '../lib/attempts'
import { poseAt } from '../lib/series'
import { formatTime } from '../lib/format'
import { useAttemptAtPlayhead } from '../lib/hooks'
import { PoseStage, type StageLayer } from './PoseStage'
import { Transport } from './Transport'
import { StageVideo, type VideoStatus } from './StageVideo'
import { api } from '../api/client'

/** Small HTML overlay with the attempt, phase and tracking state at the playhead. */
function StageHud({ layer, tag }: { layer: StageLayer; tag?: string }) {
  const { results } = useStudio()
  const info = useSyncExternalStore(clock.subscribe, () => {
    const t = layer.timeFor(clock.get().time)
    const pose = poseAt(results.pose, t, results.session.fps)
    const { start, end, phases } = layer.attempt
    const where =
      t < start || t >= end ? 'Between attempts'
        : t < phases[0].start ? 'Getting ready'
          : phaseAt(layer.attempt, t)?.label ?? 'Settling'
    const tracking = !pose ? 'missing' : pose.confidence < 0.5 ? 'low' : 'ok'
    return `${where}|${formatTime(t)}|${tracking}`
  })
  const [phase, time, tracking] = info.split('|')
  return (
    <>
      <div className="hud hud-tl">
        {layer.color && <span className={`dot dot-${layer.color}`} />}
        {tag && <b>{tag}</b>}
        <span>Attempt {layer.attempt.index}</span>
        <span className="hud-sep">·</span>
        <span>{phase}</span>
        <span className="hud-time">{time}</span>
      </div>
      {tracking === 'low' && <div className="hud hud-warn">Low tracking confidence. Values here are less reliable.</div>}
      {tracking === 'missing' && <div className="hud hud-center">No pose tracked at this moment</div>}
    </>
  )
}

/** One picture: the clip (when there is one and it's switched on) with the skeleton fitted over it. */
function Shot({ layer, ghost, tag, lead, className = '', children }: { layer: StageLayer; ghost?: StageLayer | null; tag?: string; lead: boolean; className?: string; children?: ReactNode }) {
  const { results, state, metric } = useStudio()
  const src = useMemo(() => api.videoUrl(results.session.id), [results.session.id])
  const [aspect, setAspect] = useState(9 / 16)
  const [status, setStatus] = useState<VideoStatus>('loading')
  const focus = metric(state.focusMetric)
  const pulseKey = state.pulse?.metricId === focus.id ? state.pulse.key : undefined
  const showVideo = !!src && state.footage && status !== 'error'
  return (
    <div className={`stage ${className}`}>
      {showVideo && <StageVideo src={src} timeFor={layer.timeFor} lead={lead} fps={results.session.fps} onStatus={setStatus} onAspect={setAspect} />}
      <PoseStage
        results={results}
        main={layer}
        ghost={ghost}
        metric={focus}
        guides={state.guides}
        trails={state.trails}
        pulseKey={pulseKey}
        frameAspect={showVideo ? aspect : null}
        skeleton={showVideo ? state.skeleton : true}
      />
      <StageHud layer={layer} tag={tag} />
      {showVideo && (status === 'loading' || status === 'buffering') && <div className="hud hud-tr">Loading video…</div>}
      {state.footage && (!src || status === 'error') && (
        <div className="hud hud-tr">{!src ? 'No clip for this session. Showing the pose only.' : 'The video couldn’t load. Showing the pose only.'}</div>
      )}
      {children}
    </div>
  )
}

export function StageArea() {
  const { state, dispatch, attemptById } = useStudio()
  const current = useAttemptAtPlayhead(state.attempts)
  const a = attemptById(state.compare.a)
  const b = attemptById(state.compare.b)

  const ghostAttempt: Attempt = current.id === b.id ? a : b
  const ghost: StageLayer | null =
    state.ghost && ghostAttempt.id !== current.id
      ? { attempt: ghostAttempt, timeFor: (t) => mapTime(t, current, ghostAttempt), color: ghostAttempt.id === a.id ? 'a' : 'b' }
      : null

  return (
    <div className="panel stage-panel">
      {state.mode === 'review' ? (
        <Shot layer={{ attempt: current, timeFor: (t) => t }} ghost={ghost} lead>
          {ghost && <div className="hud hud-bl"><span className={`dot dot-${ghost.color}`} /> Ghost: attempt {ghost.attempt.index}, matched by phase</div>}
        </Shot>
      ) : state.compareView === 'overlay' ? (
        <Shot layer={{ attempt: a, timeFor: (t) => t, color: 'a' }} ghost={{ attempt: b, timeFor: (t) => mapTime(t, a, b), color: 'b' }} tag="A" lead>
          <div className="hud hud-bl"><span className="dot dot-b" /> <b>B</b> attempt {b.index}, matched by phase, drawn wide behind A</div>
        </Shot>
      ) : (
        <div className="stage-pair">
          <Shot layer={{ attempt: a, timeFor: (t) => t, color: 'a' }} tag="A" lead className="stage-a" />
          <Shot layer={{ attempt: b, timeFor: (t) => mapTime(t, a, b), color: 'b' }} tag="B" lead={false} className="stage-b" />
        </div>
      )}
      <Transport
        tools={
          <>
        {state.mode === 'compare' && (
          <div className="seg-mini" role="group" aria-label="Compare view">
            <button className={state.compareView === 'side' ? 'on' : ''} onClick={() => dispatch({ type: 'setCompareView', view: 'side' })}>Side by side</button>
            <button className={state.compareView === 'overlay' ? 'on' : ''} onClick={() => dispatch({ type: 'setCompareView', view: 'overlay' })}>Overlay</button>
          </div>
        )}
        {state.mode === 'review' && (
          <button className={`tool-chip ${state.ghost ? 'on' : ''}`} onClick={() => dispatch({ type: 'toggleGhost' })} title="Overlay another attempt's skeleton, aligned phase by phase">
            <span className={`dot dot-${ghostAttempt.id === a.id ? 'a' : 'b'}`} /> Ghost {ghostAttempt.index}
          </button>
        )}
        <button className={`tool-chip ${state.footage ? 'on' : ''}`} onClick={() => dispatch({ type: 'toggleFootage' })} title="Show the clip under the skeleton">
          Video
        </button>
        {state.footage && (
          <button className={`tool-chip ${state.skeleton ? 'on' : ''}`} onClick={() => dispatch({ type: 'toggleSkeleton' })} title="Show the tracked skeleton over the clip">
            Skeleton
          </button>
        )}
        <button className={`tool-chip ${state.guides ? 'on' : ''}`} onClick={() => dispatch({ type: 'toggleGuides' })} title="Highlight the joints and lines the focus measurement uses">
          Guides
        </button>
        <button className={`tool-chip ${state.trails ? 'on' : ''}`} onClick={() => dispatch({ type: 'toggleTrails' })} title="Fading copies of the last moments, to show the path of the movement">
          Trails
        </button>
          </>
        }
      />
    </div>
  )
}

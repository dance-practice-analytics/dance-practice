// The video stage wired to the workspace clock (Review: one; Compare: A and B).
//
// - Paused or scrubbing: the clock is in charge. The video is seeked to the middle of
//   the frame the clock points at — the same instant the pose was estimated on — so the
//   picture and the skeleton are the same frame.
// - Playing, `role: 'lead'`: the video plays natively and reports every frame it
//   presents to the clock; the skeleton is drawn for that frame.
// - Playing, `role: 'follower'` (attempt B): the video is kept at its mapped time
//   (rate-matched, re-seeked when it drifts) and its own skeleton follows the frames it
//   presents, so B's overlay can't slip against B's picture either.
// - No video on this device: the skeleton alone, at the clock's time.
// Only this component re-renders with the playhead.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { PhaseSpan } from '../../../metrics/types'
import type { PoseSeries } from '../../../pose/types'
import { VideoStage } from '../../components'
import { formatTimecode, frameAt, phaseAt, PHASE_LABELS } from '../../format'
import { frameIndex, type Clock } from './clock'
import { seriesEnd } from './timeline'
import { useClockValue } from './useClock'

const identity = (t: number) => t
const one = () => 1

export interface SyncedStageProps {
  clock: Clock
  /** Null when no keypoints are saved: no overlay is requested. */
  series: PoseSeries | null
  /** blob: URL of the local clip, or null when it is not on this device. */
  src: string | null
  /** Who keeps time while playing. Only matters with `src`. */
  role: 'lead' | 'follower'
  /** Clock time → this clip's time, and back (Compare: B against A). Default: the same time. */
  toLocal?: (t: number) => number
  toClock?: (local: number) => number
  /** Speed of this clip's time against the clock at clock time `t`. */
  slopeAt?: (t: number) => number
  /** A second attempt drawn dashed behind this one, at its own mapped time. */
  ghost?: { series: PoseSeries; toLocal?: (t: number) => number } | null
  phases?: readonly PhaseSpan[] | null
  showSkeleton?: boolean
  label?: string
  view?: string
  /** Privacy pill text (e.g. for a backed-up video); default: on this device. */
  privacy?: string
  ariaLabel?: string
  /** Centred on the stage when there is neither video nor pose. */
  placeholder?: ReactNode
  /** Told when the browser can't play the file. */
  onVideoError?(): void
  style?: CSSProperties
  /** Extra content on the stage, above the skeleton (the "Choose the file again" card). */
  children?: ReactNode
}

type FrameMeta = { mediaTime: number }

export function SyncedStage(props: SyncedStageProps) {
  const { clock, series, src, role, ghost, phases, showSkeleton = true, label, view, privacy, ariaLabel, placeholder, onVideoError, style, children } = props
  const toLocal = props.toLocal ?? identity
  const toClock = props.toClock ?? identity
  const slopeAt = props.slopeAt ?? one
  const videoRef = useRef<HTMLVideoElement>(null)
  // Latest maps, read by the sync loop without re-subscribing.
  const maps = useRef({ toLocal, toClock, slopeAt, onVideoError })
  maps.current = { toLocal, toClock, slopeAt, onVideoError }
  const resync = useRef<(() => void) | null>(null)

  const time = useClockValue(clock, (s) => s.time)
  /** A follower's own presented time while it plays. */
  const [own, setOwn] = useState<number | null>(null)
  const fps = series?.fps ?? 0

  useEffect(() => {
    const v = videoRef.current
    if (!v || !src) return
    const lead = role === 'lead'
    let failed = false
    let handle = 0
    const useVfc = typeof v.requestVideoFrameCallback === 'function'
    const grid = fps > 0 ? fps : 30

    const maxSeek = () => (Number.isFinite(v.duration) && v.duration > 0 ? Math.max(0, v.duration - 1e-3) : Infinity)
    /** The middle of the frame interval that contains `local` (as the pose pipeline seeks). */
    const frameCentre = (local: number) => Math.min((frameIndex(local, grid) + 0.5) / grid, maxSeek())

    const sync = () => {
      if (v.readyState < 1 || v.error) return
      const { time: t, playing, rate } = clock.get()
      const target = maps.current.toLocal(t)
      if (playing && !failed) {
        const wanted = Math.min(16, Math.max(0.0625, lead ? rate : rate * maps.current.slopeAt(t)))
        if (Math.abs(v.playbackRate - wanted) > 1e-3) v.playbackRate = wanted
        const ended = target >= maxSeek() - 0.02
        if (!v.seeking && Math.abs(v.currentTime - target) > (lead ? 0.25 : 0.12)) v.currentTime = Math.min(target, maxSeek())
        if (v.paused && !v.seeking && !ended) {
          v.play().catch(() => {
            // Playback refused: the clock's own timer takes over and the video is stepped.
            failed = true
            if (lead) clock.setExternal(false)
            sync()
          })
        }
        return
      }
      if (!v.paused) v.pause()
      setOwn(null)
      const centre = frameCentre(target)
      // One seek at a time; 'seeked' calls sync again for the latest position.
      if (!v.seeking && Math.abs(v.currentTime - centre) > 0.2 / grid) v.currentTime = centre
    }

    const onFrame = (_now: number, meta?: FrameMeta) => {
      schedule()
      if (v.paused || v.seeking || !clock.get().playing || failed) return
      const media = meta?.mediaTime ?? v.currentTime
      // A frame from before a seek is stale.
      if (Math.abs(media - v.currentTime) > 0.25) return
      // The presented frame's timestamp sits on (or a hair before) a frame start: the
      // quarter-frame bias keeps it in the frame it belongs to.
      const local = Math.floor(media * grid + (meta ? 0.25 : 1e-6)) / grid
      // Rendered inside this callback, so the skeleton is painted with the frame it belongs to.
      if (lead) clock.report(maps.current.toClock(local))
      else flushSync(() => setOwn(local))
    }
    function schedule() {
      handle = useVfc ? v!.requestVideoFrameCallback(onFrame) : requestAnimationFrame((now) => onFrame(now))
    }

    const onEnded = () => {
      if (lead) clock.finish()
    }
    const onError = () => {
      failed = true
      if (lead) clock.setExternal(false)
      maps.current.onVideoError?.()
    }

    if (lead) clock.setExternal(true)
    resync.current = sync
    const unsubscribe = clock.subscribe(sync)
    schedule()
    const events = ['loadedmetadata', 'canplay', 'seeked'] as const
    events.forEach((e) => v.addEventListener(e, sync))
    v.addEventListener('ended', onEnded)
    v.addEventListener('error', onError)
    sync()
    return () => {
      resync.current = null
      unsubscribe()
      if (useVfc) v.cancelVideoFrameCallback(handle)
      else cancelAnimationFrame(handle)
      events.forEach((e) => v.removeEventListener(e, sync))
      v.removeEventListener('ended', onEnded)
      v.removeEventListener('error', onError)
      if (lead) clock.setExternal(false)
      v.pause()
      setOwn(null)
    }
  }, [clock, src, role, fps])

  // A new alignment moves this clip even though the clock didn't.
  useEffect(() => resync.current?.(), [toLocal])

  const local = own ?? toLocal(time)
  const end = series ? seriesEnd(series) : 0
  const frame = series ? frameAt(series, local) : undefined
  // The pill shows the time of the frame that is drawn.
  const shown = fps > 0 ? Math.min(frameIndex(local, fps) / fps, end) : Math.min(local, end)
  const ghostFrame = ghost ? frameAt(ghost.series, (ghost.toLocal ?? identity)(time)) : undefined
  const phase = phaseAt(phases as PhaseSpan[] | null | undefined, local)
  // FR-3.2.7: outside the processed part of a trimmed clip there is simply no pose.
  const outsideTrim = !!series?.trim && frame === null && series.frames.length > 0 &&
    (local < series.frames[0].t || local >= series.frames[series.frames.length - 1].t + 1 / series.fps)

  return (
    <VideoStage
      src={src}
      frame={frame}
      ghostFrame={ghostFrame}
      width={series?.width}
      height={series?.height}
      videoRef={videoRef}
      showSkeleton={showSkeleton}
      label={label}
      view={view}
      privacy={privacy}
      timecode={series ? `${formatTimecode(shown)} / ${formatTimecode(end)}` : undefined}
      phase={phase ? PHASE_LABELS[phase.phase] : undefined}
      noTrackingLabel={outsideTrim ? 'Outside the trim' : undefined}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      style={style}
    >
      {children}
    </VideoStage>
  )
}

// The session clip under the skeleton. The shared clock stays in charge: the
// leading video plays natively and becomes the clock's time source while
// playing; a follower (attempt B, phase-matched) is seeked to its mapped time.

import { useEffect, useRef, useState } from 'react'
import { clock } from '../state/clock'

export type VideoStatus = 'loading' | 'ready' | 'buffering' | 'error'

interface Props {
  src: string
  /** Map clock time to this clip's time. */
  timeFor: (t: number) => number
  /** The leading clip plays at clock rate and drives the clock; followers only seek. */
  lead: boolean
  fps: number
  onStatus?: (s: VideoStatus) => void
  /** Width / height of the clip, once known, so the skeleton can be fitted onto the picture. */
  onAspect?: (aspect: number) => void
}

export function StageVideo({ src, timeFor, lead, fps, onStatus, onAspect }: Props) {
  const ref = useRef<HTMLVideoElement>(null)
  const timeForRef = useRef(timeFor)
  timeForRef.current = timeFor
  const aspectRef = useRef(onAspect)
  aspectRef.current = onAspect
  const [status, setStatus] = useState<VideoStatus>('loading')

  useEffect(() => onStatus?.(status), [status, onStatus])

  useEffect(() => {
    const v = ref.current!
    let playFailed = false
    const sync = () => {
      if (v.readyState < 1 || v.error) return
      const { time, playing, rate } = clock.get()
      const target = timeForRef.current(time)
      if (lead && playing && !playFailed) {
        if (v.playbackRate !== rate) v.playbackRate = rate
        if (Math.abs(v.currentTime - target) > 0.15) v.currentTime = target
        if (v.paused) v.play().catch(() => (playFailed = true))
        return
      }
      if (!v.paused) v.pause()
      // Skip while a seek is in flight so scrubbing doesn't queue up seeks.
      if (!v.seeking && Math.abs(v.currentTime - target) > 0.5 / fps) v.currentTime = target
    }
    const unsubscribe = clock.subscribe(sync)
    if (lead) clock.setSource(() => (v.readyState >= 2 && !v.error && !playFailed && !v.paused ? v.currentTime : null))
    const onMeta = () => {
      if (v.videoWidth && v.videoHeight) aspectRef.current?.(v.videoWidth / v.videoHeight)
      sync()
    }
    const onReady = () => {
      setStatus('ready')
      sync()
    }
    const onWaiting = () => setStatus('buffering')
    const onError = () => setStatus('error')
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('canplay', onReady)
    v.addEventListener('playing', onReady)
    v.addEventListener('waiting', onWaiting)
    v.addEventListener('error', onError)
    return () => {
      unsubscribe()
      if (lead) clock.setSource(null)
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('canplay', onReady)
      v.removeEventListener('playing', onReady)
      v.removeEventListener('waiting', onWaiting)
      v.removeEventListener('error', onError)
      v.pause()
    }
  }, [src, lead, fps])

  return <video ref={ref} className="stage-video" src={src} muted playsInline preload="auto" aria-hidden="true" />
}

// Transport controls (Review.dc.html › transport card): frame step, play / pause,
// timecode, frame number, speed. Everything drives the one workspace clock.

import type { ReactNode } from 'react'
import { Icon } from '../../components'
import { formatTimecode } from '../../format'
import { useViewMode } from '../../viewMode'
import { frameIndex, RATES, type Clock } from './clock'
import { useClockValue } from './useClock'

/** `00:03.48 / 00:08.40` in Geist Mono, plus the frame number. Re-renders with the playhead; nothing else does. */
export function TimeReadout({ clock, size = 14, showFrame = true }: { clock: Clock; size?: number; showFrame?: boolean }) {
  const time = useClockValue(clock, (s) => s.time)
  const playing = useClockValue(clock, (s) => s.playing)
  const { duration, fps } = clock.get()
  return (
    <>
      {/* Announced when the playhead is moved by hand, not thirty times a second while playing. */}
      <span className="mono" style={{ fontSize: size, padding: '0 8px', whiteSpace: 'nowrap' }} aria-live={playing ? 'off' : 'polite'}>
        {formatTimecode(Math.min(time, duration))} / {formatTimecode(duration)}
      </span>
      {showFrame && fps > 0 && (
        <span className="mono subtle" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          f {frameIndex(Math.min(time, duration), fps)}
        </span>
      )}
    </>
  )
}

export function PlayButton({ clock, large, small, label }: { clock: Clock; large?: boolean; small?: boolean; label?: string }) {
  const playing = useClockValue(clock, (s) => s.playing)
  const ready = useClockValue(clock, (s) => s.duration > 0)
  return (
    <button
      className={`btn btn-primary btn-icon${large ? ' btn-lg' : ''}${small ? ' btn-sm' : ''}`}
      type="button"
      aria-label={playing ? 'Pause' : (label ?? 'Play')}
      disabled={!ready}
      onClick={() => clock.toggle()}
    >
      <Icon name={playing ? 'pause' : 'play'} />
    </button>
  )
}

export function StepButton({ clock, direction, large }: { clock: Clock; direction: -1 | 1; large?: boolean }) {
  const ready = useClockValue(clock, (s) => s.duration > 0)
  return (
    <button
      className={`btn btn-ghost btn-icon${large ? ' btn-lg' : ''}`}
      type="button"
      aria-label={direction < 0 ? 'Previous frame' : 'Next frame'}
      disabled={!ready}
      onClick={() => clock.step(direction)}
    >
      <Icon name={direction < 0 ? 'step-back' : 'step-forward'} />
    </button>
  )
}

export function SpeedControl({ clock, dense }: { clock: Clock; dense?: boolean }) {
  const rate = useClockValue(clock, (s) => s.rate)
  return (
    <div className="seg" role="group" aria-label="Playback speed">
      {RATES.map((r) => (
        <button
          key={r}
          type="button"
          className={rate === r ? 'on' : undefined}
          aria-pressed={rate === r}
          style={dense ? { padding: '0 9px', height: 40 } : undefined}
          onClick={() => clock.setRate(r)}
        >
          {r}×
        </button>
      ))}
    </div>
  )
}

export interface TransportProps {
  clock: Clock
  narrow?: boolean
  /** Extra controls after the speed (switches). */
  children?: ReactNode
}

export function Transport({ clock, narrow, children }: TransportProps) {
  // The frame number is for frame-by-frame work: Detail view only.
  const detail = useViewMode() === 'detail'
  if (narrow) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StepButton clock={clock} direction={-1} large />
          <PlayButton clock={clock} large />
          <StepButton clock={clock} direction={1} large />
          <span style={{ flex: 1 }} />
          <TimeReadout clock={clock} size={13} showFrame={false} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px 10px', flexWrap: 'wrap' }}>
          <SpeedControl clock={clock} dense />
          <span style={{ flex: 1 }} />
          {children}
        </div>
      </div>
    )
  }
  return (
    <div className="card" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
      <StepButton clock={clock} direction={-1} />
      <PlayButton clock={clock} />
      <StepButton clock={clock} direction={1} />
      <TimeReadout clock={clock} showFrame={detail} />
      <span style={{ flex: 1 }} />
      <SpeedControl clock={clock} />
      {children}
    </div>
  )
}

/** What the stage shows: the video with the skeleton over it (default), the video alone, or the skeleton alone. */
export type StageShow = 'both' | 'video' | 'skeleton'

export const showsVideo = (s: StageShow) => s !== 'skeleton'
export const showsSkeleton = (s: StageShow) => s !== 'video'

const SHOW_LABELS: Record<StageShow, string> = { both: 'Both', video: 'Video', skeleton: 'Skeleton' }

/**
 * Both · Video · Skeleton. Hiding the video keeps it playing underneath (it still keeps time);
 * 'Video' is disabled when the clip isn't on this device, since there would be nothing to show.
 */
export function ShowSwitch({ value, onChange, hasVideo, dense }: { value: StageShow; onChange(next: StageShow): void; hasVideo: boolean; dense?: boolean }) {
  return (
    <div className="seg" role="group" aria-label="Show on the stage">
      {(['both', 'video', 'skeleton'] as const).map((s) => {
        const off = s === 'video' && !hasVideo
        return (
          <button
            key={s}
            type="button"
            className={value === s ? 'on' : undefined}
            aria-pressed={value === s}
            disabled={off}
            title={off ? 'The video isn’t on this device' : s === 'both' ? 'Video with the skeleton over it' : `${SHOW_LABELS[s]} only`}
            style={{ ...(dense ? { padding: '0 9px', height: 40 } : null), ...(off ? { opacity: 0.5, cursor: 'not-allowed' } : null) }}
            onClick={() => onChange(s)}
          >
            {SHOW_LABELS[s]}
          </button>
        )
      })}
    </div>
  )
}

/** `.switch` with its label, as in the design's "Loop phase". */
export function Switch({ label, ariaLabel, checked, onChange, disabled, title }: { label: string; ariaLabel?: string; checked: boolean; onChange(next: boolean): void; disabled?: boolean; title?: string }) {
  return (
    <label className="t-small muted" title={title} style={{ display: 'flex', gap: 8, alignItems: 'center', opacity: disabled ? 0.55 : 1 }}>
      {label}
      <input className="switch" type="checkbox" role="switch" aria-label={ariaLabel} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

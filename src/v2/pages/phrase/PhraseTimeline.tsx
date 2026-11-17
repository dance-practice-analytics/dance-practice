// Event strip of a phrase attempt, under the stage (Review) or the transport (Compare):
// one lane per kind (legs, folds, turns, rise / plié). Each event is a button that moves
// the clock to its start, so the video and the skeleton show it. Values only.

import { memo, useMemo } from 'react'
import type { PhraseResult } from '../../../metrics/phrase'
import type { Clock } from '../review/clock'
import { TimeAxis } from '../review/Tracks'
import { useClockValue } from '../review/useClock'
import { LANES, layoutEvents, type LaidOutEvent } from './model'
import './phrase.css'

export interface PhraseTimelineProps {
  clock: Clock
  phrase: PhraseResult
  /** Length of the clock's clip (A's in Compare). */
  duration: number
  /** Puts this attempt's times on the clock's time (Compare: B → A). */
  mapT?: (t: number) => number
  /** Accessible name of the group. */
  label?: string
  /** Event indices that were matched with the other attempt (Compare). */
  matched?: ReadonlySet<number>
  /** Hide the time axis (when another strip below shows it). */
  axis?: boolean
  /** Fewer words: lane labels only. */
  compact?: boolean
}

export function PhraseTimeline({ clock, phrase, duration, mapT, label = 'Events', matched, axis = true, compact }: PhraseTimelineProps) {
  const laid = useMemo(() => layoutEvents(phrase, duration, mapT), [phrase, duration, mapT])
  const used = LANES.map((_, i) => laid.some((e) => e.lane === i))
  if (!laid.length) {
    return (
      <div className="ribbon ribbon-sm">
        <div className="phase unread" style={{ flex: 1 }}>
          No events were found in this clip
        </div>
      </div>
    )
  }
  return (
    <div className="v2-phr-lanes" role="group" aria-label={label}>
      {LANES.map((lane, i) =>
        used[i] ? (
          <div className="v2-phr-lane" key={lane.key}>
            <span className="v2-phr-lane-label" title={lane.label}>
              {lane.label}
            </span>
            <Lane clock={clock} events={laid.filter((e) => e.lane === i)} duration={duration} mapT={mapT} matched={matched} compact={compact} />
          </div>
        ) : null,
      )}
      {axis && (
        <div className="v2-phr-axis">
          <span />
          <TimeAxis duration={duration} />
        </div>
      )}
    </div>
  )
}

interface LaneProps {
  clock: Clock
  events: LaidOutEvent[]
  duration: number
  mapT?: (t: number) => number
  matched?: ReadonlySet<number>
  compact?: boolean
}

/** One lane; only the playhead follows the clock, the buttons re-render when the current event changes. */
const Lane = memo(function Lane({ clock, events, duration, mapT, matched, compact }: LaneProps) {
  const x = mapT ?? ((t: number) => t)
  const current = useClockValue(clock, (s) => events.findIndex((e) => s.time >= x(e.event.start) && s.time < x(e.event.end)))
  return (
    <div className="v2-phr-track">
      {events.map((e, i) => {
        const cls = [
          'v2-phr-ev',
          e.anchor ? 'is-anchor' : '',
          e.event.side_uncertain ? 'is-uncertain' : '',
          matched?.has(e.index) ? 'is-matched' : '',
          i === current ? 'is-now' : '',
        ]
          .filter(Boolean)
          .join(' ')
        const name = `${e.anchor ? 'Main leg extension: ' : ''}${e.description}`
        return (
          <button
            key={e.index}
            type="button"
            className={cls}
            style={{ left: `${e.left * 100}%`, width: `${e.width * 100}%` }}
            title={name}
            aria-label={name}
            aria-current={i === current ? 'step' : undefined}
            onClick={() => clock.seek(x(e.event.start))}
          >
            {!compact || e.width > 0.06 ? e.short : null}
          </button>
        )
      })}
      <Playhead clock={clock} duration={duration} />
    </div>
  )
})

function Playhead({ clock, duration }: { clock: Clock; duration: number }) {
  const t = useClockValue(clock, (s) => s.time)
  if (!(duration > 0)) return null
  return <span className="v2-phr-playhead" aria-hidden="true" style={{ left: `${Math.min(1, Math.max(0, t / duration)) * 100}%` }} />
}

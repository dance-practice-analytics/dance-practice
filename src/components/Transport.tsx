import type { ReactNode } from 'react'
import { useStudio } from '../state/studio'
import { clock, useClock } from '../state/clock'
import { formatTime } from '../lib/format'

const RATES = [0.25, 0.5, 1]

export function Transport({ tools }: { tools?: ReactNode }) {
  const { results, state, dispatch } = useStudio()
  const { time, playing, rate } = useClock()
  const { fps, duration } = results.session
  const starts = state.attempts.map((a) => a.start)

  const jump = (dir: -1 | 1) => {
    const target = dir < 0 ? [...starts].reverse().find((s) => s < time - 0.3) : starts.find((s) => s > time + 0.05)
    if (target !== undefined) clock.seek(target)
  }

  return (
    <div className="transport">
      <div className="transport-buttons">
        <button className="icon-btn" onClick={() => jump(-1)} title="Previous attempt" aria-label="Previous attempt">⏮</button>
        <button className="icon-btn" onClick={() => clock.seek(time - 1 / fps)} title="Back one frame (←)" aria-label="Back one frame">◀︎</button>
        <button className="play-btn" onClick={clock.toggle} title="Play or pause (Space)" aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="icon-btn" onClick={() => clock.seek(time + 1 / fps)} title="Forward one frame (→)" aria-label="Forward one frame">▶︎</button>
        <button className="icon-btn" onClick={() => jump(1)} title="Next attempt" aria-label="Next attempt">⏭</button>
      </div>
      <div className="transport-time">
        <b>{formatTime(time)}</b> / {formatTime(duration)}
      </div>
      <button className="rate-btn" onClick={() => clock.setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length])} title="Playback speed" aria-label={`Playback speed ${rate} times, click to change`}>
        {rate}×
      </button>
      {tools && <div className="transport-tools">{tools}</div>}
      <button className="btn btn-marker" onClick={() => dispatch({ type: 'addMarker', t: time, text: '', author: 'dancer' })} title="Mark this moment (M)">
        ◆ Mark
      </button>
    </div>
  )
}

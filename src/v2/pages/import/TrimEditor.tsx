// FR-3.2.7: optional start / end of the part of a clip to process. The preview plays
// the local file through a blob URL that is revoked when the editor closes; nothing
// is read from it but the current time. Frame times stay those of the original clip,
// so Review lines the keypoints up with the whole video.

import { useEffect, useId, useRef, useState } from 'react'
import { MIN_TRIM_S } from '../../../pose/frames'
import { formatLength, rowTrim } from './model'

export interface TrimValue {
  trimStart: number | null
  trimEnd: number | null
}

interface Props {
  file: File
  name: string
  durationS: number | null
  value: TrimValue
  onChange(value: TrimValue): void
  onClose(): void
}

/** Seconds typed in an input → a number, or null for an empty field (open end). */
export function parseSeconds(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN
}

const show = (n: number | null) => (n === null || Number.isNaN(n) ? '' : String(n))

export function TrimEditor({ file, name, durationS, value, onChange, onClose }: Props) {
  const id = useId()
  const video = useRef<HTMLVideoElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [now, setNow] = useState(0)
  const [startText, setStartText] = useState(show(value.trimStart))
  const [endText, setEndText] = useState(show(value.trimEnd))

  // A blob URL for this editor only; revoked on close so the file isn't held open.
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  const { problem } = rowTrim({ trimStart: value.trimStart, trimEnd: value.trimEnd, durationS })

  const seek = (t: number | null) => {
    const v = video.current
    if (v && t !== null && Number.isFinite(t)) v.currentTime = Math.max(0, Math.min(t, durationS ?? t))
  }

  const commit = (which: 'start' | 'end', text: string) => {
    const n = parseSeconds(text)
    const next = which === 'start' ? { ...value, trimStart: n } : { ...value, trimEnd: n }
    onChange(next)
    seek(n)
  }

  const here = (which: 'start' | 'end') => {
    const t = Math.round((video.current?.currentTime ?? now) * 100) / 100
    if (which === 'start') setStartText(String(t))
    else setEndText(String(t))
    onChange(which === 'start' ? { ...value, trimStart: t } : { ...value, trimEnd: t })
  }

  const clear = () => {
    setStartText('')
    setEndText('')
    onChange({ trimStart: null, trimEnd: null })
  }

  return (
    <div className="v2-imp-trim" role="group" aria-labelledby={`${id}-h`}>
      <div className="v2-imp-trim-stage">
        {url && (
          <video
            ref={video}
            src={url}
            muted
            playsInline
            controls
            preload="metadata"
            aria-label={`Preview of ${name}`}
            onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
            onSeeked={(e) => setNow(e.currentTarget.currentTime)}
          />
        )}
      </div>
      <div className="v2-imp-trim-form">
        <p className="t-small" id={`${id}-h`}>
          <strong>Trim before processing</strong> <span className="muted">(optional)</span>
        </p>
        <p className="t-caption">
          Only the part between start and end is analyzed. Leave a field empty to keep the beginning or the end. Times stay those of the
          whole clip, so Review still plays it from the start. At least {MIN_TRIM_S} s.
        </p>
        <p className="t-caption mono" aria-live="off">
          Preview at {formatLength(now)} of {formatLength(durationS)}
        </p>
        <div className="v2-imp-trim-fields">
          <label className="field" htmlFor={`${id}-start`}>
            <span className="t-label">Start (s)</span>
            <input
              id={`${id}-start`}
              className="input input-sm mono"
              type="number"
              inputMode="decimal"
              min={0}
              max={durationS ?? undefined}
              step={0.1}
              placeholder="0"
              value={startText}
              aria-invalid={!!problem || undefined}
              aria-describedby={problem ? `${id}-err` : undefined}
              onChange={(e) => setStartText(e.target.value)}
              onBlur={(e) => commit('start', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commit('start', e.currentTarget.value)}
            />
          </label>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => here('start')}>
            Start here
          </button>
          <label className="field" htmlFor={`${id}-end`}>
            <span className="t-label">End (s)</span>
            <input
              id={`${id}-end`}
              className="input input-sm mono"
              type="number"
              inputMode="decimal"
              min={0}
              max={durationS ?? undefined}
              step={0.1}
              placeholder={durationS ? durationS.toFixed(1) : ''}
              value={endText}
              aria-invalid={!!problem || undefined}
              aria-describedby={problem ? `${id}-err` : undefined}
              onChange={(e) => setEndText(e.target.value)}
              onBlur={(e) => commit('end', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commit('end', e.currentTarget.value)}
            />
          </label>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => here('end')}>
            End here
          </button>
        </div>
        {problem && (
          <p className="err-msg" id={`${id}-err`} role="alert">
            {problem}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" type="button" onClick={onClose}>
            Done
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={clear} disabled={value.trimStart === null && value.trimEnd === null}>
            Use the whole clip
          </button>
        </div>
      </div>
    </div>
  )
}

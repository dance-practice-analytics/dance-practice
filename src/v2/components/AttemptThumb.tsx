// Attempt thumbnail: the dark `.thumb` tile with a small skeleton drawn from the
// attempt's saved keypoints (one representative frame, see thumbPose.ts). The keypoints
// are fetched only once the tile is near the screen, at most two at a time, decoded once
// and reduced to 33 points kept by attempt id, in memory and in this tab's sessionStorage.
// A keypoints file is ~300 KB and Storage can take seconds per file on a phone network,
// so without that copy every reload left the dashboard tiles blank for a long while.
// While loading the tile shimmers; a failed download is tried once more. On failure or
// when nothing was tracked, the tile stays the plain dark box: no pose is ever invented.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { downloadKeypoints } from '../../data/repo'
import { decodeSeries } from '../../pose/codec'
import { LM, type Landmark } from '../../pose/types'
import { client } from '../auth'
import type { AttemptView } from '../data'
import { getCachedSeries } from '../pipeline'
import { thumbPose, type ThumbPose } from './thumbPose'
import { LOW_VISIBILITY, SEGMENTS } from './VideoStage'

// ---------- loading: memory cache, in-flight dedupe, two downloads at a time ----------

type ThumbAttempt = Pick<AttemptView, 'id' | 'status' | 'metrics'>

/** null = processed but no tracked frame (or no keypoints file): a plain tile, cached too. */
const poses = new Map<string, ThumbPose | null>()

// The tab's copy: a few hundred bytes per attempt, gone when the tab closes. Never video.
const STORE_KEY = 'dpa-thumb-poses-v1'
const STORE_MAX = 120
let restored = false

function restore(): void {
  if (restored) return
  restored = true
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '[]') as [string, ThumbPose | null][]
    for (const [k, v] of saved) if (!poses.has(k)) poses.set(k, v)
  } catch {
    // Storage blocked or a bad copy: the tiles load from Storage as before.
  }
}

function persist(): void {
  try {
    const round = (v: number) => Math.round(v * 1e4) / 1e4
    const entries = [...poses].slice(-STORE_MAX).map(([k, v]): [string, ThumbPose | null] => [
      k,
      v && { width: v.width, height: v.height, points: v.points.map((p) => ({ x: round(p.x), y: round(p.y), z: round(p.z), visibility: round(p.visibility) })) },
    ])
    sessionStorage.setItem(STORE_KEY, JSON.stringify(entries))
  } catch {
    // Full or blocked: the memory copy still serves this page.
  }
}
const inflight = new Map<string, Promise<ThumbPose | null>>()
const MAX_PARALLEL = 2
let running = 0
const waiting: (() => void)[] = []

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((go) => waiting.push(go))
  running++
  try {
    return await task()
  } finally {
    running--
    waiting.shift()?.()
  }
}

// Reprocessing rewrites keypoints and phases, so the metrics timestamp is part of the key.
const keyOf = (a: ThumbAttempt) => `${a.id}|${a.metrics?.computed_at ?? ''}`

function loadPose(a: ThumbAttempt): Promise<ThumbPose | null> {
  const key = keyOf(a)
  const known = inflight.get(key)
  if (known) return known
  const phases = a.metrics?.phases
  const cached = getCachedSeries(a.id)
  const p = (
    cached
      ? Promise.resolve(thumbPose(cached, phases))
      : limited(() => downloadKeypoints(client(), a.id).then(decodeSeries)).then((s) => thumbPose(s, phases))
  ).then(
    (pose) => {
      poses.set(key, pose)
      inflight.delete(key)
      persist()
      return pose
    },
    (e: unknown) => {
      // Not cached: a network error may pass, the next mount tries again.
      inflight.delete(key)
      throw e
    },
  )
  inflight.set(key, p)
  return p
}

const RETRY_MS = 4000

function useThumbPose(attempt: ThumbAttempt, enabled: boolean) {
  restore()
  const ref = useRef<HTMLDivElement>(null)
  const key = keyOf(attempt)
  const [state, setState] = useState<{ key: string; pose: ThumbPose | null; settled: boolean }>(() => ({ key, pose: poses.get(key) ?? null, settled: poses.has(key) }))
  const known = poses.has(key)

  useEffect(() => {
    if (!enabled || known) return
    const el = ref.current
    let live = true
    let retry: ReturnType<typeof setTimeout> | undefined
    const start = (again = true) => {
      loadPose(attempt).then(
        (pose) => live && setState({ key, pose, settled: true }),
        () => {
          // A dropped request on a phone network: one more try, then the plain tile.
          if (live && again) retry = setTimeout(() => start(false), RETRY_MS)
          else if (live) setState({ key, pose: null, settled: true })
        },
      )
    }
    if (!el || typeof IntersectionObserver === 'undefined') {
      start()
      return () => {
        live = false
        clearTimeout(retry)
      }
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        start()
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => {
      live = false
      clearTimeout(retry)
      io.disconnect()
    }
    // `attempt` is read through `key`; its other fields don't change what is loaded.
  }, [key, enabled, known])

  const pose = !enabled ? null : known ? (poses.get(key) ?? null) : state.key === key ? state.pose : null
  const loading = enabled && !known && !(state.key === key && state.settled)
  return { ref, pose, loading }
}

// ---------- drawing ----------

const DRAWN = [LM.nose, ...new Set(SEGMENTS.flat())]

function ThumbSkeleton({ pose }: { pose: ThumbPose }) {
  const { points, width: w, height: h } = pose
  const pt = (i: number) => ({ x: points[i].x * w, y: points[i].y * h })
  const weak = (...idx: number[]) => idx.some((i) => (points[i] as Landmark).visibility < LOW_VISIBILITY)

  const ls = pt(LM.leftShoulder)
  const rs = pt(LM.rightShoulder)
  const lh = pt(LM.leftHip)
  const rh = pt(LM.rightHip)
  const neck = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }
  const pelvis = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 }
  const nose = pt(LM.nose)
  const le = pt(LM.leftEar)
  const re = pt(LM.rightEar)
  const headR = Math.max(Math.hypot(le.x - re.x, le.y - re.y) * 0.6, Math.hypot(ls.x - rs.x, ls.y - rs.y) * 0.22, 4)

  // Fit the body (not the whole frame) into the tile, with a little air around it.
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const i of DRAWN) {
    const p = pt(i)
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  x0 = Math.min(x0, nose.x - headR)
  x1 = Math.max(x1, nose.x + headR)
  y0 = Math.min(y0, nose.y - headR)
  const pad = Math.max(x1 - x0, y1 - y0) * 0.1 + 2
  const box = `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`
  const fixed = { vectorEffect: 'non-scaling-stroke' } as const
  const dash = (low: boolean) => (low ? { strokeDasharray: '2 2.5', opacity: 0.55 } : {})

  return (
    <svg
      viewBox={box}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      <g fill="none" stroke="var(--bone)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx={nose.x} cy={nose.y} r={headR} {...dash(weak(LM.nose))} {...fixed} />
        {SEGMENTS.map(([a, b]) => {
          const p = pt(a)
          const q = pt(b)
          return <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} {...dash(weak(a, b))} {...fixed} />
        })}
        <line
          x1={neck.x}
          y1={neck.y}
          x2={pelvis.x}
          y2={pelvis.y}
          stroke="var(--stage-accent)"
          strokeWidth={2}
          {...dash(weak(LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip))}
          {...fixed}
        />
      </g>
    </svg>
  )
}

// ---------- component ----------

export interface AttemptThumbProps {
  attempt: ThumbAttempt
  /** Draw the pose. Default: once the attempt is processed (`status === 'done'`). */
  draw?: boolean
  /** Tile classes; default 'thumb'. Pass the page's hatch class for low / no tracking. */
  className?: string
  style?: CSSProperties
  /** Drawn over the pose, e.g. the attempt number. */
  children?: ReactNode
}

export function AttemptThumb({ attempt, draw, className = 'thumb', style, children }: AttemptThumbProps) {
  const { ref, pose, loading } = useThumbPose(attempt, draw ?? attempt.status === 'done')
  return (
    <div ref={ref} className={loading ? `${className} v2-thumb-loading` : className} style={style} aria-busy={loading || undefined}>
      {pose && <ThumbSkeleton pose={pose} />}
      {children}
    </div>
  )
}

// Canvas stage: the pose skeleton (later drawn over the real <video>), the
// joints of the selected metric, measurement guides and an optional ghost.

import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Attempt, Keypoint, MetricDefinition, Point, SessionResults } from '../types'
import { appliesIn, poseAt, sampleAt, type PoseAt } from '../lib/series'
import { phaseAt } from '../lib/attempts'
import { clock } from '../state/clock'

export interface StageLayer {
  attempt: Attempt
  /** Map clock time to this layer's source-video time. */
  timeFor: (t: number) => number
  color?: 'a' | 'b'
}

interface Props {
  results: SessionResults
  main: StageLayer
  ghost?: StageLayer | null
  metric: MetricDefinition
  guides: boolean
  /** Fading copies of the last few tenths of a second, to show the path of the movement. */
  trails?: boolean
  pulseKey?: number
  /** Width / height of the clip playing underneath. The skeleton is fitted onto the picture and the canvas stays transparent. */
  frameAspect?: number | null
  /** Draw the skeleton (and ghost, trails). Guides still show when it's hidden. */
  skeleton?: boolean
}

/** Fit a standing figure (about 1.16 body heights tall with arms up) into a w x h box. */
export function fitFigure(w: number, h: number) {
  const scale = Math.min((h * 0.8) / 1.16, (w * 0.92) / 0.62)
  const floorY = h * 0.91
  const cx = w / 2
  const P: Project = ([x, y]) => [cx + x * scale, floorY - y * scale]
  return { scale, floorY, cx, P }
}

/** Like `fitFigure`, but inside the picture of a clip shown with object-fit: contain. */
export function fitStage(w: number, h: number, aspect?: number | null) {
  if (!aspect) return fitFigure(w, h)
  const fw = Math.min(w, h * aspect)
  const fh = fw / aspect
  const x0 = (w - fw) / 2
  const y0 = (h - fh) / 2
  const f = fitFigure(fw, fh)
  const P: Project = ([x, y]) => [x0 + f.cx + x * f.scale, y0 + f.floorY - y * f.scale]
  return { scale: f.scale, floorY: y0 + f.floorY, cx: x0 + f.cx, P }
}

const TRAIL_STEPS = 6
const TRAIL_DT = 0.07

const C = {
  bone: 'rgba(232, 229, 222, 0.92)',
  joint: '#f6f3ec',
  accent: '#b3a2ff',
  a: '#6ea2ff',
  b: '#f0b354',
  floor: 'rgba(255, 255, 255, 0.08)',
  label: 'rgba(16, 17, 20, 0.82)',
}

export const BONES: [Keypoint, Keypoint][] = [
  ['leftShoulder', 'rightShoulder'], ['leftHip', 'rightHip'],
  ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'],
  ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'],
  ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'],
  ['leftAnkle', 'leftHeel'], ['leftAnkle', 'leftToe'],
  ['rightAnkle', 'rightHeel'], ['rightAnkle', 'rightToe'],
]

export const JOINTS: Keypoint[] = [
  'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist',
  'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle', 'leftToe', 'rightToe',
]

const SIDES: ['left' | 'right', number][] = [['left', 1], ['right', -1]]
const HEAD_R = 0.045

export type Project = (p: Point) => [number, number]

const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
const headCenter = (p: PoseAt['points']): Point => {
  const m = mid(p.leftEar, p.rightEar)
  return [m[0], m[1] + 0.012]
}

export function skeleton(ctx: CanvasRenderingContext2D, pose: PoseAt, P: Project, scale: number, color: string, width: number, joints: boolean) {
  const p = pose.points
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  for (const [a, b] of BONES) {
    ctx.moveTo(...P(p[a]))
    ctx.lineTo(...P(p[b]))
  }
  const head = headCenter(p)
  ctx.moveTo(...P(mid(p.leftShoulder, p.rightShoulder)))
  ctx.lineTo(...P([head[0], head[1] - HEAD_R]))
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(...P(head), HEAD_R * scale, 0, Math.PI * 2)
  ctx.stroke()
  if (!joints) return
  ctx.fillStyle = C.joint
  for (const k of JOINTS) {
    ctx.beginPath()
    ctx.arc(...P(p[k]), 3.2, 0, Math.PI * 2)
    ctx.fill()
  }
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: 'left' | 'right' | 'center' = 'left') {
  ctx.font = '600 12px Geist, system-ui, sans-serif'
  const w = ctx.measureText(text).width + 12
  const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2
  ctx.fillStyle = C.label
  ctx.beginPath()
  ctx.roundRect(x0, y - 10, w, 20, 6)
  ctx.fill()
  ctx.fillStyle = C.accent
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x0 + 6, y + 0.5)
}

function dashed(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number]) {
  ctx.save()
  ctx.setLineDash([4, 5])
  ctx.lineWidth = 1.5
  ctx.strokeStyle = 'rgba(179, 162, 255, 0.75)'
  ctx.beginPath()
  ctx.moveTo(...a)
  ctx.lineTo(...b)
  ctx.stroke()
  ctx.restore()
}

function guides(ctx: CanvasRenderingContext2D, pose: PoseAt, metric: MetricDefinition, value: number | null, P: Project, scale: number) {
  const p = pose.points
  ctx.save()
  ctx.strokeStyle = C.accent
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  switch (metric.id) {
    case 'kneeToe':
      for (const [side, s] of SIDES) {
        const toe = p[`${side}Toe`]
        const knee = p[`${side}Knee`]
        dashed(ctx, P(toe), P([toe[0], knee[1] + 0.05]))
        ctx.beginPath()
        ctx.moveTo(...P([toe[0], knee[1]]))
        ctx.lineTo(...P(knee))
        ctx.stroke()
        const offset = (s * (toe[0] - knee[0]) * 100) / dist(knee, p[`${side}Ankle`])
        const [x, y] = P([toe[0] + s * 0.035, knee[1]])
        label(ctx, `${offset >= 0 ? '' : '−'}${Math.abs(offset).toFixed(1)}%`, x, y, s > 0 ? 'left' : 'right')
      }
      break
    case 'shoulderEar':
      for (const [side] of SIDES) {
        ctx.beginPath()
        ctx.moveTo(...P(p[`${side}Ear`]))
        ctx.lineTo(...P(p[`${side}Shoulder`]))
        ctx.stroke()
      }
      if (value !== null) {
        const [x, y] = P([p.leftShoulder[0] + 0.05, (p.leftShoulder[1] + p.leftEar[1]) / 2])
        label(ctx, `${value.toFixed(1)}%`, x, y)
      }
      break
    case 'trunkTilt': {
      const hm = mid(p.leftHip, p.rightHip)
      const sm = mid(p.leftShoulder, p.rightShoulder)
      dashed(ctx, P(hm), P([hm[0], hm[1] + 0.36]))
      ctx.beginPath()
      ctx.moveTo(...P(hm))
      ctx.lineTo(...P(sm))
      ctx.stroke()
      const angle = Math.atan2(sm[0] - hm[0], sm[1] - hm[1])
      const [hx, hy] = P(hm)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(hx, hy, 0.16 * scale, -Math.PI / 2, -Math.PI / 2 + angle, angle < 0)
      ctx.stroke()
      if (value !== null) {
        const [x, y] = P([hm[0] + 0.09, hm[1] + 0.2])
        label(ctx, `${value.toFixed(1)}°`, x, y)
      }
      break
    }
    case 'heelLift': {
      if (value === null) break
      const shin = (dist(p.leftKnee, p.leftAnkle) + dist(p.rightKnee, p.rightAnkle)) / 2
      const h = (value / 100) * shin
      const base = (p.leftHeel[1] + p.rightHeel[1]) / 2 - h
      dashed(ctx, P([p.rightHeel[0] - 0.07, base]), P([p.leftHeel[0] + 0.07, base]))
      for (const [side] of SIDES) {
        const heel = p[`${side}Heel`]
        ctx.beginPath()
        ctx.moveTo(...P([heel[0], base]))
        ctx.lineTo(...P(heel))
        ctx.stroke()
      }
      const [x, y] = P([p.leftHeel[0] + 0.08, base + h / 2 + 0.01])
      label(ctx, `${value.toFixed(0)}%`, x, y)
      break
    }
  }
  ctx.restore()
}

function highlight(ctx: CanvasRenderingContext2D, pose: PoseAt, metric: MetricDefinition, P: Project, pulse: number) {
  const p = pose.points
  ctx.save()
  ctx.strokeStyle = C.accent
  ctx.fillStyle = C.accent
  ctx.lineWidth = 6 + pulse * 5
  ctx.lineCap = 'round'
  ctx.shadowColor = C.accent
  ctx.shadowBlur = 14 + pulse * 26
  ctx.beginPath()
  for (const [a, b] of metric.bones) {
    ctx.moveTo(...P(p[a]))
    ctx.lineTo(...P(p[b]))
  }
  ctx.stroke()
  for (const k of metric.joints) {
    ctx.beginPath()
    ctx.arc(...P(p[k]), 5 + pulse * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function PoseStage({ results, main, ghost, metric, guides: showGuides, trails, pulseKey, frameAspect, skeleton: showSkeleton = true }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pulseStart = useRef(0)
  const drawRef = useRef<() => void>(() => {})

  drawRef.current = () => {
    const canvas = canvasRef.current
    if (!canvas || canvas.width === 0) return
    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const w = canvas.width / dpr
    const h = canvas.height / dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const { scale, floorY, cx, P } = fitStage(w, h, frameAspect)
    if (frameAspect) {
      ctx.clearRect(0, 0, w, h)
    } else {
      const bg = ctx.createLinearGradient(0, 0, 0, h)
      bg.addColorStop(0, '#22242a')
      bg.addColorStop(0.78, '#17181c')
      bg.addColorStop(1, '#101114')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)
      const glow = ctx.createRadialGradient(cx, floorY, 1, cx, floorY, scale * 0.3)
      glow.addColorStop(0, 'rgba(255,255,255,0.12)')
      glow.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.ellipse(cx, floorY, scale * 0.3, scale * 0.035, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = C.floor
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(w * 0.06, floorY)
      ctx.lineTo(w * 0.94, floorY)
      ctx.stroke()
    }

    const { fps } = results.session
    const t = clock.get().time

    if (ghost && showSkeleton) {
      const gp = poseAt(results.pose, ghost.timeFor(t), fps)
      if (gp) {
        // Wide, translucent strokes: where the attempts match, the ghost reads as
        // a halo behind the skeleton; where they differ, it separates from it.
        ctx.save()
        ctx.globalAlpha = 0.42
        skeleton(ctx, gp, P, scale, ghost.color === 'a' ? C.a : C.b, 9, false)
        ctx.restore()
      }
    }

    const mt = main.timeFor(t)
    if (trails && showSkeleton) {
      for (let k = TRAIL_STEPS; k >= 1; k--) {
        const tp = poseAt(results.pose, mt - k * TRAIL_DT, fps)
        if (!tp) continue
        ctx.save()
        ctx.globalAlpha = 0.05 + 0.32 * (1 - k / (TRAIL_STEPS + 1)) ** 2
        skeleton(ctx, tp, P, scale, main.color ? C[main.color] : C.accent, 2, false)
        ctx.restore()
      }
    }
    const pose = poseAt(results.pose, mt, fps)
    if (!pose) return
    const low = pose.confidence < 0.5
    const applies = appliesIn(metric, phaseAt(main.attempt, mt)?.id)
    const pulse = Math.max(0, 1 - (performance.now() - pulseStart.current) / 1400)

    ctx.save()
    if (low) {
      ctx.globalAlpha = 0.6
      ctx.setLineDash([7, 6])
    }
    if (showGuides) {
      ctx.globalAlpha *= applies ? 1 : 0.35
      highlight(ctx, pose, metric, P, pulse)
      ctx.globalAlpha = low ? 0.6 : 1
    }
    if (showSkeleton) skeleton(ctx, pose, P, scale, main.color ? C[main.color] : C.bone, frameAspect ? 3 : 4, true)
    ctx.restore()
    if (showGuides && applies) guides(ctx, pose, metric, sampleAt(results.series[metric.id], mt, fps).value, P, scale)
  }

  useLayoutEffect(() => {
    const wrap = wrapRef.current!
    const canvas = canvasRef.current!
    const ro = new ResizeObserver(([entry]) => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(entry.contentRect.width * dpr)
      canvas.height = Math.round(entry.contentRect.height * dpr)
      drawRef.current()
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  useEffect(() => clock.subscribe(() => drawRef.current()), [])
  useEffect(() => drawRef.current())

  // Replay the highlight glow when the companion points at a metric.
  useEffect(() => {
    if (!pulseKey) return
    pulseStart.current = performance.now()
    let raf = requestAnimationFrame(function loop() {
      drawRef.current()
      if (performance.now() - pulseStart.current < 1400) raf = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(raf)
  }, [pulseKey])

  return (
    <div ref={wrapRef} className="stage-canvas">
      <canvas ref={canvasRef} />
    </div>
  )
}

// A small looping skeleton with its own clock, for places outside the review
// workspace (sign-in, processing, thumbnails). It never touches the shared clock.

import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Keypoint, PoseFrame, Seconds } from '../types'
import { poseAt } from '../lib/series'
import { BONES, fitFigure, JOINTS, skeleton } from './PoseStage'

interface Props {
  pose: PoseFrame[]
  fps: number
  from: Seconds
  to: Seconds
  /** 0..1: how much of the figure is drawn, joints first from the floor up. */
  reveal?: number
  /** Draw a single frame at this time instead of looping. */
  still?: Seconds
  color?: string
  speed?: number
  className?: string
  label?: string
  /** Called with the looping time each frame, for things that follow the figure. */
  onTime?: (t: Seconds) => void
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function PoseLoop({ pose, fps, from, to, reveal = 1, still, color = 'rgba(240, 236, 228, 0.95)', speed = 1, className, label, onTime }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef<(t: Seconds) => void>(() => {})
  const revealRef = useRef(reveal)
  revealRef.current = reveal
  const onTimeRef = useRef(onTime)
  onTimeRef.current = onTime

  drawRef.current = (t) => {
    const canvas = canvasRef.current
    if (!canvas || canvas.width === 0) return
    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const w = canvas.width / dpr
    const h = canvas.height / dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const { scale, P, floorY, cx } = fitFigure(w, h)
    const p = poseAt(pose, t, fps)
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx - scale * 0.32, floorY)
    ctx.lineTo(cx + scale * 0.32, floorY)
    ctx.stroke()
    if (!p) return
    const r = revealRef.current
    if (r >= 1) {
      // Joint dots only read well on a large figure; thumbnails get lines alone.
      skeleton(ctx, p, P, scale, color, Math.max(1.6, scale / 120), scale > 180)
      return
    }
    // Assemble from the floor up: a joint appears once the reveal passes its height.
    const order = [...JOINTS, 'nose' as Keypoint].sort((a, b) => p.points[a][1] - p.points[b][1])
    const shown = new Set(order.slice(0, Math.ceil(r * order.length)))
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(2, scale / 160)
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (const [a, b] of BONES) {
      if (!shown.has(a) || !shown.has(b)) continue
      ctx.moveTo(...P(p.points[a]))
      ctx.lineTo(...P(p.points[b]))
    }
    ctx.stroke()
    ctx.fillStyle = color
    for (const k of order) {
      const on = shown.has(k)
      ctx.globalAlpha = on ? 1 : 0.18
      ctx.beginPath()
      ctx.arc(...P(p.points[k]), on ? 3.4 : 2.4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  useLayoutEffect(() => {
    const wrap = wrapRef.current!
    const canvas = canvasRef.current!
    const ro = new ResizeObserver(([entry]) => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(entry.contentRect.width * dpr)
      canvas.height = Math.round(entry.contentRect.height * dpr)
      drawRef.current(still ?? from + (to - from) * 0.55)
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [still, from, to])

  useEffect(() => {
    if (still !== undefined || reducedMotion()) {
      drawRef.current(still ?? from + (to - from) * 0.55)
      return
    }
    let raf = 0
    let visible = true
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting))
    io.observe(wrapRef.current!)
    const t0 = performance.now()
    const loop = (now: number) => {
      if (visible) {
        const t = from + ((((now - t0) / 1000) * speed) % (to - from))
        drawRef.current(t)
        onTimeRef.current?.(t)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
    }
  }, [pose, fps, from, to, still, speed])

  return (
    <div ref={wrapRef} className={`pose-loop ${className ?? ''}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <canvas ref={canvasRef} />
    </div>
  )
}

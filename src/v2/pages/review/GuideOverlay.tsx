// Draws the angle guides (guides.ts) for one frame over the stage, in the picture's pixel space
// (same viewBox and letterboxing as the skeleton). Text keeps a readable screen size at any
// stage size. Lines are the stage accent; depth-dependent guides are dashed.

import { useEffect, useRef, useState, type ReactElement } from 'react'
import { LM, type PoseFrame } from '../../../pose/types'
import { degText, feetText, GUIDE_LABELS, guideReadings, kneeText, reachText, type GuideKey } from './guides'

const LINE = 'var(--stage-accent, #C8F54A)'
const REF = 'var(--bone-2, #A9B3CF)'
const PILL_BG = 'var(--stage-pill, rgba(7,14,36,.78))'
const TEXT = 'var(--bone, #F5F7FB)'
const SEEN = 0.3

type P = { x: number; y: number }

export interface GuideOverlayProps {
  frame: PoseFrame | null | undefined
  keys: readonly GuideKey[]
  arm: { left: number | null; right: number | null }
  /** Source size in pixels (series.width/height). */
  width: number
  height: number
}

export function GuideOverlay({ frame, keys, arm, width: w, height: h }: GuideOverlayProps) {
  const ref = useRef<SVGSVGElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) setScale(Math.min(r.width / w, r.height / h))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [w, h])

  // The svg is always mounted (empty without a pose or guides) so its size stays observed.
  const im = frame?.image ?? null
  const on = new Set(im ? keys : [])
  const g = guideReadings(frame, arm)
  const px = (i: number): P => ({ x: im![i].x * w, y: im![i].y * h })
  const ok = (...idx: number[]) => im !== null && idx.every((i) => im[i] && im[i].visibility >= SEEN)
  const midP = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const font = 12 / scale
  const stroke = { vectorEffect: 'non-scaling-stroke' as const, strokeLinecap: 'round' as const }
  const items: ReactElement[] = []

  const label = (key: string, at: P, text: string, dx = 10, dy = 0) => {
    const pad = 4 / scale
    const tw = text.length * font * 0.56
    const x = Math.min(Math.max(at.x + dx / scale, 2 / scale), w - tw - 2 * pad - 2 / scale)
    const y = Math.min(Math.max(at.y + dy / scale, font), h - pad)
    items.push(
      <g key={`l-${key}`}>
        <rect x={x} y={y - font} width={tw + 2 * pad} height={font + 2 * pad} rx={4 / scale} fill={PILL_BG} />
        <text x={x + pad} y={y + pad * 0.2} fontSize={font} fill={TEXT} fontFamily="Geist, system-ui, sans-serif" fontWeight={500}>
          {text}
        </text>
      </g>,
    )
  }
  const line = (key: string, a: P, b: P, color = LINE, dash?: string, width = 2) =>
    items.push(<line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={width} strokeDasharray={dash} {...stroke} />)

  const trunkSeen = ok(LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip)
  const sm = trunkSeen ? midP(px(LM.leftShoulder), px(LM.rightShoulder)) : null
  const hm = trunkSeen ? midP(px(LM.leftHip), px(LM.rightHip)) : null

  if (on.has('trunk') && sm && hm && g.trunk !== null) {
    const len = Math.hypot(sm.x - hm.x, sm.y - hm.y)
    line('trunk-ref', hm, { x: hm.x, y: hm.y - len }, REF, '4 4', 1.5)
    label('trunk', sm, `${GUIDE_LABELS.trunk} ${degText(g.trunk)}`, 14, 4)
  }
  if (on.has('head') && sm && hm && ok(LM.leftEar, LM.rightEar) && g.head !== null) {
    const em = midP(px(LM.leftEar), px(LM.rightEar))
    const t = { x: sm.x - hm.x, y: sm.y - hm.y }
    const tl = Math.hypot(t.x, t.y) || 1
    const hl = Math.hypot(em.x - sm.x, em.y - sm.y)
    line('head-ref', sm, { x: sm.x + (t.x / tl) * hl * 1.2, y: sm.y + (t.y / tl) * hl * 1.2 }, REF, '4 4', 1.5)
    line('head', sm, em)
    label('head', em, `${GUIDE_LABELS.head} ${degText(g.head)}`, 16, -6)
  }
  if (on.has('knees')) {
    for (const s of ['left', 'right'] as const) {
      const v = g.knees[s]
      const [knee, ankle, heel, toe] = s === 'left' ? [LM.leftKnee, LM.leftAnkle, LM.leftHeel, LM.leftFootIndex] : [LM.rightKnee, LM.rightAnkle, LM.rightHeel, LM.rightFootIndex]
      if (v === null || !ok(knee, ankle, heel, toe)) continue
      const hp = px(heel)
      const tp = px(toe)
      line(`knee-foot-${s}`, hp, { x: tp.x + (tp.x - hp.x) * 0.8, y: tp.y + (tp.y - hp.y) * 0.8 }, REF, '4 4', 1.5)
      line(`knee-shin-${s}`, px(ankle), px(knee), LINE, '6 4')
      label(`knee-${s}`, px(knee), kneeText(v), s === 'left' ? 12 : -12 - kneeText(v).length * 7, 0)
    }
  }
  if (on.has('arms') && sm) {
    for (const s of ['left', 'right'] as const) {
      const v = g.arms[s]
      const wr = s === 'left' ? LM.leftWrist : LM.rightWrist
      if (v === null || !ok(wr)) continue
      line(`arm-${s}`, sm, px(wr), LINE, '1 5', 2.5)
      label(`arm-${s}`, px(wr), reachText(v), 10, -10)
    }
  }
  if (on.has('feet') && g.feet !== null && ok(LM.leftHeel, LM.leftFootIndex, LM.rightHeel, LM.rightFootIndex)) {
    const ends: P[] = []
    for (const [heel, toe] of [
      [LM.leftHeel, LM.leftFootIndex],
      [LM.rightHeel, LM.rightFootIndex],
    ] as const) {
      const hp = px(heel)
      const tp = px(toe)
      const e = { x: tp.x + (tp.x - hp.x) * 1.5, y: tp.y + (tp.y - hp.y) * 1.5 }
      line(`feet-${heel}`, hp, e, LINE, '6 4')
      ends.push(hp)
    }
    const below = { x: (ends[0].x + ends[1].x) / 2, y: Math.max(ends[0].y, ends[1].y) }
    label('feet', below, `Feet ${feetText(g.feet)}`, -40, 26)
  }

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      data-guides={keys.join(' ')}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      {items}
    </svg>
  )
}

/** Accessible summary of the guides on screen (read by the stage's live region when paused). */
export function guideSummary(frame: PoseFrame | null | undefined, keys: readonly GuideKey[], arm: { left: number | null; right: number | null }): string {
  const g = guideReadings(frame, arm)
  const parts: string[] = []
  for (const k of keys) {
    if (k === 'trunk' && g.trunk !== null) parts.push(`torso lean ${degText(g.trunk)}`)
    if (k === 'head' && g.head !== null) parts.push(`head ${degText(g.head)}`)
    if (k === 'knees') for (const s of ['left', 'right'] as const) if (g.knees[s] !== null) parts.push(`${s} knee ${kneeText(g.knees[s]!)}`)
    if (k === 'arms') for (const s of ['left', 'right'] as const) if (g.arms[s] !== null) parts.push(`${s} arm reach ${reachText(g.arms[s]!)}`)
    if (k === 'feet' && g.feet !== null) parts.push(`feet ${feetText(g.feet)}`)
  }
  return parts.join(', ')
}

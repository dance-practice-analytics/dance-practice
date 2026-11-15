// Draws one frame of a synthetic "camera" clip from a pose track: a dancer in a
// studio, filmed from the front in portrait. Used only to generate the test clips
// in public/clips (scripts/make-test-clips.mjs). It is not real footage and is
// watermarked as such; the burned-in timecode makes sync problems easy to see.

import type { Keypoint, PoseFrame, Point } from '../types'
import { fitFigure } from '../components/PoseStage'

type Pts = Record<Keypoint, Point>

/** The dancer is always visible on camera, even where the pose model lost them: fill gaps and smooth jitter. */
export function cameraPoses(pose: PoseFrame[], window = 3): Pts[] {
  const valid = pose.map((f, i) => (f.points ? i : -1)).filter((i) => i >= 0)
  const filled: Pts[] = pose.map((f, i) => {
    if (f.points) return f.points
    const prev = [...valid].reverse().find((v) => v < i) ?? valid[0]
    const next = valid.find((v) => v > i) ?? prev
    const a = pose[prev].points!
    const b = pose[next].points!
    const k = next === prev ? 0 : (i - prev) / (next - prev)
    return Object.fromEntries(Object.keys(a).map((key) => {
      const pa = a[key as Keypoint]
      const pb = b[key as Keypoint]
      return [key, [pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k]]
    })) as Pts
  })
  return filled.map((_, i) => {
    const lo = Math.max(0, i - window)
    const hi = Math.min(filled.length - 1, i + window)
    const out = {} as Pts
    for (const key of Object.keys(filled[i]) as Keypoint[]) {
      let x = 0
      let y = 0
      for (let j = lo; j <= hi; j++) {
        x += filled[j][key][0]
        y += filled[j][key][1]
      }
      out[key] = [x / (hi - lo + 1), y / (hi - lo + 1)]
    }
    return out
  })
}

const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

function limb(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number], wa: number, wb: number, fill: string) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(a[0] + nx * wa, a[1] + ny * wa)
  ctx.lineTo(b[0] + nx * wb, b[1] + ny * wb)
  ctx.arc(b[0], b[1], wb, Math.atan2(ny, nx), Math.atan2(ny, nx) + Math.PI)
  ctx.lineTo(a[0] - nx * wa, a[1] - ny * wa)
  ctx.arc(a[0], a[1], wa, Math.atan2(-ny, -nx), Math.atan2(-ny, -nx) + Math.PI)
  ctx.closePath()
  ctx.fill()
}

function studio(ctx: CanvasRenderingContext2D, w: number, h: number, floorY: number) {
  const seam = floorY - h * 0.2
  const wall = ctx.createLinearGradient(0, 0, 0, seam)
  wall.addColorStop(0, '#5b5650')
  wall.addColorStop(1, '#8a837a')
  ctx.fillStyle = wall
  ctx.fillRect(0, 0, w, seam)
  // Window light falling on the wall.
  const light = ctx.createRadialGradient(w * 0.78, seam * 0.35, 10, w * 0.78, seam * 0.35, w * 0.6)
  light.addColorStop(0, 'rgba(255, 244, 222, 0.35)')
  light.addColorStop(1, 'rgba(255, 244, 222, 0)')
  ctx.fillStyle = light
  ctx.fillRect(0, 0, w, seam)
  // Barre and brackets.
  const barY = seam - h * 0.17
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'
  ctx.fillRect(0, barY + 6, w, 4)
  ctx.fillStyle = '#c9b48f'
  ctx.fillRect(0, barY, w, 7)
  ctx.fillStyle = '#4a4540'
  for (const x of [w * 0.12, w * 0.5, w * 0.88]) ctx.fillRect(x - 3, barY + 7, 6, h * 0.05)
  // Wooden floor in perspective.
  const floor = ctx.createLinearGradient(0, seam, 0, h)
  floor.addColorStop(0, '#6f5640')
  floor.addColorStop(1, '#3d2e22')
  ctx.fillStyle = floor
  ctx.fillRect(0, seam, w, h - seam)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)'
  ctx.lineWidth = 1
  for (let i = -8; i <= 8; i++) {
    ctx.beginPath()
    ctx.moveTo(w / 2 + i * w * 0.07, seam)
    ctx.lineTo(w / 2 + i * w * 0.32, h)
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
  ctx.fillRect(0, seam, w, 3)
}

const SKIN = '#c99a7c'
const SKIN_SHADE = '#b5866a'
const LEOTARD = '#262a3a'
const TIGHTS = '#e2c4b6'
const SHOE = '#e9b7a6'
const HAIR = '#2b1d16'

/** Draw frame `i` of the clip into a w x h canvas (portrait). */
export function drawFootageFrame(ctx: CanvasRenderingContext2D, w: number, h: number, p: Pts, t: number, frame: number) {
  const { scale, floorY, P } = fitFigure(w, h)
  studio(ctx, w, h, floorY)

  // Contact shadow under the feet.
  const feet = mid(p.leftToe, p.rightToe)
  const [sx] = P(feet)
  const shadow = ctx.createRadialGradient(sx, floorY, 2, sx, floorY, scale * 0.22)
  shadow.addColorStop(0, 'rgba(0, 0, 0, 0.45)')
  shadow.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = shadow
  ctx.beginPath()
  ctx.ellipse(sx, floorY + 2, scale * 0.22, scale * 0.03, 0, 0, Math.PI * 2)
  ctx.fill()

  const u = scale // pixels per body height
  // Legs: tights, tapered from thigh to ankle, then the shoe.
  for (const s of ['left', 'right'] as const) {
    limb(ctx, P(p[`${s}Hip`]), P(p[`${s}Knee`]), u * 0.042, u * 0.03, TIGHTS)
    limb(ctx, P(p[`${s}Knee`]), P(p[`${s}Ankle`]), u * 0.03, u * 0.019, TIGHTS)
    limb(ctx, P(p[`${s}Heel`]), P(p[`${s}Toe`]), u * 0.016, u * 0.012, SHOE)
    limb(ctx, P(p[`${s}Ankle`]), P(p[`${s}Toe`]), u * 0.018, u * 0.012, SHOE)
  }
  // Torso: leotard from shoulders to hips.
  const ls = P(p.leftShoulder)
  const rs = P(p.rightShoulder)
  const lh = P(p.leftHip)
  const rh = P(p.rightHip)
  const out = u * 0.018
  const sign = ls[0] > rs[0] ? 1 : -1
  ctx.fillStyle = LEOTARD
  ctx.beginPath()
  ctx.moveTo(ls[0] + sign * out, ls[1])
  ctx.quadraticCurveTo((ls[0] + lh[0]) / 2 + sign * out * 0.2, (ls[1] + lh[1]) / 2, lh[0] + sign * out * 1.6, lh[1] + u * 0.02)
  ctx.lineTo(rh[0] - sign * out * 1.6, rh[1] + u * 0.02)
  ctx.quadraticCurveTo((rs[0] + rh[0]) / 2 - sign * out * 0.2, (rs[1] + rh[1]) / 2, rs[0] - sign * out, rs[1])
  ctx.closePath()
  ctx.fill()
  // Neck and head.
  const neckBase = mid(p.leftShoulder, p.rightShoulder)
  const headC: Point = [(p.leftEar[0] + p.rightEar[0]) / 2, (p.leftEar[1] + p.rightEar[1]) / 2 + 0.012]
  limb(ctx, P(neckBase), P([headC[0], headC[1] - 0.04]), u * 0.017, u * 0.015, SKIN_SHADE)
  const hc = P(headC)
  ctx.fillStyle = SKIN
  ctx.beginPath()
  ctx.ellipse(hc[0], hc[1], u * 0.042, u * 0.052, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = HAIR
  ctx.beginPath()
  ctx.ellipse(hc[0], hc[1] - u * 0.018, u * 0.045, u * 0.038, 0, Math.PI, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(hc[0], hc[1] - u * 0.062, u * 0.022, 0, Math.PI * 2)
  ctx.fill()
  // Arms over everything else, as in a front view with arms raised.
  for (const s of ['left', 'right'] as const) {
    limb(ctx, P(p[`${s}Shoulder`]), P(p[`${s}Elbow`]), u * 0.021, u * 0.016, SKIN)
    limb(ctx, P(p[`${s}Elbow`]), P(p[`${s}Wrist`]), u * 0.016, u * 0.012, SKIN)
  }

  // Vignette.
  const vig = ctx.createRadialGradient(w / 2, h * 0.48, h * 0.25, w / 2, h * 0.5, h * 0.75)
  vig.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vig.addColorStop(1, 'rgba(0, 0, 0, 0.45)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, w, h)

  // Burned-in labels: what this is, and where we are in it.
  const m = Math.round(w * 0.035)
  ctx.font = `600 ${Math.round(w * 0.026)}px system-ui, sans-serif`
  ctx.textBaseline = 'top'
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
  ctx.fillRect(m - 6, m - 5, ctx.measureText('SYNTHETIC TEST CLIP').width + 12, Math.round(w * 0.026) + 10)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.fillText('SYNTHETIC TEST CLIP', m, m)
  const tc = `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}  f${String(frame).padStart(4, '0')}`
  ctx.font = `500 ${Math.round(w * 0.028)}px ui-monospace, Consolas, monospace`
  ctx.textBaseline = 'bottom'
  const tw = ctx.measureText(tc).width
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
  ctx.fillRect(w - m - tw - 6, h - m - Math.round(w * 0.028) - 6, tw + 12, Math.round(w * 0.028) + 10)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.fillText(tc, w - m - tw, h - m)
}

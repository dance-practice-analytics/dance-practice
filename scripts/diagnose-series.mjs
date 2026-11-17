// Prints the signals behind the phase detector and the trunk metric for one stored
// series (output of analyze-clips.mjs), sampled over time. Numbers only, no frames.
//
//   node scripts/diagnose-series.mjs <file.series.json.gz> [stepSeconds]

import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const [file, stepArg] = process.argv.slice(2)
const step = Number(stepArg ?? 0.25)
const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } })
try {
  const { decodeSeries } = await server.ssrLoadModule('/src/pose/codec.ts')
  const { segmentPhases } = await server.ssrLoadModule('/src/metrics/phases.ts')
  const { LM } = await server.ssrLoadModule('/src/pose/types.ts')
  const series = await decodeSeries(new Blob([readFileSync(file)]))
  const seg = segmentPhases(series, 'releve_balance')
  const deg = (r) => (r * 180) / Math.PI
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 })
  console.log(`support=${seg.support} leg=${seg.legLength?.toFixed(3)} lifts=${seg.lifts} reason=${seg.reason}`)
  console.log('segments:', seg.segments.map((s) => `${s.phase}[${series.frames[s.i0]?.t.toFixed(2)}-${series.frames[Math.min(s.i1, series.frames.length) - 1]?.t.toFixed(2)}]`).join(' '))
  console.log('  t     lift  trunk3D trunkImg  hipY(img) heelL heelR toeL toeR  visAvg')
  let next = 0
  series.frames.forEach((f, i) => {
    if (f.t < next) return
    next += step
    const w = f.world
    const im = f.image
    let t3 = '', ti = '', hy = '', hl = '', hr = '', tl = '', tr = '', va = ''
    if (w) {
      const sh = mid(w[LM.leftShoulder], w[LM.rightShoulder])
      const hp = mid(w[LM.leftHip], w[LM.rightHip])
      const v = { x: sh.x - hp.x, y: sh.y - hp.y, z: sh.z - hp.z }
      t3 = deg(Math.acos(Math.min(1, Math.abs(v.y) / Math.hypot(v.x, v.y, v.z)))).toFixed(1)
    }
    if (im) {
      const sh = mid(im[LM.leftShoulder], im[LM.rightShoulder])
      const hp = mid(im[LM.leftHip], im[LM.rightHip])
      const ar = series.width / series.height
      ti = deg(Math.atan2(Math.abs((sh.x - hp.x) * ar), Math.abs(sh.y - hp.y))).toFixed(1)
      hy = hp.y.toFixed(3)
      hl = im[LM.leftHeel].y.toFixed(3); hr = im[LM.rightHeel].y.toFixed(3)
      tl = im[LM.leftFootIndex].y.toFixed(3); tr = im[LM.rightFootIndex].y.toFixed(3)
      va = (im.reduce((s, l) => s + (l.visibility ?? 0), 0) / im.length).toFixed(2)
    }
    const lift = seg.lift[i]
    console.log(`${f.t.toFixed(2).padStart(6)} ${lift == null ? '   - ' : lift.toFixed(3).padStart(6)} ${t3.padStart(7)} ${ti.padStart(8)}  ${hy.padStart(8)} ${hl} ${hr} ${tl} ${tr}  ${va}`)
  })
} finally {
  await server.close()
}

import { describe, expect, it } from 'vitest'
import { decodeSeries, encodeSeries, KEYPOINTS_FORMAT, PRECISION } from './codec'
import { clampFps, DEFAULT_TARGET_FPS, planFrames, toPoseFrame } from './frames'
import { OneEuroFilter, smoothSeries } from './oneEuro'
import { LANDMARK_COUNT, type Landmark, type PoseFrame, type PoseSeries } from './types'

// Everything here is synthetic: seeded numbers, no footage.

const FPS = 30

/** Small seeded PRNG (mulberry32) so runs repeat. */
function rng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rms = (values: number[]) => Math.sqrt(values.reduce((s, v) => s + v * v, 0) / values.length)

function landmarks(value: (i: number) => number, visibility = 0.9): Landmark[] {
  return Array.from({ length: LANDMARK_COUNT }, (_, i) => ({
    x: value(i),
    y: value(i) + 0.1,
    z: value(i) - 0.1,
    visibility,
  }))
}

/** A slow sway plus jitter; `gaps` are frame indices with no detected pose. */
function syntheticSeries(frameCount: number, gaps: number[] = [], seed = 7): PoseSeries {
  const random = rng(seed)
  const frames: PoseFrame[] = Array.from({ length: frameCount }, (_, f) => {
    const t = f / FPS
    if (gaps.includes(f)) return { t, image: null, world: null }
    const sway = 0.05 * Math.sin(2 * Math.PI * 0.3 * t)
    return {
      t,
      image: landmarks((i) => 0.3 + i * 0.01 + sway + (random() - 0.5) * 0.004, 0.5 + random() * 0.5),
      world: landmarks((i) => -0.4 + i * 0.02 + sway + (random() - 0.5) * 0.01, 0.5 + random() * 0.5),
    }
  })
  return {
    fps: FPS,
    durationS: frameCount / FPS,
    width: 1920,
    height: 1080,
    model: 'pose_landmarker_full',
    smoothed: false,
    frames,
  }
}

describe('OneEuroFilter', () => {
  it('keeps a constant signal constant', () => {
    const filter = new OneEuroFilter()
    for (let f = 0; f < 90; f++) expect(filter.filter(0.42, f / FPS)).toBeCloseTo(0.42, 12)
  })

  it('reduces noise on a slow signal', () => {
    const random = rng(1)
    const filter = new OneEuroFilter()
    const rawError: number[] = []
    const filteredError: number[] = []
    for (let f = 0; f < 600; f++) {
      const t = f / FPS
      const truth = 0.5 + 0.02 * Math.sin(2 * Math.PI * 0.1 * t)
      const noisy = truth + (random() - 0.5) * 0.02
      const out = filter.filter(noisy, t)
      if (f >= 30) {
        rawError.push(noisy - truth)
        filteredError.push(out - truth)
      }
    }
    expect(rms(filteredError)).toBeLessThan(rms(rawError) * 0.6)
  })

  it('follows a step with limited lag', () => {
    const filter = new OneEuroFilter()
    for (let f = 0; f < 30; f++) filter.filter(0, f / FPS)
    const out: number[] = []
    for (let f = 30; f < 60; f++) out.push(filter.filter(1, f / FPS))
    // With the SDD constants the filter is close to a 1 Hz low-pass:
    // 90% of the step within 0.5 s, 99% within 1 s, and no overshoot.
    expect(out[14]).toBeGreaterThan(0.9)
    expect(out[29]).toBeGreaterThan(0.99)
    expect(Math.max(...out)).toBeLessThanOrEqual(1)
  })

  it('lags less when beta is higher', () => {
    const slow = new OneEuroFilter({ beta: 0 })
    const fast = new OneEuroFilter({ beta: 5 })
    slow.filter(0, 0)
    fast.filter(0, 0)
    let a = 0
    let b = 0
    for (let f = 1; f <= 5; f++) {
      a = slow.filter(1, f / FPS)
      b = fast.filter(1, f / FPS)
    }
    expect(b).toBeGreaterThan(a)
  })

  it('passes the first sample after a reset through unchanged', () => {
    const filter = new OneEuroFilter()
    for (let f = 0; f < 10; f++) filter.filter(0, f / FPS)
    filter.reset()
    expect(filter.filter(5, 11 / FPS)).toBe(5)
  })
})

describe('smoothSeries', () => {
  it('keeps gaps null, resets across them and leaves visibility and the input alone', () => {
    const gaps = [20, 21, 22]
    const series = syntheticSeries(60, gaps)
    const snapshot = JSON.stringify(series)
    const smoothed = smoothSeries(series)

    expect(smoothed.smoothed).toBe(true)
    expect(JSON.stringify(series)).toBe(snapshot)
    expect(smoothed.frames).toHaveLength(series.frames.length)
    for (const f of gaps) {
      expect(smoothed.frames[f].image).toBeNull()
      expect(smoothed.frames[f].world).toBeNull()
    }
    // The first frame of the clip and the first frame after the gap carry no history.
    for (const f of [0, 23]) {
      expect(smoothed.frames[f].image).toEqual(series.frames[f].image)
      expect(smoothed.frames[f].world).toEqual(series.frames[f].world)
    }
    // Later frames are actually filtered, and visibility never changes.
    expect(smoothed.frames[10].image![5].x).not.toBe(series.frames[10].image![5].x)
    expect(smoothed.frames[30].world![5].z).not.toBe(series.frames[30].world![5].z)
    smoothed.frames.forEach((frame, f) => {
      frame.image?.forEach((lm, i) => expect(lm.visibility).toBe(series.frames[f].image![i].visibility))
      frame.world?.forEach((lm, i) => expect(lm.visibility).toBe(series.frames[f].world![i].visibility))
    })
  })

  it('reduces frame-to-frame jitter', () => {
    const series = syntheticSeries(300)
    const smoothed = smoothSeries(series)
    const jitter = (s: PoseSeries) =>
      rms(s.frames.slice(1).map((frame, f) => frame.world![12].x - s.frames[f].world![12].x))
    // The slow sway itself stays, so the frame-to-frame change cannot drop to zero.
    expect(jitter(smoothed)).toBeLessThan(jitter(series) * 0.7)
  })

  it('does not filter a series twice', () => {
    const smoothed = smoothSeries(syntheticSeries(30))
    expect(smoothSeries(smoothed)).toBe(smoothed)
  })
})

describe('frame planning', () => {
  it('samples a 10 s clip at 30 fps into 300 frames with increasing timestamps', () => {
    const plan = planFrames(10)
    expect(plan.fps).toBe(DEFAULT_TARGET_FPS)
    expect(plan.frames).toHaveLength(300)
    expect(plan.frames[0]).toEqual({ t: 0, seekS: 0.5 / 30, timestampMs: 0 })
    plan.frames.slice(1).forEach((frame, i) => {
      expect(frame.timestampMs).toBeGreaterThan(plan.frames[i].timestampMs)
      expect(Number.isInteger(frame.timestampMs)).toBe(true)
      expect(frame.seekS).toBeGreaterThan(frame.t)
      expect(frame.seekS).toBeLessThan(10)
    })
  })

  it('caps the rate at 30 fps, accepts lower rates and offsets timestamps', () => {
    expect(clampFps(60)).toBe(30)
    expect(clampFps(undefined)).toBe(30)
    const plan = planFrames(2, 15, 5000)
    expect(plan.fps).toBe(15)
    expect(plan.frames).toHaveLength(30)
    expect(plan.frames[0].timestampMs).toBe(5000)
    expect(plan.frames[29].t).toBeCloseTo(29 / 15, 12)
  })

  it('gives a very short clip one frame inside the clip', () => {
    const plan = planFrames(0.01)
    expect(plan.frames).toHaveLength(1)
    expect(plan.frames[0].seekS).toBeLessThan(0.01)
  })

  it('rejects unusable durations and rates', () => {
    expect(() => planFrames(Infinity)).toThrow(RangeError)
    expect(() => planFrames(Number.NaN)).toThrow(RangeError)
    expect(() => planFrames(0)).toThrow(RangeError)
    expect(() => planFrames(5, 0)).toThrow(RangeError)
  })
})

describe('toPoseFrame', () => {
  const raw = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ x: i, y: i + 1, z: i + 2, visibility: 0.8, presence: 0.7 }))

  it('copies the first pose and keeps only the contract fields', () => {
    const frame = toPoseFrame(1.5, { landmarks: [raw(33), raw(33)], worldLandmarks: [raw(33), raw(33)] })
    expect(frame.t).toBe(1.5)
    expect(frame.image).toHaveLength(LANDMARK_COUNT)
    expect(frame.world).toHaveLength(LANDMARK_COUNT)
    expect(frame.image![3]).toEqual({ x: 3, y: 4, z: 5, visibility: 0.8 })
  })

  it('stores a gap when no pose is found', () => {
    expect(toPoseFrame(2, { landmarks: [], worldLandmarks: [] })).toEqual({ t: 2, image: null, world: null })
  })

  it('stores a gap when a pose is incomplete', () => {
    const frame = toPoseFrame(2, { landmarks: [raw(33)], worldLandmarks: [raw(20)] })
    expect(frame).toEqual({ t: 2, image: null, world: null })
  })

  it('treats a missing visibility as 0', () => {
    const bare = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }))
    const frame = toPoseFrame(0, { landmarks: [bare], worldLandmarks: [bare] })
    expect(frame.image![0].visibility).toBe(0)
  })
})

describe('keypoints codec', () => {
  const gzip = async (text: string) =>
    new Blob([await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()])
  const gunzip = async (blob: Blob) =>
    JSON.parse(await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text())

  it('round-trips a series, including gaps, within the rounding tolerance', async () => {
    const series = syntheticSeries(90, [0, 40, 41, 89])
    const decoded = await decodeSeries(await encodeSeries(series))

    const { frames, ...header } = series
    const { frames: decodedFrames, ...decodedHeader } = decoded
    expect(decodedHeader).toEqual(header)
    expect(decodedFrames).toHaveLength(frames.length)

    const near = (a: number, b: number, step: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(step / 2 + 1e-9)
    frames.forEach((frame, f) => {
      const out = decodedFrames[f]
      near(out.t, frame.t, PRECISION.time)
      for (const key of ['image', 'world'] as const) {
        if (frame[key] === null) {
          expect(out[key]).toBeNull()
          continue
        }
        expect(out[key]).toHaveLength(LANDMARK_COUNT)
        frame[key].forEach((lm, i) => {
          const got = out[key]![i]
          near(got.x, lm.x, PRECISION[key])
          near(got.y, lm.y, PRECISION[key])
          near(got.z, lm.z, PRECISION[key])
          near(got.visibility, lm.visibility, PRECISION.visibility)
        })
      }
    })
  })

  it('is stable: decoding and encoding again gives the same values', async () => {
    const once = await decodeSeries(await encodeSeries(syntheticSeries(40, [5])))
    const twice = await decodeSeries(await encodeSeries(once))
    expect(twice).toEqual(once)
  })

  it('writes gzip with the documented header', async () => {
    const blob = await encodeSeries(syntheticSeries(10, [3]))
    expect(blob.type).toBe('application/gzip')
    const magic = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
    expect([...magic]).toEqual([0x1f, 0x8b])
    const file = await gunzip(blob)
    expect(file.format).toBe(KEYPOINTS_FORMAT)
    expect(file.version).toBe(1)
    expect(file.image[3]).toBeNull()
    expect(file.image[0]).toHaveLength(LANDMARK_COUNT * 4)
  })

  it('keeps one minute of smoothed keypoints under 1 MB (NFR-10)', async () => {
    const blob = await encodeSeries(smoothSeries(syntheticSeries(60 * FPS)))
    expect(blob.size).toBeLessThan(1024 * 1024)
  })

  it('refuses to encode non-finite values', async () => {
    const series = syntheticSeries(3)
    series.frames[1].world![0].x = Number.NaN
    await expect(encodeSeries(series)).rejects.toThrow(/non-finite/)
  })

  it('rejects malformed files with a clear error', async () => {
    await expect(decodeSeries(new Blob(['plain text']))).rejects.toThrow(/Invalid keypoints file: it is not gzip/)
    await expect(decodeSeries(await gzip('not json'))).rejects.toThrow(/does not contain JSON/)
    await expect(decodeSeries(await gzip('[1,2]'))).rejects.toThrow(/not a JSON object/)
    await expect(decodeSeries(await gzip('{"format":"other"}'))).rejects.toThrow(/unknown format/)

    const good = await gunzip(await encodeSeries(syntheticSeries(4)))
    const broken = (patch: object) => gzip(JSON.stringify({ ...good, ...patch }))
    await expect(decodeSeries(await broken({ version: 99 }))).rejects.toThrow(/unsupported version/)
    await expect(decodeSeries(await broken({ fps: 0 }))).rejects.toThrow(/"fps"/)
    await expect(decodeSeries(await broken({ smoothed: 'yes' }))).rejects.toThrow(/"smoothed"/)
    await expect(decodeSeries(await broken({ world: good.world.slice(1) }))).rejects.toThrow(/"world" has 3 frames/)
    await expect(decodeSeries(await broken({ image: [[1, 2, 3], null, null, null] }))).rejects.toThrow(
      /"image" frame 0/,
    )
    await expect(
      decodeSeries(await broken({ image: [good.image[0].map(() => 0.5), null, null, null] })),
    ).rejects.toThrow(/not an integer/)
  })
})

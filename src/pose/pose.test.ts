import { describe, expect, it } from 'vitest'
import { decodeSeries, encodeSeries, KEYPOINTS_FORMAT, PRECISION } from './codec'
import { clampFps, DEFAULT_TARGET_FPS, MIN_TRIM_S, normalizeTrim, planFrames, SEEK_OFFSET_S, toPoseFrame, trimProblem } from './frames'
import { ONE_EURO_DEFAULTS, ONE_EURO_WORLD, OneEuroFilter, smoothSeries } from './oneEuro'
import { looksSwapped, unswapLeftRight } from './swaps'
import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame, type PoseSeries } from './types'

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
    expect(plan.frames[0]).toEqual({ t: 0, seekS: SEEK_OFFSET_S, timestampMs: 0 })
    plan.frames.slice(1).forEach((frame, i) => {
      expect(frame.timestampMs).toBeGreaterThan(plan.frames[i].timestampMs)
      expect(Number.isInteger(frame.timestampMs)).toBe(true)
      expect(frame.seekS).toBeGreaterThan(frame.t)
      expect(frame.seekS).toBeLessThan(10)
    })
  })

  it('seeks just after the start of each frame, never at its middle or end', () => {
    // Chrome showed the next frame for 1 in 30 mid-frame seeks and the previous frame for
    // 31% of seeks exactly on the frame start (see SEEK_OFFSET_S).
    expect(SEEK_OFFSET_S).toBeGreaterThanOrEqual(0.001) // clears millisecond timestamp rounding
    for (const fps of [30, 15, 10]) {
      const plan = planFrames(39, fps)
      for (const frame of plan.frames) {
        const into = frame.seekS - frame.t
        expect(into).toBeCloseTo(SEEK_OFFSET_S, 9)
        // Inside the first quarter of a frame even for a 120 fps source clip.
        expect(into).toBeLessThan(0.25 / 120)
        // Float error never pushes the target out of its own sampling interval.
        expect(Math.floor(frame.seekS * fps)).toBe(Math.round(frame.t * fps))
      }
    }
  })

  it('keeps the planned sample on the frame grid of a 30 fps clip', () => {
    const plan = planFrames(39.0333)
    expect(plan.frames).toHaveLength(1170)
    plan.frames.forEach((frame, i) => {
      expect(frame.t).toBe(i / 30)
      // The frame of a 30 fps clip that contains the seek target is frame i.
      expect(Math.floor(frame.seekS * 30)).toBe(i)
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

describe('frame planning with a trim (FR-3.2.7)', () => {
  it('plans only the samples inside [start, end), on the grid of the whole clip', () => {
    const full = planFrames(10)
    const plan = planFrames(10, undefined, 0, { startS: 2, endS: 5 })
    expect(plan.frames).toHaveLength(90)
    expect(plan.frames[0].t).toBe(2)
    expect(plan.frames[89].t).toBeCloseTo(149 / 30, 12)
    // Same instants, seek targets and timestamps as the untrimmed plan: times stay
    // those of the original clip, so Review lines the keypoints up with the whole video.
    expect(plan.frames).toEqual(full.frames.slice(60, 150))
  })

  it('starts at the first sample at or after an off-grid start and stops before the end', () => {
    const plan = planFrames(10, 30, 0, { startS: 1.01, endS: 3.5 })
    expect(plan.frames[0].t).toBeCloseTo(31 / 30, 12)
    expect(plan.frames.at(-1)!.t).toBeLessThan(3.5)
    expect(plan.frames.at(-1)!.t).toBeCloseTo(104 / 30, 12)
    plan.frames.slice(1).forEach((f, i) => expect(f.timestampMs).toBeGreaterThan(plan.frames[i].timestampMs))
  })

  it('keeps the base timestamp offset and lower rates', () => {
    const plan = planFrames(4, 15, 5000, { startS: 1, endS: 3 })
    expect(plan.frames).toHaveLength(30)
    expect(plan.frames[0]).toEqual({ t: 1, seekS: 1 + SEEK_OFFSET_S, timestampMs: 6000 })
  })

  it('treats no range, or a range over the whole clip, as no trim', () => {
    expect(planFrames(10, undefined, 0, null).frames).toHaveLength(300)
    expect(planFrames(10, undefined, 0, { startS: 0, endS: 10 }).frames).toHaveLength(300)
    expect(normalizeTrim({ startS: 0, endS: 10 }, 10)).toBeNull()
    expect(normalizeTrim(undefined, 10)).toBeNull()
  })

  it('accepts an end a little past what the decoder reports as "to the end"', () => {
    expect(normalizeTrim({ startS: 1, endS: 8.2 }, 8.13)).toEqual({ startS: 1, endS: 8.13 })
  })

  it('rejects ranges outside the clip, reversed or shorter than the minimum', () => {
    expect(trimProblem({ startS: -0.5, endS: 4 }, 10)).toMatch(/before the beginning/)
    expect(trimProblem({ startS: 1, endS: 12 }, 10)).toMatch(/after the end/)
    expect(trimProblem({ startS: 5, endS: 5 }, 10)).toMatch(/after the start/)
    expect(trimProblem({ startS: 5, endS: 5 + MIN_TRIM_S - 0.1 }, 10)).toMatch(/at least/)
    expect(trimProblem({ startS: Number.NaN, endS: 4 }, 10)).toMatch(/seconds/)
    expect(trimProblem({ startS: 1, endS: 4 }, 10)).toBeNull()
    expect(() => planFrames(10, undefined, 0, { startS: 6, endS: 2 })).toThrow(RangeError)
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

  it('keeps the trim of a trimmed series and reads files without one as the whole clip', async () => {
    const base = syntheticSeries(30)
    const trimmed: PoseSeries = { ...base, durationS: 4, trim: { startS: 1, endS: 2 }, frames: base.frames.map((f) => ({ ...f, t: f.t + 1 })) }
    const decoded = await decodeSeries(await encodeSeries(trimmed))
    expect(decoded.trim).toEqual({ startS: 1, endS: 2 })
    expect(decoded.durationS).toBe(4)
    expect(decoded.frames[0].t).toBeCloseTo(1, 4)
    expect((await decodeSeries(await encodeSeries(base))).trim).toBeUndefined()
    const file = await gunzip(await encodeSeries(trimmed))
    await expect(decodeSeries(await gzip(JSON.stringify({ ...file, trim: [3, 2] })))).rejects.toThrow(/trim/)
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

// ---------- left/right swaps ----------

describe('unswapLeftRight', () => {
  /** A rigid torso turned `yaw` degrees, shoulders 0.36 m and hips 0.2 m wide. */
  function torso(yaw: number, swapped = false): Landmark[] {
    const w: Landmark[] = Array.from({ length: LANDMARK_COUNT }, (_, i) => ({ x: i * 1e-3, y: 0.5, z: 0, visibility: 0.9 }))
    const r = (yaw * Math.PI) / 180
    const put = (i: number, half: number, y: number) => {
      w[i] = { x: half * Math.cos(r), y, z: half * Math.sin(r), visibility: 0.95 }
    }
    put(LM.leftShoulder, -0.18, -0.5)
    put(LM.rightShoulder, 0.18, -0.5)
    put(LM.leftHip, -0.1, 0)
    put(LM.rightHip, 0.1, 0)
    // A leg landmark pair, to check that every pair moves with the torso.
    put(LM.leftAnkle, -0.1, 0.9)
    put(LM.rightAnkle, 0.1, 0.9)
    return swapped ? torso(yaw + 180) : w
  }
  const series = (yaws: (number | null)[], swapped: number[] = []): PoseSeries => ({
    fps: FPS,
    durationS: yaws.length / FPS,
    width: 720,
    height: 1280,
    model: 'synthetic',
    smoothed: false,
    frames: yaws.map((y, i) => {
      const world = y === null ? null : torso(y, swapped.includes(i))
      return { t: i / FPS, image: world && world.map((p) => ({ ...p })), world }
    }),
  })
  const relabeled = (s: PoseSeries) => s.frames.flatMap((f, i) => (f.relabeled ? [i] : []))

  it('puts back labels swapped for a few frames, in every left/right pair, image and world', () => {
    const raw = series([0, 0, 0, 0, 0, 0], [2, 3, 4])
    const out = unswapLeftRight(raw)
    expect(relabeled(out)).toEqual([2, 3, 4])
    for (const f of out.frames) {
      expect(f.world![LM.leftShoulder].x).toBeCloseTo(-0.18, 9)
      expect(f.world![LM.leftAnkle].x).toBeCloseTo(-0.1, 9)
      expect(f.image![LM.leftShoulder].x).toBeCloseTo(-0.18, 9)
    }
    // Positions are not changed, only which side they are filed under; the input is untouched.
    expect(raw.frames[2].world![LM.leftShoulder].x).toBeCloseTo(0.18, 9)
  })

  it('leaves a real turn alone up to 90° per frame and finds a swap during it', () => {
    const fast = Array.from({ length: 12 }, (_, i) => i * 80)
    expect(relabeled(unswapLeftRight(series(fast)))).toEqual([])
    expect(relabeled(unswapLeftRight(series(fast, [5, 6])))).toEqual([5, 6])
  })

  it('does not decide across a gap or from an untracked torso', () => {
    // After the gap the labels are taken as they come: the rotation in between is unknown.
    expect(relabeled(unswapLeftRight(series([0, 0, null, 0, 0], [3, 4])))).toEqual([])
    const weak = series([0, 0, 0, 0], [2, 3])
    weak.frames[1].world![LM.leftHip].visibility = 0.1
    expect(relabeled(unswapLeftRight(weak))).toEqual([])
  })

  it('looksSwapped is the 90° rule on a rigid torso', () => {
    expect(looksSwapped(torso(89), torso(0))).toBe(false)
    expect(looksSwapped(torso(91), torso(0))).toBe(true)
  })

  it('runs before the smoothing, so a swap does not turn into a rotation', () => {
    const smoothed = smoothSeries(series(Array.from({ length: 30 }, () => 0), [10, 11]))
    expect(relabeled(smoothed)).toEqual([10, 11])
    for (const f of smoothed.frames) expect(f.world![LM.rightShoulder].x).toBeCloseTo(0.18, 9)
  })

  it('survives the keypoints file', async () => {
    const smoothed = smoothSeries(series(Array.from({ length: 10 }, () => 0), [4]))
    const back = await decodeSeries(await encodeSeries(smoothed))
    expect(relabeled(back)).toEqual([4])
    const plain = await decodeSeries(await encodeSeries(smoothSeries(series([0, 0, 0]))))
    expect(plain.frames.some((f) => 'relabeled' in f)).toBe(false)
    const blob = await encodeSeries(smoothed)
    const file = JSON.parse(await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text())
    expect(file.relabeled).toEqual([4])
    const bad = new Blob([JSON.stringify({ ...file, relabeled: [99] })]).stream().pipeThrough(new CompressionStream('gzip'))
    await expect(decodeSeries(new Blob([await new Response(bad).arrayBuffer()]))).rejects.toThrow(/"relabeled"/)
  })
})

describe('smoothSeries parameters', () => {
  it('uses the SDD values on image landmarks and beta 0.7 on world landmarks', () => {
    expect(ONE_EURO_DEFAULTS).toEqual({ minCutoff: 1.0, beta: 0.007, dCutoff: 1.0 })
    expect(ONE_EURO_WORLD).toEqual({ minCutoff: 1.0, beta: 0.7, dCutoff: 1.0 })
  })
})

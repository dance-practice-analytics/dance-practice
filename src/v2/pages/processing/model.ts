// Pure logic of the Processing screen (FR-3.3.3, FR-3.3.5): batch counts, the
// time-left estimate from measured speed, and the facts of the preview card.

import { LM, type PoseSeries } from '../../../pose/types'

export type EntryStatus = 'queued' | 'processing' | 'done' | 'failed' | 'cancelled'

/** What the estimate needs from one queue item. */
export interface QueueEntry {
  status: EntryStatus
  /** 0..1 of the pose step. */
  fraction: number
  /** Clip length in seconds, when known. */
  durationS: number | null
  startedAt: number | null
  finishedAt: number | null
  frames?: number | null
}

export interface BatchCounts {
  total: number
  done: number
  processing: number
  queued: number
  failed: number
  cancelled: number
}

export function batchCounts(entries: readonly Pick<QueueEntry, 'status'>[]): BatchCounts {
  const c: BatchCounts = { total: entries.length, done: 0, processing: 0, queued: 0, failed: 0, cancelled: 0 }
  for (const e of entries) c[e.status]++
  return c
}

/** Share of the batch that is settled (done, failed or cancelled) plus the clip in progress, 0..100. */
export function batchPercent(entries: readonly QueueEntry[]): number {
  if (entries.length === 0) return 0
  let sum = 0
  for (const e of entries) {
    if (e.status === 'processing') sum += Math.min(1, Math.max(0, e.fraction))
    else if (e.status !== 'queued') sum += 1
  }
  return Math.round((sum / entries.length) * 100)
}

/** The pose step must be this far along before the clip in progress is used as a measurement. */
const MIN_FRACTION = 0.05

/**
 * Measured speed: seconds of processing per second of clip, from the clips that have
 * finished and the one in progress. Null until something has been measured.
 */
export function measureSpeed(entries: readonly QueueEntry[], now: number): number | null {
  let spent = 0
  let covered = 0
  for (const e of entries) {
    if (!e.durationS || e.durationS <= 0 || e.startedAt === null) continue
    if (e.status === 'done' && e.finishedAt !== null) {
      spent += (e.finishedAt - e.startedAt) / 1000
      covered += e.durationS
    } else if (e.status === 'processing' && e.fraction >= MIN_FRACTION) {
      spent += (now - e.startedAt) / 1000
      covered += e.durationS * e.fraction
    }
  }
  return covered > 0 && spent > 0 ? spent / covered : null
}

/** Seconds left for the clip in progress, or null without a measurement. */
export function entryTimeLeft(entry: QueueEntry, speed: number | null): number | null {
  if (speed === null || entry.status !== 'processing' || !entry.durationS) return null
  return Math.max(0, entry.durationS * (1 - Math.min(1, entry.fraction)) * speed)
}

/**
 * Seconds until the queue is empty: what is left of the clip in progress plus every
 * queued clip, at the measured speed. A queued clip of unknown length counts as the
 * mean of the known ones. Null when nothing has been measured yet (no guess is shown).
 */
export function estimateTimeLeft(entries: readonly QueueEntry[], now: number): number | null {
  const open = entries.filter((e) => e.status === 'queued' || e.status === 'processing')
  if (open.length === 0) return 0
  const speed = measureSpeed(entries, now)
  if (speed === null) return null
  const known = entries.map((e) => e.durationS).filter((d): d is number => typeof d === 'number' && d > 0)
  if (known.length === 0) return null
  const mean = known.reduce((a, b) => a + b, 0) / known.length
  let clipSeconds = 0
  for (const e of open) {
    const d = e.durationS && e.durationS > 0 ? e.durationS : mean
    clipSeconds += e.status === 'processing' ? d * (1 - Math.min(1, Math.max(0, e.fraction))) : d
  }
  return clipSeconds * speed
}

/** Frames per second over the clips that have finished, or null. */
export function measuredFps(entries: readonly QueueEntry[]): number | null {
  let frames = 0
  let spent = 0
  for (const e of entries) {
    if (e.status !== 'done' || !e.frames || e.startedAt === null || e.finishedAt === null) continue
    frames += e.frames
    spent += (e.finishedAt - e.startedAt) / 1000
  }
  return frames > 0 && spent > 0 ? frames / spent : null
}

/** 'About 6 min left', 'About 40 s left', 'Less than 10 s left'. */
export function formatTimeLeft(seconds: number): string {
  if (seconds < 10) return 'Less than 10 s left'
  if (seconds < 90) return `About ${Math.round(seconds / 10) * 10} s left`
  return `About ${Math.round(seconds / 60)} min left`
}

/** '0:14' — the mono figure on a queue row. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ---------- preview facts ----------

/** The landmarks the measurements use, with the words shown to the dancer. */
const BODY: readonly (readonly [number, string])[] = [
  [LM.leftShoulder, 'left shoulder'],
  [LM.rightShoulder, 'right shoulder'],
  [LM.leftHip, 'left hip'],
  [LM.rightHip, 'right hip'],
  [LM.leftKnee, 'left knee'],
  [LM.rightKnee, 'right knee'],
  [LM.leftAnkle, 'left ankle'],
  [LM.rightAnkle, 'right ankle'],
  [LM.leftHeel, 'left heel'],
  [LM.rightHeel, 'right heel'],
  [LM.leftFootIndex, 'left toes'],
  [LM.rightFootIndex, 'right toes'],
]

export interface TrackingFacts {
  frames: number
  tracked: number
  /** Tracked frames in which at least one measured landmark is under the visibility threshold. */
  lowConfidence: number
  /** The landmark that is weak most often, e.g. 'left knee'. */
  weakest: string | null
}

export function trackingFacts(series: Pick<PoseSeries, 'frames'>, threshold = 0.6): TrackingFacts {
  let tracked = 0
  let low = 0
  const weak = new Map<string, number>()
  for (const frame of series.frames) {
    if (!frame.image) continue
    tracked++
    let any = false
    for (const [index, name] of BODY) {
      const lm = frame.image[index]
      if (lm && lm.visibility < threshold) {
        any = true
        weak.set(name, (weak.get(name) ?? 0) + 1)
      }
    }
    if (any) low++
  }
  let weakest: string | null = null
  let most = 0
  for (const [name, n] of weak) {
    if (n > most) {
      most = n
      weakest = name
    }
  }
  return { frames: series.frames.length, tracked, lowConfidence: low, weakest }
}

/**
 * A neutral sentence about a finished clip's tracking, or null when most frames have a
 * pose. It describes the recording, never the dancer.
 */
export function trackingNote(frames: number | null, tracked: number | null): string | null {
  if (frames === null || tracked === null || frames <= 0) return null
  if (tracked === 0) return 'No person was found in this clip, so nothing was measured. The clip is untouched.'
  if (tracked < frames / 2) {
    return `A pose was found in ${tracked} of ${frames} frames. Measurements that need the other frames are shown as gaps.`
  }
  return null
}

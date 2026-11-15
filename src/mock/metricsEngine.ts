// Client-side stand-in for the backend metrics engine (Development Document 1.6).
// The real engine will be Python/NumPy; this mirrors its definitions so the UI
// can be built against realistic results before MovAI data exists.

import type { Keypoint, MetricDefinition, MetricId, MetricSample, Point, PoseFrame } from '../types'

export const METRICS: MetricDefinition[] = [
  {
    id: 'kneeToe',
    version: '0.1',
    name: 'Knee over toes',
    question: 'Are my knees staying over my toes?',
    reading: 'Side-to-side distance of each knee from the line above its toes, in % of shin length. 0 = right above the toes; positive = toward the midline.',
    unit: '% shin',
    joints: ['leftKnee', 'rightKnee', 'leftToe', 'rightToe'],
    bones: [['leftHip', 'leftKnee'], ['rightHip', 'rightKnee'], ['leftKnee', 'leftAnkle'], ['rightKnee', 'rightAnkle']],
    phases: ['prep', 'rise', 'hold', 'release'],
    domain: [-4, 18],
    peak: 'max',
    decimals: 1,
  },
  {
    id: 'shoulderEar',
    version: '0.1',
    name: 'Shoulder–ear space',
    question: 'Are my shoulders staying down, away from my ears?',
    reading: 'Distance from each ear to its shoulder, in % of torso length. A lower number means the shoulders are closer to the ears.',
    unit: '% torso',
    joints: ['leftEar', 'rightEar', 'leftShoulder', 'rightShoulder'],
    bones: [['leftShoulder', 'rightShoulder']],
    phases: ['rise', 'hold'],
    domain: [20, 42],
    peak: 'min',
    decimals: 1,
  },
  {
    id: 'trunkTilt',
    version: '0.1',
    name: 'Trunk tilt',
    question: 'How far does my torso lean to the side?',
    reading: 'Angle between the hip-to-shoulder line and vertical, in degrees. 0 = vertical; positive = leaning toward my left.',
    unit: '°',
    joints: ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'],
    bones: [['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip']],
    phases: ['rise', 'hold'],
    domain: [-6, 6],
    peak: 'maxAbs',
    decimals: 1,
  },
  {
    id: 'heelLift',
    version: '0.1',
    name: 'Relevé height',
    question: 'How high do I rise, and how long do I stay up?',
    reading: 'Height of the heels above their standing position, in % of shin length.',
    unit: '% shin',
    joints: ['leftHeel', 'rightHeel', 'leftAnkle', 'rightAnkle'],
    bones: [['leftAnkle', 'leftHeel'], ['rightAnkle', 'rightHeel'], ['leftAnkle', 'leftToe'], ['rightAnkle', 'rightToe']],
    phases: ['rise', 'hold', 'release'],
    domain: [0, 30],
    peak: 'max',
    decimals: 1,
  },
]

/** Heel height (% shin) above which the dancer counts as being on relevé. */
export const RELEVE_THRESHOLD = 15

type Pts = Record<Keypoint, Point>

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

function kneeToe(p: Pts): number {
  // Left side sits at +x, so "toward the midline" is -x for the left leg and +x for the right.
  const left = (p.leftToe[0] - p.leftKnee[0]) / dist(p.leftKnee, p.leftAnkle)
  const right = (p.rightKnee[0] - p.rightToe[0]) / dist(p.rightKnee, p.rightAnkle)
  return ((left + right) / 2) * 100
}

function shoulderEar(p: Pts): number {
  const torso = dist(mid(p.leftShoulder, p.rightShoulder), mid(p.leftHip, p.rightHip))
  const space = (dist(p.leftEar, p.leftShoulder) + dist(p.rightEar, p.rightShoulder)) / 2
  return (space / torso) * 100
}

function trunkTilt(p: Pts): number {
  const s = mid(p.leftShoulder, p.rightShoulder)
  const h = mid(p.leftHip, p.rightHip)
  return (Math.atan2(s[0] - h[0], s[1] - h[1]) * 180) / Math.PI
}

function heelLift(p: Pts, baseline: number): number {
  const shin = (dist(p.leftKnee, p.leftAnkle) + dist(p.rightKnee, p.rightAnkle)) / 2
  return (((p.leftHeel[1] + p.rightHeel[1]) / 2 - baseline) / shin) * 100
}

/** Standing heel height: the median of the lowest fifth of observed heel heights. */
function heelBaseline(pose: PoseFrame[]): number {
  const heights = pose
    .filter((f) => f.points && f.confidence >= 0.5)
    .map((f) => (f.points!.leftHeel[1] + f.points!.rightHeel[1]) / 2)
    .sort((a, b) => a - b)
  const low = heights.slice(0, Math.max(1, Math.floor(heights.length / 5)))
  return low[Math.floor(low.length / 2)] ?? 0
}

export function computeSeries(pose: PoseFrame[]): Record<MetricId, MetricSample[]> {
  const baseline = heelBaseline(pose)
  const fns: Record<MetricId, (p: Pts) => number> = {
    kneeToe,
    shoulderEar,
    trunkTilt,
    heelLift: (p) => heelLift(p, baseline),
  }
  const out = {} as Record<MetricId, MetricSample[]>
  for (const id of Object.keys(fns) as MetricId[]) {
    out[id] = pose.map((f) => {
      if (!f.points) return { t: f.t, value: null, quality: 'missing' }
      return { t: f.t, value: fns[id](f.points), quality: f.confidence < 0.5 ? 'low' : 'ok' }
    })
  }
  return out
}

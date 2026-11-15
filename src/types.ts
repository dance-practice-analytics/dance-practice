// Shapes returned by GET /sessions/{id}/results. The mock API and the future
// FastAPI backend must both produce exactly this contract.

export type Seconds = number

export const KEYPOINTS = [
  'nose', 'leftEar', 'rightEar',
  'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist',
  'leftHip', 'rightHip', 'leftKnee', 'rightKnee',
  'leftAnkle', 'rightAnkle', 'leftHeel', 'rightHeel', 'leftToe', 'rightToe',
] as const
export type Keypoint = (typeof KEYPOINTS)[number]

/** Body-space point: x to the dancer's left (screen right in a front view), y up from the floor, in body heights. */
export type Point = [number, number]

export interface PoseFrame {
  t: Seconds
  /** null when the pose was not detected in this frame. */
  points: Record<Keypoint, Point> | null
  confidence: number
}

export type PhaseId = 'prep' | 'rise' | 'hold' | 'release'

export interface Phase {
  id: PhaseId
  label: string
  start: Seconds
  end: Seconds
}

export type CameraView = 'front' | 'side' | 'mirror'
export type Fatigue = 'fresh' | 'some' | 'tired'

export interface AttemptContext {
  view: CameraView
  music: boolean
  fatigue: Fatigue
}

export interface Attempt {
  id: string
  index: number
  start: Seconds
  end: Seconds
  /** Contiguous and ordered: phases[i].end === phases[i + 1].start. */
  phases: Phase[]
  context: AttemptContext
}

export type MetricId = 'kneeToe' | 'shoulderEar' | 'trunkTilt' | 'heelLift'

export interface MetricDefinition {
  id: MetricId
  version: string
  name: string
  /** The dancer's question this metric answers. */
  question: string
  /** How to read the number, stated neutrally (no good/bad). */
  reading: string
  unit: string
  joints: Keypoint[]
  bones: [Keypoint, Keypoint][]
  /** Phases where the metric is defined. Outside them no value is shown. */
  phases: PhaseId[]
  domain: [number, number]
  /** Which extreme the "peak" summary reports. */
  peak: 'max' | 'min' | 'maxAbs'
  decimals: number
}

export type SampleQuality = 'ok' | 'low' | 'missing'

export interface MetricSample {
  t: Seconds
  value: number | null
  quality: SampleQuality
}

export interface SessionResults {
  session: {
    id: string
    participant: string
    movement: string
    goal: string
    recordedAt: string
    duration: Seconds
    fps: number
    synthetic: boolean
    boundaryRevision: number
    /** False until the dancer confirms attempts; until then `attempts` may be empty. */
    attemptsConfirmed: boolean
    conditions: RecordingConditions
  }
  attempts: Attempt[]
  metrics: MetricDefinition[]
  series: Record<MetricId, MetricSample[]>
  pose: PoseFrame[]
  notes: SessionNotes
}

// ---------- session workflow (Development Document 2.3.4) ----------

export type CameraDistance = 'close' | 'medium' | 'far'

/** What the dancer reports about the recording. A change of view changes what a measurement shows. */
export interface RecordingConditions {
  view: CameraView
  distance: CameraDistance
  music: boolean
  fatigue: Fatigue
}

/** Media properties measured by the server (FFprobe) at intake. */
export interface MediaInfo {
  duration: Seconds
  fps: number
  width: number
  height: number
  codec: string
  sizeBytes: number
}

export type SessionStatus = 'awaiting_pose' | 'processing' | 'needs_confirmation' | 'ready' | 'failed'

/** One row of GET /sessions. */
export interface SessionSummary {
  id: string
  participant: string
  movement: string
  goal: string
  recordedAt: string
  status: SessionStatus
  attemptCount: number
  conditions: RecordingConditions
  media: MediaInfo | null
  /** Active or last import job, when there is one. */
  jobId: string | null
  reflection: string
  nextGoal: string
  synthetic: boolean
}

/** POST /sessions (multipart: these fields plus the video file). */
export interface CreateSessionRequest {
  movement: string
  goal: string
  conditions: RecordingConditions
  /** The dancer confirms they may use this footage. Required by intake. */
  permissionConfirmed: true
  /** Mock only: use the synthetic sample clip instead of a file. */
  useSample?: boolean
}

export type JobState = 'queued' | 'processing' | 'complete' | 'failed' | 'interrupted'

export interface QualityGap {
  from: Seconds
  to: Seconds
  kind: 'low' | 'missing'
}

/** Outcome of validating and normalising a pose export. */
export interface ImportReport {
  frames: number
  /** Fraction of frames with a usable pose. */
  coverage: number
  gaps: QualityGap[]
  warnings: string[]
}

/** GET /jobs/{id} */
export interface Job {
  id: string
  sessionId: string
  kind: 'pose_import'
  state: JobState
  progress: number
  stage: string
  error: { code: string; message: string; recovery: string } | null
  report: ImportReport | null
}

/** PUT /sessions/{id}/attempts. The server validates order, clip limits and overlap. */
export interface AttemptsUpdate {
  boundaryRevision: number
  attempts: Attempt[]
}

/** Moments, reflection and the goal for next time. Saved with PATCH /sessions/{id}. */
export interface SessionNotes {
  moments: Marker[]
  reflection: string
  nextGoal: string
}

export interface SessionPatch {
  goal?: string
  notes?: Partial<SessionNotes>
}

export interface PhaseSummary {
  mean: number | null
  peak: number | null
  peakT: Seconds | null
  /** Fraction of the phase with usable samples. */
  coverage: number
  available: boolean
  reason?: string
}

export interface Marker {
  id: string
  t: Seconds
  text: string
  author: 'dancer' | 'companion'
}

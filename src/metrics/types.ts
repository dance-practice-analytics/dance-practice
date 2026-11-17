// Output contract of the metrics engine (FR-3.4.x, SDD 5.2). `AttemptMetrics` is the
// row written to the `attempt_metrics` table: values only, never a score or a grade.

export type Movement = 'releve_balance' | 'pirouette' | 'phrase'

export type Phase = 'prep' | 'rise' | 'hold' | 'turn' | 'finish' | 'recovery'

export type ConfidenceLevel = 'high' | 'medium' | 'low'

/** Metric ids are the column names of `attempt_metrics`. */
export type MetricKey =
  | 'trunk_inclination_deg'
  | 'pelvis_ankle_offset_norm'
  | 'balance_duration_s'
  | 'knee_tracking_dev_deg'
  | 'turn_count'

/** Why a metric is null. Machine-readable; the UI turns it into the dancer-facing sentence. */
export type NullReason =
  /** No frame of the clip has a detected pose. */
  | 'no_pose'
  /** Heels and toes were not tracked in the floor window (0.5–1.0 s), so there is no floor level. */
  | 'no_floor_reference'
  /** Hip, knee and ankle were never tracked together, so nothing can be normalized. */
  | 'no_leg_length'
  /** The heel never rose above the lift threshold for 3 consecutive frames. */
  | 'no_lift_detected'
  /** The attempt has no frames in the phases this metric is measured in. */
  | 'phase_not_found'
  /** The phases exist, but no frame in them has every needed landmark tracked. */
  | 'no_valid_frames'
  /** Knee tracking is only measured in a plié; the knee never bent past the threshold. */
  | 'knee_not_bent'
  /** Pirouette without a detected turn. */
  | 'no_turn_detected'
  /** The metric does not apply to this movement (turn count on a relevé balance). */
  | 'not_applicable'

/** Qualifiers on a value that was computed. */
export type MetricNote =
  /** A left/right shoulder swap was detected and undone while unwrapping the yaw. */
  | 'left_right_swap_corrected'
  /** Frames are missing inside the turn; rotation during the gap cannot be seen. */
  | 'tracking_lost_in_turn'

/** Qualifiers that come from the clip as a whole, not from one metric's frames. */
export type ClipNote =
  /** The clip holds more than one lift. Phases and values describe the first one only. */
  | 'multiple_lifts_detected'

/** `start` is inclusive and `end` exclusive, in seconds from the start of the clip. */
export interface PhaseSpan {
  phase: Phase
  start: number
  end: number
}

export interface MetricConfidence {
  level: ConfidenceLevel
  /** 0..1: share of usable frames × their mean landmark visibility (SDD 5.5). */
  score: number
  /** Phases the metric is taken from (FR-3.4.7). */
  phases: Phase[]
  /** Present exactly when the value is null. */
  reason?: NullReason
  notes?: MetricNote[]
  /** Present on a computed value when the clip as a whole needs a remark. */
  clip_notes?: ClipNote[]
}

export interface AttemptMetrics {
  movement: Movement
  /** Degrees from vertical, 0..180, unsigned. */
  trunk_inclination_deg: number | null
  /** Ratio of supporting leg length, >= 0; 0 = pelvis over the supporting ankle. */
  pelvis_ankle_offset_norm: number | null
  /** Seconds. */
  balance_duration_s: number | null
  /** Degrees, 0..180, unsigned. */
  knee_tracking_dev_deg: number | null
  /** Turns in quarter steps, unsigned; pirouette only. */
  turn_count: number | null
  phases: PhaseSpan[]
  confidence: Record<MetricKey, MetricConfidence>
  algorithm_version: string
}

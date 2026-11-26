// Row types for the Supabase schema (supabase/migrations/20261115000000_init.sql,
// 20261117000000_attempt_notes.sql, 20261117010000_reference_attempt.sql and
// 20261117020000_phrase.sql, SDD 6).
// Column names stay in snake_case so a row can be passed to and from the client as is.
// Insert types leave out owner_id on purpose: the database fills it with auth.uid(),
// so the browser never chooses whose row it is writing.

import type { PhraseResult, ThemeKey } from '../metrics/phrase'

export const USER_ROLES = ['dancer', 'researcher'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const MOVEMENT_TYPES = ['releve_balance', 'pirouette', 'phrase'] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

export const ATTEMPT_SOURCES = ['study_dataset', 'user_upload'] as const
export type AttemptSource = (typeof ATTEMPT_SOURCES)[number]

export const ATTEMPT_STATUSES = ['queued', 'processing', 'done', 'failed'] as const
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number]

/** sessions.camera_view is text with a CHECK, not an enum. */
export const CAMERA_VIEWS = ['front', 'side', 'diagonal'] as const
export type CameraView = (typeof CAMERA_VIEWS)[number]

/** Same pattern as the CHECK on subjects.subject_code. */
export const SUBJECT_CODE_RE = /^S\d{2}$/

export const KEYPOINTS_BUCKET = 'keypoints'
export const VIDEOS_BUCKET = 'videos'
/** file_size_limit of the keypoints bucket (10 MB). */
export const KEYPOINTS_MAX_BYTES = 10_485_760
export const DEFAULT_POSE_MODEL = 'pose_landmarker_full'

/** timestamptz as an ISO string. */
export type Timestamp = string
/** date as YYYY-MM-DD. */
export type DateOnly = string

// ---------- profiles ----------
// Created by the trigger on auth.users; the owner may only change display_name.
export interface ProfileRow {
  id: string
  owner_id: string
  display_name: string | null
  role: UserRole
  created_at: Timestamp
}

// ---------- subjects ----------
export interface SubjectRow {
  id: string
  owner_id: string
  subject_code: string
  notes: string | null
  created_at: Timestamp
}

export interface SubjectInsert {
  subject_code: string
  notes?: string | null
}

// ---------- consents ----------
export interface ConsentRow {
  id: string
  owner_id: string
  subject_id: string | null
  scope: string
  form_reference: string | null
  granted_on: DateOnly
  revoked_on: DateOnly | null
  created_at: Timestamp
}

/**
 * Account-level consent scopes (FR-3.1.6); one row per accepted scope, subject_id null.
 * The first two are required before anything is stored; the others are optional and
 * can be switched later in Settings.
 */
export const CONSENT_SCOPES = [
  'on_device_processing',
  'keypoints_and_metrics_storage',
  'ai_metrics_only',
  'own_video_upload',
] as const
export type ConsentScope = (typeof CONSENT_SCOPES)[number]
export const REQUIRED_CONSENT_SCOPES: readonly ConsentScope[] = ['on_device_processing', 'keypoints_and_metrics_storage']
/** Version of the in-app consent text, stored in consents.form_reference. */
export const CONSENT_VERSION = 'app-consent-v1'

export interface ConsentInsert {
  subject_id?: string | null
  scope: string
  form_reference?: string | null
  granted_on?: DateOnly
  revoked_on?: DateOnly | null
}

// ---------- sessions ----------
export interface SessionRow {
  id: string
  owner_id: string
  subject_id: string | null
  movement_type: MovementType
  title: string | null
  recorded_on: DateOnly | null
  camera_view: CameraView | null
  /** The dancer's own words (≤ NOTE_MAX_CHARS). Never sent to the AI functions. */
  note: string | null
  created_at: Timestamp
}

export interface SessionInsert {
  movement_type: MovementType
  subject_id?: string | null
  title?: string | null
  recorded_on?: DateOnly | null
  camera_view?: CameraView | null
  note?: string | null
}

/** CHECK on sessions.note and attempts.note (migration 20261117000000). */
export const NOTE_MAX_CHARS = 2000

// ---------- attempts ----------
export interface AttemptRow {
  id: string
  owner_id: string
  session_id: string
  source: AttemptSource
  label: string | null
  /** De-identified (`S03_att07.mp4`, `clip 7.mp4`), never the local file name (FR-3.2.5). */
  clip_name: string | null
  /** Clip number within the subject's dataset (FR-3.2.4), 0–999. */
  clip_number: number | null
  /** The dancer's own note on this attempt (FR-3.5.7). Never sent to the AI functions. */
  note: string | null
  /** Storage path in the videos bucket ({owner}/{attempt}.{ext}); set only by the opt-in backup (CHECK video_path_own_folder). */
  video_path: string | null
  video_sha256: string | null
  duration_s: number | null
  fps: number | null
  status: AttemptStatus
  error: string | null
  /** FR-3.6.6: the dancer's reference attempt (one per movement and subject; a trigger
   *  clears the previous one). A point of comparison, never a grade. */
  is_reference: boolean
  /** FR-3.2.7: processed part of the clip, seconds of the original clip; both null = whole clip. */
  trim_start_s: number | null
  trim_end_s: number | null
  created_at: Timestamp
}

export interface AttemptInsert {
  session_id: string
  source: AttemptSource
  label?: string | null
  clip_name?: string | null
  clip_number?: number | null
  note?: string | null
  video_path?: string | null
  video_sha256?: string | null
  duration_s?: number | null
  fps?: number | null
  status?: AttemptStatus
  error?: string | null
  is_reference?: boolean
  trim_start_s?: number | null
  trim_end_s?: number | null
}

/** A study clip can never point at a stored video. */
export interface StudyAttemptInsert extends AttemptInsert {
  source: 'study_dataset'
  video_path: null
}

// ---------- attempt_keypoints ----------
export interface AttemptKeypointsRow {
  attempt_id: string
  owner_id: string
  /** Object path inside the keypoints bucket: {owner_id}/{attempt_id}.json.gz */
  storage_path: string
  frame_count: number
  size_bytes: number | null
  model: string
  created_at: Timestamp
}

export interface AttemptKeypointsInsert {
  attempt_id: string
  storage_path: string
  frame_count: number
  size_bytes?: number | null
  model?: string
}

// ---------- attempt_metrics ----------
// The jsonb shapes follow SDD 5.2; `phrase` follows src/metrics/phrase.ts.
export type Phase = 'prep' | 'rise' | 'hold' | 'turn' | 'finish' | 'recovery'
export type ConfidenceLevel = 'high' | 'medium' | 'low'

/** start and end in seconds from the start of the clip. */
export interface PhaseSpan {
  phase: Phase
  start: number
  end: number
}

/** Keyed by metric column name, e.g. 'trunk_inclination_deg'. */
export type MetricConfidence = Record<string, { level: ConfidenceLevel; score: number }>

export interface AttemptMetricsRow {
  attempt_id: string
  owner_id: string
  movement: MovementType
  // null means "not available for this attempt", never zero.
  trunk_inclination_deg: number | null
  pelvis_ankle_offset_norm: number | null
  balance_duration_s: number | null
  knee_tracking_dev_deg: number | null
  turn_count: number | null
  /** Added in migration 20261126000000; null on rows computed before mt2-metrics-1.3.0 (optional for older fixtures). */
  feet_angle_deg?: number | null
  phases: PhaseSpan[]
  confidence: MetricConfidence
  algorithm_version: string
  computed_at: Timestamp
  /** Phrase attempts only (movement 'phrase'): events and theme measures; null otherwise. */
  phrase?: PhraseResult | null
}

export interface AttemptMetricsInsert {
  attempt_id: string
  movement: MovementType
  trunk_inclination_deg?: number | null
  pelvis_ankle_offset_norm?: number | null
  balance_duration_s?: number | null
  knee_tracking_dev_deg?: number | null
  turn_count?: number | null
  feet_angle_deg?: number | null
  phases?: PhaseSpan[]
  confidence?: MetricConfidence
  algorithm_version: string
  computed_at?: Timestamp
  phrase?: PhraseResult | null
}

// ---------- feedback ----------
export interface FeedbackRow {
  id: string
  owner_id: string
  attempt_id: string
  model: string
  prompt_version: string
  input_hash: string
  response: unknown
  created_at: Timestamp
}

export interface FeedbackInsert {
  attempt_id: string
  model: string
  prompt_version: string
  input_hash: string
  response: unknown
}

// ---------- user_preferences (migration 20261117020000) ----------
/** One row per account; owner-only RLS. Display preferences only, never practice data. */
export interface UserPreferencesRow {
  owner_id: string
  /** Up to MAX_FOCUS_THEMES phrase themes the dancer chose to see first. */
  focus_themes: ThemeKey[]
  updated_at: Timestamp
}

/** CHECK on user_preferences.focus_themes. */
export const MAX_FOCUS_THEMES = 3
/** CHECK on attempt_metrics.phrase (octet length of its text form). */
export const PHRASE_MAX_BYTES = 262_144

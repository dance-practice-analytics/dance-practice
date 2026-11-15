// In-browser stand-in for the FastAPI server. Sessions, boundaries and notes
// persist in localStorage so a reload behaves like reopening a real session.
// Pose data is regenerated from each session's seed, never stored.

import type { Account, DadApi } from '../api/client'
import { ApiError } from '../api/client'
import type { Attempt, ImportReport, Job, MediaInfo, SessionResults, SessionStatus, SessionSummary } from '../types'
import { assembleResults, buildPoseTrack, DEMO_SPEC, plannedAttempts, type PoseTrack, type SyntheticSpec } from './syntheticSession'
import { clipUrl, SAMPLE_SEED } from './clips'
import { qualitySpans } from '../lib/series'
import { validateAttempts } from '../lib/suggest'
import { exportCsv, exportJson } from '../lib/exportData'
import { formatTime } from '../lib/format'

interface MockJob {
  id: string
  startedAt: number
  scenario: 'ok' | 'mismatch'
}

interface SessionRecord {
  spec: SyntheticSpec
  status: SessionStatus
  media: MediaInfo | null
  job: MockJob | null
}

type Db = Record<string, SessionRecord[]>

const DB_KEY = 'dad-mock-db-v1'
const AUTH_KEY = 'dad-mock-auth'
const PASSCODE = 'practice'
const RUN = 'synthetic run · adapter 0.1 · metrics engine 0.1 (browser mirror)'

const wait = (ms = 140 + Math.random() * 160) => new Promise((r) => setTimeout(r, ms))

function loadDb(): Db {
  try {
    return JSON.parse(localStorage.getItem(DB_KEY) ?? '{}') as Db
  } catch {
    return {}
  }
}

let db: Db = loadDb()

function saveDb() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db))
  } catch {
    // storage blocked: the mock keeps working for this tab only
  }
}

/** Forget every mock session, so the next sign-in starts from the same seeded history (study runs). */
export function resetMockData() {
  db = {}
  saveDb()
}

function account(): Account | null {
  try {
    const participant = sessionStorage.getItem(AUTH_KEY)
    return participant ? { participant } : null
  } catch {
    return null
  }
}

/**
 * Use this account for the synthetic sessions without the mock's own sign-in
 * (accounts come from Supabase Auth). A new account starts from the seeded history.
 */
export function adoptAccount(participant: string | null) {
  try {
    if (participant) sessionStorage.setItem(AUTH_KEY, participant)
    else sessionStorage.removeItem(AUTH_KEY)
  } catch {
    // storage blocked: the synthetic sessions are unavailable in this tab
  }
  if (participant && !db[participant]) {
    db[participant] = seedHistory(participant)
    saveDb()
  }
}

function requireAccount(): Account {
  const me = account()
  if (!me) throw new ApiError(401, 'not_signed_in', 'Your session ended. Sign in again to continue.')
  return me
}

function records(): SessionRecord[] {
  return (db[requireAccount().participant] ??= [])
}

function record(id: string): SessionRecord {
  const rec = records().find((r) => r.spec.id === id)
  if (!rec) throw new ApiError(404, 'session_not_found', 'This session no longer exists.')
  return rec
}

const SAMPLE_MEDIA: MediaInfo = { duration: 39, fps: 30, width: 1080, height: 1920, codec: 'h264', sizeBytes: 48_200_000 }

/** A short practice history so the journal has something to show on first sign-in. */
function seedHistory(participant: string): SessionRecord[] {
  const history: Omit<SyntheticSpec, 'participant' | 'attempts' | 'boundaryRevision'>[] = [
    {
      id: 's-1014', seed: 1014, variation: 1, recordedAt: '2026-10-14T16:10:00-04:00', goal: 'Find my balance at the top',
      conditions: { view: 'front', distance: 'medium', music: false, fatigue: 'fresh' },
      notes: { moments: [], reflection: 'The top felt wobbly on every attempt. I think I rush the rise.', nextGoal: 'Slow down the rise' },
    },
    {
      id: 's-1017', seed: 1017, variation: 1, recordedAt: '2026-10-17T17:40:00-04:00', goal: 'Slow down the rise',
      conditions: { view: 'side', distance: 'medium', music: true, fatigue: 'some' },
      notes: { moments: [], reflection: 'Filmed from the side because the studio was full.', nextGoal: 'Keep my shoulders down' },
    },
    {
      id: 's-1021', seed: 1021, variation: 1, recordedAt: '2026-10-21T16:05:00-04:00', goal: 'Keep my shoulders down',
      conditions: { view: 'front', distance: 'medium', music: false, fatigue: 'fresh' },
      notes: { moments: [], reflection: 'Shoulders felt calmer in the last two attempts.', nextGoal: 'Keep my knees over my toes' },
    },
    {
      id: 's-1024', seed: 1024, variation: 1, recordedAt: '2026-10-24T18:20:00-04:00', goal: 'Keep my knees over my toes',
      conditions: { view: 'front', distance: 'far', music: true, fatigue: 'tired' },
      notes: { moments: [], reflection: 'Tired today. Knees drifted in when I held longer.', nextGoal: 'Keep my knees over my toes as I rise' },
    },
  ]
  const confirmed = (spec: Omit<SyntheticSpec, 'participant' | 'attempts' | 'boundaryRevision'>): SessionRecord => ({
    spec: {
      ...spec,
      participant,
      boundaryRevision: 1,
      attempts: plannedAttempts(spec).map((a) => ({ ...a, context: { ...a.context, view: spec.conditions.view } })),
    },
    status: 'ready',
    media: SAMPLE_MEDIA,
    job: null,
  })
  const demo = confirmed({ ...DEMO_SPEC, notes: { ...DEMO_SPEC.notes } })
  const hold = demo.spec.attempts![0].phases.find((p) => p.id === 'hold')!
  demo.spec.notes.moments = [{ id: 'm0', t: hold.start + 0.6, text: 'Felt my weight go to the big toes here', author: 'dancer' }]
  return [...history.map(confirmed), demo]
}

// ---------- pose data cache ----------

const cache = new Map<string, PoseTrack>()

function base(spec: SyntheticSpec): PoseTrack {
  const key = `${spec.seed}:${spec.variation}`
  let track = cache.get(key)
  if (!track) {
    track = buildPoseTrack(spec)
    cache.set(key, track)
  }
  return track
}

const results = (rec: SessionRecord): SessionResults => assembleResults(rec.spec, base(rec.spec))

function summary(rec: SessionRecord): SessionSummary {
  const { spec } = rec
  return {
    id: spec.id,
    participant: spec.participant,
    movement: 'Relevé balance in parallel',
    goal: spec.goal,
    recordedAt: spec.recordedAt,
    status: rec.status,
    attemptCount: spec.attempts?.length ?? 0,
    conditions: spec.conditions,
    media: rec.media,
    jobId: rec.job?.id ?? null,
    reflection: spec.notes.reflection,
    nextGoal: spec.notes.nextGoal,
    synthetic: true,
  }
}

// ---------- import job simulation ----------

const STAGES: [number, string][] = [
  [0.6, 'Waiting for a worker'],
  [1.6, 'Checking the export format and fields'],
  [2.9, 'Matching the export to your clip at the start, middle and end'],
  [4.3, 'Converting landmarks to body coordinates'],
  [5.6, 'Calculating measurements'],
]
const TOTAL = STAGES[STAGES.length - 1][0]
const MISMATCH_AT = 2.4

function importReport(rec: SessionRecord): ImportReport {
  const { pose, series } = base(rec.spec)
  const fps = 30
  const usable = pose.filter((f) => f.points && f.confidence >= 0.5).length
  const gaps = qualitySpans(series.heelLift, 0, pose.length / fps, fps)
  const warnings = gaps.map((g) =>
    g.kind === 'missing'
      ? `No pose for ${(g.to - g.from).toFixed(1)} s near ${formatTime(g.from)}. Those moments stay empty.`
      : `Low tracking confidence for ${(g.to - g.from).toFixed(1)} s near ${formatTime(g.from)}. Values there are shown hatched.`,
  )
  return { frames: pose.length, coverage: usable / pose.length, gaps, warnings }
}

function jobView(rec: SessionRecord): Job {
  const job = rec.job!
  const elapsed = (Date.now() - job.startedAt) / 1000
  const common = { id: job.id, sessionId: rec.spec.id, kind: 'pose_import' as const, report: null, error: null }
  if (job.scenario === 'mismatch' && elapsed >= MISMATCH_AT) {
    if (rec.status !== 'failed') {
      rec.status = 'failed'
      saveDb()
    }
    return {
      ...common,
      state: 'failed',
      progress: MISMATCH_AT / TOTAL,
      stage: STAGES[2][1],
      error: {
        code: 'export_clip_mismatch',
        message: 'This pose export has 1,050 frames, but your clip has 1,171. It looks like it came from a different or trimmed clip.',
        recovery: 'Export the pose data again from the same, untrimmed clip and upload it here.',
      },
    }
  }
  if (elapsed >= TOTAL) {
    if (rec.status === 'processing') {
      rec.status = 'needs_confirmation'
      saveDb()
    }
    return { ...common, state: 'complete', progress: 1, stage: 'Done', report: importReport(rec) }
  }
  const stage = STAGES.find(([end]) => elapsed < end)!
  return { ...common, state: elapsed < STAGES[0][0] ? 'queued' : 'processing', progress: elapsed / TOTAL, stage: stage[1] }
}

// ---------- API ----------

export const mockApi: DadApi = {
  async me() {
    await wait(60)
    return account()
  },
  async signIn(participant, passcode) {
    await wait(400)
    const code = participant.trim().toUpperCase()
    if (!/^P\d{2,3}$/.test(code) || passcode !== PASSCODE) {
      throw new ApiError(401, 'invalid_credentials', 'That participant code and passcode don’t match.', 'Check the code your study facilitator gave you, for example P07.')
    }
    try {
      sessionStorage.setItem(AUTH_KEY, code)
    } catch {
      // storage blocked: sign-in lasts until reload
    }
    if (!db[code]) {
      db[code] = seedHistory(code)
      saveDb()
    }
    return { participant: code }
  },
  async signOut() {
    await wait(80)
    try {
      sessionStorage.removeItem(AUTH_KEY)
    } catch {
      // nothing stored
    }
  },
  async listSessions() {
    await wait()
    return records()
      .map(summary)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
  },
  async createSession(req, video) {
    await wait(600)
    const me = requireAccount()
    if (!req.permissionConfirmed) throw new ApiError(422, 'permission_required', 'Confirm you have permission to use this footage.')
    if (video && video.size > 500 * 1024 * 1024) throw new ApiError(413, 'clip_too_large', 'This clip is larger than 500 MB.', 'Trim it to just the attempts and try again.')
    const rec: SessionRecord = {
      spec: {
        id: `s-${Date.now().toString(36)}`,
        // Every new session gets the sample track, so it plays with the sample clip and study runs repeat exactly.
        seed: SAMPLE_SEED,
        variation: 1,
        participant: me.participant,
        goal: req.goal.trim(),
        recordedAt: new Date().toISOString(),
        conditions: req.conditions,
        attempts: null,
        boundaryRevision: 0,
        notes: { moments: [], reflection: '', nextGoal: '' },
      },
      status: 'awaiting_pose',
      media: { ...SAMPLE_MEDIA, sizeBytes: video?.size ?? SAMPLE_MEDIA.sizeBytes },
      job: null,
    }
    records().push(rec)
    saveDb()
    return summary(rec)
  },
  async uploadPose(sessionId, _file, scenario) {
    await wait(300)
    const rec = record(sessionId)
    if (rec.status === 'processing') throw new ApiError(409, 'job_active', 'This session is already being processed.')
    rec.job = { id: `j-${Date.now().toString(36)}`, startedAt: Date.now(), scenario: scenario ?? 'ok' }
    rec.status = 'processing'
    saveDb()
    return jobView(rec)
  },
  async getJob(jobId) {
    await wait(50)
    const rec = records().find((r) => r.job?.id === jobId)
    if (!rec) throw new ApiError(404, 'job_not_found', 'This processing job no longer exists.')
    return jobView(rec)
  },
  async getSessionResults(sessionId) {
    await wait(250)
    const rec = record(sessionId)
    if (rec.status === 'awaiting_pose' || rec.status === 'processing' || rec.status === 'failed') {
      throw new ApiError(409, 'results_not_ready', 'Measurements aren’t ready for this session yet.')
    }
    return results(rec)
  },
  async putAttempts(sessionId, update) {
    await wait(250)
    const rec = record(sessionId)
    const problems = validateAttempts(update.attempts, SAMPLE_MEDIA.duration)
    if (problems.length) throw new ApiError(422, 'invalid_boundaries', problems[0].message)
    if (update.boundaryRevision !== rec.spec.boundaryRevision) {
      throw new ApiError(409, 'stale_boundaries', 'These boundaries were changed somewhere else.', 'Reload the session to see the latest version.')
    }
    rec.spec.attempts = update.attempts.map((a: Attempt) => ({ ...a, phases: a.phases.map((p) => ({ ...p })) }))
    rec.spec.boundaryRevision += 1
    rec.status = 'ready'
    saveDb()
    return { boundaryRevision: rec.spec.boundaryRevision }
  },
  async patchSession(sessionId, patch) {
    await wait(120)
    const rec = record(sessionId)
    if (patch.goal !== undefined) rec.spec.goal = patch.goal
    if (patch.notes) rec.spec.notes = { ...rec.spec.notes, ...patch.notes }
    saveDb()
  },
  async exportSession(sessionId, format) {
    await wait(500)
    const r = results(record(sessionId))
    return format === 'json' ? new Blob([exportJson(r, RUN)], { type: 'application/json' }) : new Blob([exportCsv(r)], { type: 'text/csv' })
  },
  async deleteSession(sessionId) {
    await wait(700)
    const list = records()
    const i = list.findIndex((r) => r.spec.id === sessionId)
    if (i < 0) throw new ApiError(404, 'session_not_found', 'This session no longer exists.')
    list.splice(i, 1)
    saveDb()
  },
  videoUrl(sessionId) {
    if (!account()) return null
    const rec = records().find((r) => r.spec.id === sessionId)
    return rec ? clipUrl(rec.spec.seed, rec.spec.variation) : null
  },
}

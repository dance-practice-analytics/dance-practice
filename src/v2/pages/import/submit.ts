// Turns the tagged rows into sessions and attempts (FR-3.2.2–3.2.6). Only rows are
// written: file name, fingerprint, length and tags. The clip itself is registered in
// clips.ts (memory of this tab) and never sent anywhere.

import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../../../api/errors'
import {
  createSession,
  createStudyAttempts,
  dataError,
  deleteSession,
  ensureSubject,
  type StudyAttemptResult,
  type StudyClipInput,
} from '../../../data/repo'
import type { AttemptRow } from '../../../data/schema'
import { findSession, type ImportSource, type SessionGroup, type SessionLike } from './model'

export type RowOutcome =
  | { ok: true; attempt: AttemptRow }
  /** `duplicate`: the library already has this file, so no row could be created. */
  | { ok: false; duplicate: boolean; message: string }

const ATTEMPT_COLS =
  'id, owner_id, session_id, source, label, clip_name, video_path, video_sha256, duration_s, fps, status, error, created_at'

const DUPLICATE = () =>
  new ApiError(409, 'duplicate_clip', 'This clip is already in your library.', 'Open the earlier import, or delete it to import again.')

/**
 * Attempts for a personal video that stays on the device: source 'user_upload' with no
 * video_path (the optional backup upload isn't built). The repo only has the study
 * variant, so this mirrors it one row at a time; the unique (owner, SHA-256) index
 * answers 23505 for a repeated file.
 */
async function createOwnAttempts(db: SupabaseClient, sessionId: string, clips: StudyClipInput[]): Promise<StudyAttemptResult[]> {
  const out: StudyAttemptResult[] = []
  for (const clip of clips) {
    const row = {
      session_id: sessionId,
      source: 'user_upload' as const,
      clip_name: clip.clip_name,
      video_path: null,
      video_sha256: clip.video_sha256,
      duration_s: clip.duration_s,
      status: 'queued' as const,
    }
    const res = await db.from('attempts').insert(row).select(ATTEMPT_COLS).single()
    if (!res.error) out.push({ clip, outcome: 'created', attempt: res.data as AttemptRow })
    else if ((res.error as { code?: string }).code === '23505') {
      out.push({ clip, outcome: 'duplicate', existing_attempt_id: null, error: DUPLICATE() })
    } else out.push({ clip, outcome: 'failed', error: dataError(res.error, undefined, res.status) })
  }
  return out
}

const sentence = (e: ApiError) => [e.message, e.recovery].filter(Boolean).join(' ')

/**
 * Creates (or joins) one session per group and one attempt per clip. Never throws:
 * every row gets an outcome, so the screen can say exactly which clips were not added.
 */
export async function createImport(
  db: SupabaseClient,
  source: ImportSource,
  groups: readonly SessionGroup[],
  sessions: readonly SessionLike[],
): Promise<Map<string, RowOutcome>> {
  const outcomes = new Map<string, RowOutcome>()
  for (const group of groups) {
    let createdSessionId: string | null = null
    let created = 0
    try {
      const subjectId = group.subject ? (await ensureSubject(db, group.subject)).id : null
      let sessionId = findSession(sessions, group)?.id ?? null
      if (!sessionId) {
        const session = await createSession(db, {
          movement_type: group.movement,
          subject_id: subjectId,
          recorded_on: group.recordedOn,
          camera_view: group.view,
        })
        sessionId = createdSessionId = session.id
      }
      const clips: StudyClipInput[] = group.rows.map((r) => ({ clip_name: r.name, video_sha256: r.sha ?? '', duration_s: r.durationS }))
      const results =
        source === 'study' ? await createStudyAttempts(db, sessionId, clips) : await createOwnAttempts(db, sessionId, clips)
      results.forEach((res, i) => {
        const id = group.rows[i].id
        if (res.outcome === 'created') {
          created++
          outcomes.set(id, { ok: true, attempt: res.attempt })
        } else outcomes.set(id, { ok: false, duplicate: res.outcome === 'duplicate', message: sentence(res.error) })
      })
    } catch (e) {
      const message = sentence(dataError(e))
      for (const row of group.rows) if (!outcomes.has(row.id)) outcomes.set(row.id, { ok: false, duplicate: false, message })
    }
    // A session made for this batch that ended up with no attempts is not left behind.
    if (createdSessionId && created === 0) await deleteSession(db, createdSessionId).catch(() => undefined)
  }
  return outcomes
}

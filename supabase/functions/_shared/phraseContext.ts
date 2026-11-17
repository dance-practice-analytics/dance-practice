// Loads what a phrase payload needs around the attempt: its camera view, the earlier
// sessions of the same movement, view and dancer with their theme values, and the
// dancer's focus themes. Used by generate-feedback and mika-chat with a Supabase client
// built from the caller's JWT, so RLS applies; every query also filters on the caller's
// own id, so another account's rows can't enter even if a policy were wrong.
//
// Only these columns are read: sessions (id, owner_id, movement_type, camera_view,
// subject_id, recorded_on, created_at), attempts (id, session_id), attempt_metrics
// (attempt_id, movement, phrase->themes) and user_preferences (focus_themes). Never a
// title, a note, a label, a clip name, a path or keypoints.

import {
  MAX_ATTEMPTS_PER_SESSION,
  MAX_PROGRESS_SESSIONS,
  progressSessions,
  type PhraseContextInput,
  type PhraseRowLike,
  type SessionMeta,
  // @ts-ignore TS5097: Deno needs the .ts extension
} from './phrase.ts'

/** The part of a Supabase client used here (a structural type, so tests can fake it). */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = { from(table: string): any }

const SESSION_COLUMNS = 'id, owner_id, movement_type, camera_view, subject_id, recorded_on, created_at'
/** Candidate sessions read before the date filter (newest first). */
const MAX_CANDIDATES = 100

type Res<T> = { data: T; error: unknown }

function must<T>(res: Res<T>): T {
  if (res.error) throw new Error('database')
  return res.data
}

export const EMPTY_PHRASE_CONTEXT: PhraseContextInput = { cameraView: null, progress: [], focus: [] }

/** The dancer's focus themes; [] when none are saved or the table can't be read. */
export async function loadFocusThemes(db: Db, uid: string): Promise<unknown[]> {
  try {
    const row = must<{ focus_themes?: unknown } | null>(
      await db.from('user_preferences').select('focus_themes').eq('owner_id', uid).maybeSingle(),
    )
    return Array.isArray(row?.focus_themes) ? row.focus_themes : []
  } catch {
    return []
  }
}

export async function loadPhraseContext(db: Db, uid: string, attemptId: string): Promise<PhraseContextInput> {
  const focus = await loadFocusThemes(db, uid)

  const attempt = must<{ session_id: string } | null>(
    await db.from('attempts').select('session_id').eq('id', attemptId).eq('owner_id', uid).maybeSingle(),
  )
  if (!attempt) return { ...EMPTY_PHRASE_CONTEXT, focus }
  const current = must<SessionMeta | null>(
    await db.from('sessions').select(SESSION_COLUMNS).eq('id', attempt.session_id).eq('owner_id', uid).maybeSingle(),
  )
  if (!current) return { ...EMPTY_PHRASE_CONTEXT, focus }
  const cameraView = current.camera_view
  // Without a known view no earlier session is comparable (progressSessions says the same).
  if (!cameraView || current.movement_type !== 'phrase') return { cameraView, progress: [], focus }

  let query = db
    .from('sessions')
    .select(SESSION_COLUMNS)
    .eq('owner_id', uid)
    .eq('movement_type', 'phrase')
    .eq('camera_view', cameraView)
    .neq('id', current.id)
  query = current.subject_id ? query.eq('subject_id', current.subject_id) : query.is('subject_id', null)
  const candidates = must<SessionMeta[] | null>(await query.order('created_at', { ascending: false }).limit(MAX_CANDIDATES)) ?? []
  const picked = progressSessions({ ...current, owner_id: uid }, candidates, MAX_PROGRESS_SESSIONS)
  if (!picked.length) return { cameraView, progress: [], focus }

  const ids = picked.map((s) => s.id)
  const attempts =
    must<{ id: string; session_id: string }[] | null>(
      await db
        .from('attempts')
        .select('id, session_id')
        .eq('owner_id', uid)
        .in('session_id', ids)
        .order('created_at', { ascending: true })
        .limit(MAX_PROGRESS_SESSIONS * MAX_ATTEMPTS_PER_SESSION),
    ) ?? []
  const attemptIds = attempts.map((a) => a.id)
  const rows = attemptIds.length
    ? (must<{ attempt_id: string; movement: string; themes?: unknown; phrase?: unknown }[] | null>(
        await db.from('attempt_metrics').select('attempt_id, movement, themes:phrase->themes').eq('owner_id', uid).in('attempt_id', attemptIds),
      ) ?? [])
    : []
  // Only the themes are read; they are put back under `phrase` for buildProgress.
  const byAttempt = new Map<string, PhraseRowLike>(rows.map((r) => [r.attempt_id, { movement: r.movement, phrase: { themes: r.themes } }]))

  return {
    cameraView,
    progress: picked.map((s) => ({
      rows: attempts.filter((a) => a.session_id === s.id).flatMap((a) => (byAttempt.has(a.id) ? [byAttempt.get(a.id) as PhraseRowLike] : [])),
    })),
    focus,
  }
}

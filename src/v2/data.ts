// Read hooks for the screens, over src/data/repo.ts. One shared load of the account's
// library (sessions → attempts → metrics) feeds every hook, so screens stay in step;
// it is reloaded after `invalidate()` and whenever the pipeline finishes an attempt.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ApiError } from '../api/errors'
import { dataError, downloadKeypoints, getMetrics, listAttempts, listSessions, listSubjects, type SessionSummary } from '../data/repo'
import type { AttemptMetricsRow, AttemptRow, SubjectRow } from '../data/schema'
import { decodeSeries } from '../pose/codec'
import type { PoseSeries } from '../pose/types'
import { authStore, client } from './auth'
import { cacheSeries, getCachedSeries, onAttemptFinished } from './pipeline'

/** An attempt with its session and its metrics row (null until it has been processed). */
export interface AttemptView extends AttemptRow {
  session: SessionSummary
  metrics: AttemptMetricsRow | null
  /** 1-based position inside its session, in import order ("Attempt 3"). */
  number: number
}

export interface Library {
  /** Newest first. */
  sessions: SessionSummary[]
  /** Newest session first; inside a session in import order. */
  attempts: AttemptView[]
  subjects: SubjectRow[]
}

export interface Loadable<T> {
  /** Null until the first load finishes; kept (stale) while a reload runs. */
  data: T | null
  /** True only while there is nothing to show yet. */
  loading: boolean
  /** True during any load, including a background reload. */
  refreshing: boolean
  /** Dancer-safe; show `error.message` and `error.recovery`. */
  error: ApiError | null
  refetch(): void
}

// ---------- the shared library resource ----------

interface LibraryState {
  uid: string | null
  data: Library | null
  refreshing: boolean
  error: ApiError | null
}

let lib: LibraryState = { uid: null, data: null, refreshing: false, error: null }
const listeners = new Set<() => void>()
let loadSeq = 0

function setLib(next: LibraryState) {
  lib = next
  listeners.forEach((l) => l())
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

async function fetchLibrary(): Promise<Library> {
  const db = client()
  const [sessions, subjects] = await Promise.all([listSessions(db), listSubjects(db)])
  const perSession = await Promise.all(sessions.map((s) => listAttempts(db, s.id)))
  const rows = perSession.flat()
  const metrics = new Map((await getMetrics(db, rows.map((a) => a.id))).map((m) => [m.attempt_id, m]))
  const attempts = sessions.flatMap((session, i) =>
    perSession[i].map((a, n) => ({ ...a, session, metrics: metrics.get(a.id) ?? null, number: n + 1 })),
  )
  return { sessions, attempts, subjects }
}

function load(uid: string): void {
  const seq = ++loadSeq
  // Another account's data is dropped at once; the same account keeps it while reloading.
  setLib({ uid, data: lib.uid === uid ? lib.data : null, refreshing: true, error: null })
  fetchLibrary().then(
    (data) => seq === loadSeq && setLib({ uid, data, refreshing: false, error: null }),
    (e) => seq === loadSeq && setLib({ uid, data: lib.data, refreshing: false, error: dataError(e) }),
  )
}

/** Reloads everything the hooks show. Call it after a write (import, delete, rename). */
export function invalidate(): void {
  const uid = authStore.get().user?.id
  if (uid) load(uid)
}

// A finished attempt has a new status and maybe new metrics.
onAttemptFinished(() => invalidate())

// Signing out (or switching account) empties the cache.
authStore.subscribe(() => {
  const uid = authStore.get().user?.id ?? null
  if (uid !== lib.uid && lib.uid !== null) {
    loadSeq++
    setLib({ uid: null, data: null, refreshing: false, error: null })
  }
})

/** Sessions, attempts (with metrics) and subjects of the signed-in account. */
export function useLibrary(): Loadable<Library> {
  const state = useSyncExternalStore(subscribe, () => lib)
  const uid = useSyncExternalStore(authStore.subscribe, () => authStore.get().user?.id ?? null)
  useEffect(() => {
    if (uid && lib.uid !== uid) load(uid)
  }, [uid])
  const mine = state.uid === uid && uid !== null
  return {
    data: mine ? state.data : null,
    loading: !mine || (state.data === null && state.error === null),
    refreshing: mine ? state.refreshing : true,
    error: mine ? state.error : null,
    refetch: invalidate,
  }
}

function derive<T>(base: Loadable<Library>, data: T | null): Loadable<T> {
  return { data, loading: base.loading, refreshing: base.refreshing, error: base.error, refetch: base.refetch }
}

/** Sessions, newest first, with subject code and attempt count. */
export function useSessions(): Loadable<SessionSummary[]> {
  const base = useLibrary()
  return derive(base, base.data?.sessions ?? null)
}

/** Attempts with their metrics: of one session, or every attempt when no id is given. */
export function useAttempts(sessionId?: string | null): Loadable<AttemptView[]> {
  const base = useLibrary()
  const all = base.data?.attempts ?? null
  const data = useMemo(() => (all && sessionId ? all.filter((a) => a.session_id === sessionId) : all), [all, sessionId])
  return derive(base, data)
}

export function useSubjects(): Loadable<SubjectRow[]> {
  const base = useLibrary()
  return derive(base, base.data?.subjects ?? null)
}

/** The most recently imported attempt that finished processing, for `#/review` without an id. */
export function latestProcessed(attempts: readonly AttemptView[] | null | undefined): AttemptView | null {
  let best: AttemptView | null = null
  for (const a of attempts ?? []) {
    if (a.status === 'done' && (!best || a.created_at > best.created_at)) best = a
  }
  return best
}

// ---------- one attempt with its keypoints ----------

export interface AttemptDetail {
  attempt: AttemptView
  /**
   * The smoothed PoseSeries, or null when no keypoints are saved (not processed yet).
   * Frames inside can still be gaps (`image: null`).
   */
  series: PoseSeries | null
}

interface SeriesState {
  id: string | null
  series: PoseSeries | null
  loading: boolean
  error: ApiError | null
}

/**
 * One attempt with metrics and keypoints. Keypoints come from the in-memory cache when
 * this tab processed the clip, otherwise from the `keypoints` bucket. `data` is null with
 * no error when the id isn't in the library (deleted, or another account's).
 */
export function useAttempt(attemptId: string | null | undefined): Loadable<AttemptDetail> & { notFound: boolean } {
  const base = useLibrary()
  const attempt = useMemo(
    () => base.data?.attempts.find((a) => a.id === attemptId) ?? null,
    [base.data, attemptId],
  )
  const [ks, setKs] = useState<SeriesState>({ id: null, series: null, loading: false, error: null })
  const [tick, setTick] = useState(0)
  const id = attempt?.id ?? null
  const status = attempt?.status ?? null

  useEffect(() => {
    if (!id) return
    const cached = getCachedSeries(id)
    if (cached) return setKs({ id, series: cached, loading: false, error: null })
    // Keypoints only exist once processing has finished.
    if (status !== 'done') return setKs({ id, series: null, loading: false, error: null })
    let live = true
    setKs({ id, series: null, loading: true, error: null })
    downloadKeypoints(client(), id)
      .then(decodeSeries)
      .then(
        (series) => {
          cacheSeries(id, series)
          if (live) setKs({ id, series, loading: false, error: null })
        },
        (e) => {
          if (!live) return
          const error = dataError(e)
          // "Nothing saved yet" is a state of the attempt, not a failure.
          setKs({ id, series: null, loading: false, error: error.status === 404 ? null : error })
        },
      )
    return () => {
      live = false
    }
  }, [id, status, tick])

  const ready = attempt !== null && ks.id === attempt.id && !ks.loading
  return {
    data: attempt && ready ? { attempt, series: ks.series } : null,
    loading: base.loading || (attempt !== null && !ready),
    refreshing: base.refreshing || ks.loading,
    error: base.error ?? (ks.id === id ? ks.error : null),
    notFound: !base.loading && !base.error && !!attemptId && attempt === null,
    refetch: () => {
      base.refetch()
      setTick((n) => n + 1)
    },
  }
}

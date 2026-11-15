// What the account has stored that the shared library hooks don't carry: the keypoint
// files with their recorded size (attempt_keypoints.size_bytes) and the practice notes.
// Only what is recorded is reported; nothing is estimated.

import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiError } from '../../../api/errors'
import { requireUid, selectOwn } from '../../../data/exportData'
import { dataError } from '../../../data/repo'
import { client } from '../../auth'

export interface StorageFacts {
  keypointFiles: number
  /** Sum of the sizes that are recorded. */
  keypointBytes: number
  /** Files whose size was not recorded; they are not part of `keypointBytes`. */
  keypointUnsized: number
  feedbackSets: number
}

export function summarizeStorage(
  keypoints: readonly { size_bytes: number | null }[],
  feedback: readonly unknown[],
): StorageFacts {
  let keypointBytes = 0
  let keypointUnsized = 0
  for (const k of keypoints) {
    if (typeof k.size_bytes === 'number' && Number.isFinite(k.size_bytes) && k.size_bytes >= 0) keypointBytes += k.size_bytes
    else keypointUnsized++
  }
  return { keypointFiles: keypoints.length, keypointBytes, keypointUnsized, feedbackSets: feedback.length }
}

export async function loadStorageFacts(db: SupabaseClient): Promise<StorageFacts> {
  try {
    const uid = await requireUid(db)
    const [keypoints, feedback] = await Promise.all([
      selectOwn<{ attempt_id: string; size_bytes: number | null }>(db, 'attempt_keypoints', 'attempt_id, size_bytes', uid, ['attempt_id']),
      selectOwn<{ id: string }>(db, 'feedback', 'id', uid, ['id']),
    ])
    return summarizeStorage(keypoints, feedback)
  } catch (e) {
    throw dataError(e)
  }
}

export interface StorageFactsState {
  data: StorageFacts | null
  loading: boolean
  error: ApiError | null
  refetch(): void
}

/** Reloads whenever `version` changes (pass the library data, so it follows every invalidate). */
export function useStorageFacts(version: unknown): StorageFactsState {
  const [state, setState] = useState<{ data: StorageFacts | null; loading: boolean; error: ApiError | null }>({
    data: null,
    loading: true,
    error: null,
  })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setState((s) => ({ ...s, loading: true, error: null }))
    loadStorageFacts(client()).then(
      (data) => live && setState({ data, loading: false, error: null }),
      (e) => live && setState((s) => ({ data: s.data, loading: false, error: dataError(e) })),
    )
    return () => {
      live = false
    }
  }, [version, tick])
  return { ...state, refetch: () => setTick((n) => n + 1) }
}

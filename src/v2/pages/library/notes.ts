// The account's latest stored practice notes, for "Next focus" and "Recent notes".
// `listFeedback` in src/feedback/client.ts reads one attempt at a time; a library can
// hold 180 attempts, so this reads the newest notes of the account in one request
// (owner-only RLS) and checks every row against the same contract. Reading stored
// notes never calls the model.

import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isFeedbackResponse } from '../../../../supabase/functions/generate-feedback/contract'
import { ApiError } from '../../../api/errors'
import type { FeedbackNote } from '../../../feedback/client'
import { client, useAuth } from '../../auth'

const NOTES_LIMIT = 30

/** Rows of `feedback` → notes; rows that don't match the contract are skipped. */
export function toNotes(rows: readonly Record<string, unknown>[]): FeedbackNote[] {
  const notes: FeedbackNote[] = []
  for (const r of rows) {
    if (!isFeedbackResponse(r.response)) continue
    notes.push({
      id: String(r.id),
      attemptId: String(r.attempt_id),
      model: String(r.model),
      promptVersion: String(r.prompt_version),
      createdAt: String(r.created_at),
      response: r.response,
    })
  }
  return notes
}

export async function listAccountNotes(supabase: SupabaseClient, limit = NOTES_LIMIT): Promise<FeedbackNote[]> {
  const failed = new ApiError(0, 'list_failed', 'Your saved notes couldn’t be loaded.', 'Check your connection and try again.')
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw failed
  try {
    const res = await supabase
      .from('feedback')
      .select('id, attempt_id, model, prompt_version, created_at, response')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (res.error) throw failed
    return toNotes((res.data ?? []) as Record<string, unknown>[])
  } catch {
    throw failed
  }
}

export interface AccountNotes {
  /** Null until the first load finishes. */
  notes: FeedbackNote[] | null
  loading: boolean
  error: ApiError | null
  refetch(): void
}

// Kept between screens so Dashboard → Library doesn't flash a skeleton.
let cache: { uid: string; notes: FeedbackNote[] } | null = null

export function useAccountNotes(): AccountNotes {
  const uid = useAuth().user?.id ?? null
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<{ notes: FeedbackNote[] | null; error: ApiError | null }>({
    notes: cache && cache.uid === uid ? cache.notes : null,
    error: null,
  })

  useEffect(() => {
    if (!uid) return
    let live = true
    listAccountNotes(client()).then(
      (notes) => {
        cache = { uid, notes }
        if (live) setState({ notes, error: null })
      },
      (error: ApiError) => {
        if (live) setState((s) => ({ notes: s.notes, error }))
      },
    )
    return () => {
      live = false
    }
  }, [uid, tick])

  const refetch = useCallback(() => {
    setState((s) => ({ notes: s.notes, error: null }))
    setTick((n) => n + 1)
  }, [])

  return { notes: state.notes, loading: state.notes === null && state.error === null, error: state.error, refetch }
}

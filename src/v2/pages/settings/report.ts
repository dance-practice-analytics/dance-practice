// A DeleteReport in words (FR-3.9.3, FR-3.9.4): what went, what could not be removed
// and what the browser is not able to remove at all. Pure; the screen prints it as is.
// Storage paths start with the account id, so a file is named by its attempt only.

import { ApiError } from '../../../api/errors'
import type { SupabaseClient } from '@supabase/supabase-js'
import { deleteAllMyData, type DeleteReport, type DeleteTable, type StorageBucket } from '../../../data/deleteData'

export const CONFIRM_WORD = 'DELETE'

export function confirmMatches(typed: string): boolean {
  return typed.trim() === CONFIRM_WORD
}

/** "Delete everything" only runs with the typed word, whatever the button state was. */
export async function runDeleteAll(db: SupabaseClient, typed: string): Promise<DeleteReport> {
  if (!confirmMatches(typed)) {
    throw new ApiError(422, 'not_confirmed', 'Nothing was deleted.', `Type ${CONFIRM_WORD} to confirm.`)
  }
  return deleteAllMyData(db)
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const ROW_WORDS: Record<DeleteTable, [one: string, many?: string]> = {
  feedback: ['set of practice notes', 'sets of practice notes'],
  attempt_metrics: ['metrics record'],
  attempt_keypoints: ['keypoint record'],
  attempts: ['attempt'],
  sessions: ['session'],
  consents: ['consent record'],
  subjects: ['subject code'],
}
/** Reading order for a person, not the delete order. */
const ROW_ORDER: DeleteTable[] = ['sessions', 'attempts', 'attempt_keypoints', 'attempt_metrics', 'feedback', 'subjects', 'consents']
const FILE_WORDS: Record<StorageBucket, string> = { keypoints: 'keypoint file', videos: 'stored video' }

export const ACCOUNT_REMAINS_TEXT =
  'Your sign-in account and profile (email and role) are still there. To remove them too, use Delete account.'

export interface ReportText {
  title: string
  /** One line per kind of thing removed in this run; empty when nothing was stored. */
  removed: string[]
  /** One line per file that is still stored (or could not be checked). */
  notRemoved: string[]
  /** Attempts left in place on purpose, with what to do. */
  kept: string | null
  /** Scope 'all' only: the account itself. */
  remaining: string | null
  complete: boolean
}

const MAX_FILE_LINES = 5

export function describeReport(report: DeleteReport): ReportText {
  const removed: string[] = []
  for (const table of ROW_ORDER) {
    const n = report.rows[table]
    if (n > 0) removed.push(count(n, ...ROW_WORDS[table]))
  }
  for (const bucket of ['keypoints', 'videos'] as const) {
    const n = report.objects[bucket]
    if (n > 0) removed.push(count(n, FILE_WORDS[bucket]))
  }

  const lines = report.failedObjects.map((f) => {
    const what = FILE_WORDS[f.bucket]
    if (f.path.endsWith('/')) return `Your ${what}s couldn’t be checked after the delete, so some may still be stored.`
    const attempt = (f.path.split('/').pop() ?? '').split('.')[0].slice(0, 8)
    return `The ${what} of attempt ${attempt}… is still stored. ${f.message}`
  })
  const notRemoved = lines.slice(0, MAX_FILE_LINES)
  if (lines.length > MAX_FILE_LINES) notRemoved.push(`…and ${count(lines.length - MAX_FILE_LINES, 'more file')}.`)

  const kept =
    report.keptAttempts.length > 0
      ? `${count(report.keptAttempts.length, 'attempt was', 'attempts were')} left in place because a stored file couldn’t be removed. Delete again to finish.`
      : null

  const what = report.scope === 'all' ? 'Your data' : report.scope === 'session' ? 'The session' : 'The attempt'
  let title: string
  if (!report.complete) title = removed.length > 0 ? `${what} was only partly deleted` : `${what} couldn’t be deleted`
  else if (removed.length === 0) title = 'There was nothing left to delete'
  else title = report.scope === 'all' ? 'Your data was deleted' : `${what} was deleted`

  return {
    title,
    removed,
    notRemoved,
    kept,
    remaining: report.scope === 'all' ? ACCOUNT_REMAINS_TEXT : null,
    complete: report.complete,
  }
}

// Contract of the delete-account Edge Function (FR-3.9.x), shared with the browser
// (src/data/deleteData.ts). No imports, so both Deno and Vite can load it.

export const FUNCTION_NAME = 'delete-account'

/** The word the user types; the function checks it again. */
export const CONFIRM_WORD = 'DELETE'

export const ACCOUNT_BUCKETS = ['keypoints', 'videos'] as const
export type AccountBucket = (typeof ACCOUNT_BUCKETS)[number]

/** Every table with an owner_id. All of them cascade from auth.users (see the init migration). */
export const ACCOUNT_TABLES = [
  'profiles',
  'subjects',
  'consents',
  'sessions',
  'attempts',
  'attempt_keypoints',
  'attempt_metrics',
  'feedback',
] as const
export type AccountTable = (typeof ACCOUNT_TABLES)[number]

export interface DeleteAccountRequest {
  confirm: typeof CONFIRM_WORD
}

/** What the function removed. The account is gone when this comes back. */
export interface DeleteAccountReport {
  deleted: true
  /** Rows the account owned; they go with the auth user through ON DELETE CASCADE. */
  rows: Record<AccountTable, number>
  /** Stored files removed from the user's folder of each bucket. */
  objects: Record<AccountBucket, number>
  /** Rows still found after the auth user was deleted: 0 when the cascade did its job, null if not checked. */
  rows_left: number | null
}

export type FailureCode =
  | 'method_not_allowed'
  | 'bad_request'
  | 'not_confirmed'
  | 'unauthorized'
  | 'not_configured'
  | 'storage_incomplete'
  | 'delete_failed'

export interface Failure {
  status: number
  message: string
  recovery: string
}

/** Dancer-safe copy; the client shows this table, not text from the response. */
export const FAILURES: Record<FailureCode, Failure> = {
  method_not_allowed: { status: 405, message: 'That request isn’t supported.', recovery: 'Reload the app and try again.' },
  bad_request: { status: 400, message: 'That request couldn’t be read.', recovery: 'Reload the app and try again.' },
  not_confirmed: { status: 422, message: 'Nothing was deleted.', recovery: `Type ${CONFIRM_WORD} to confirm.` },
  unauthorized: { status: 401, message: 'Your sign-in has expired, so nothing was deleted.', recovery: 'Sign in again, then delete the account.' },
  not_configured: { status: 503, message: 'Account deletion isn’t set up on the server.', recovery: 'Ask the project team to remove the account.' },
  storage_incomplete: {
    status: 500,
    message: 'Some stored files couldn’t be removed, so the account was kept.',
    recovery: 'Try again in a moment. Nothing else was deleted.',
  },
  delete_failed: {
    status: 500,
    message: 'The account couldn’t be deleted.',
    recovery: 'Try again in a moment. If it keeps failing, ask the project team.',
  },
}

export interface DeleteAccountErrorBody {
  error: { code: FailureCode; message: string; recovery: string; remaining_objects?: number }
}

export function errorBody(code: FailureCode, extra: { remaining_objects?: number } = {}): DeleteAccountErrorBody {
  const f = FAILURES[code]
  return { error: { code, message: f.message, recovery: f.recovery, ...extra } }
}

export function isDeleteAccountReport(value: unknown): value is DeleteAccountReport {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const rows = v.rows as Record<string, unknown> | undefined
  const objects = v.objects as Record<string, unknown> | undefined
  return (
    v.deleted === true &&
    (typeof v.rows_left === 'number' || v.rows_left === null) &&
    typeof rows === 'object' && rows !== null &&
    ACCOUNT_TABLES.every((t) => typeof rows[t] === 'number') &&
    typeof objects === 'object' && objects !== null &&
    ACCOUNT_BUCKETS.every((b) => typeof objects[b] === 'number')
  )
}

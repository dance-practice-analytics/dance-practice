// Request flow of delete-account with every side effect behind `Deps`, so it runs under
// Vitest with a fake database. index.ts supplies the real calls (service role).
//
// Order, and why:
// 1. Who is asking comes only from the verified JWT; the body carries no user id.
// 2. Rows are counted for the report before anything changes.
// 3. Stored files go first: the database cascade does not reach Storage, and once the
//    user is gone nothing would point at them. Each folder is listed again afterwards;
//    if a file is left, the account is kept so the user can simply try again.
// 4. The auth user is deleted; every table cascades from auth.users.
// 5. Rows are counted again to confirm the cascade.

import {
  ACCOUNT_BUCKETS,
  ACCOUNT_TABLES,
  CONFIRM_WORD,
  FAILURES,
  errorBody,
  type AccountBucket,
  type AccountTable,
  type DeleteAccountErrorBody,
  type DeleteAccountReport,
  type FailureCode,
  // @ts-ignore TS5097: Deno needs the .ts extension
} from './contract.ts'

export interface ListedEntry {
  name: string
  /** Storage lists a sub-folder as an entry without an id. */
  folder: boolean
}

export interface Deps {
  /** The user id of a valid access token, or null. */
  userId(): Promise<string | null>
  countRows(table: AccountTable, uid: string): Promise<number>
  /** One page of a folder's entries (non-recursive). */
  list(bucket: AccountBucket, folder: string, offset: number, limit: number): Promise<ListedEntry[]>
  remove(bucket: AccountBucket, paths: string[]): Promise<void>
  deleteUser(uid: string): Promise<void>
  /** Codes and counts only: no ids, emails or paths. */
  log(code: string, detail?: string): void
}

export interface HandlerResult {
  status: number
  body: DeleteAccountReport | DeleteAccountErrorBody
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A user id is the only thing that scopes the storage prefix, so it must be a real uuid. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export function parseRequest(body: unknown): { ok: true } | { ok: false; code: FailureCode } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, code: 'bad_request' }
  const confirm = (body as Record<string, unknown>).confirm
  return typeof confirm === 'string' && confirm.trim() === CONFIRM_WORD ? { ok: true } : { ok: false, code: 'not_confirmed' }
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Paths strictly inside `{uid}/`; anything else is dropped, never removed. */
export function insideFolder(uid: string, paths: readonly string[]): string[] {
  const own = `${uid}/`
  return paths.filter((p) => p.startsWith(own) && p.length > own.length && !p.split('/').includes('..'))
}

export const PAGE = 1000
/** Storage's remove takes a list; keep each call small. */
export const REMOVE_BATCH = 100
/** Paths are {uid}/{file}; a little depth covers anything an older build left. */
export const MAX_DEPTH = 4

/** Every file path under `folder`, walking sub-folders. */
export async function listFiles(deps: Deps, bucket: AccountBucket, folder: string, depth = 0): Promise<string[]> {
  const files: string[] = []
  for (let offset = 0; ; offset += PAGE) {
    const page = await deps.list(bucket, folder, offset, PAGE)
    for (const e of page) {
      if (!e.name) continue
      const path = `${folder}/${e.name}`
      if (!e.folder) files.push(path)
      else if (depth < MAX_DEPTH) files.push(...(await listFiles(deps, bucket, path, depth + 1)))
    }
    if (page.length < PAGE) return files
  }
}

const fail = (code: FailureCode, extra: { remaining_objects?: number } = {}): HandlerResult => ({
  status: FAILURES[code].status,
  body: errorBody(code, extra),
})

async function countAll(deps: Deps, uid: string): Promise<Record<AccountTable, number>> {
  const counts = await Promise.all(ACCOUNT_TABLES.map((t) => deps.countRows(t, uid)))
  return Object.fromEntries(ACCOUNT_TABLES.map((t, i) => [t, counts[i]])) as Record<AccountTable, number>
}

export async function handleDeleteAccount(method: string, body: unknown, deps: Deps): Promise<HandlerResult> {
  if (method !== 'POST') return fail('method_not_allowed')
  const request = parseRequest(body)
  if (!request.ok) return fail(request.code)

  const uid = await deps.userId().catch(() => null)
  if (!isUuid(uid)) return fail('unauthorized')

  let rows: Record<AccountTable, number>
  try {
    rows = await countAll(deps, uid)
  } catch (e) {
    deps.log('count_failed', e instanceof Error ? e.message : undefined)
    return fail('delete_failed')
  }

  const objects = { keypoints: 0, videos: 0 } as Record<AccountBucket, number>
  let remaining = 0
  for (const bucket of ACCOUNT_BUCKETS) {
    try {
      const found = insideFolder(uid, await listFiles(deps, bucket, uid))
      for (const batch of chunk(found, REMOVE_BATCH)) await deps.remove(bucket, batch)
      // Storage reports success for paths it skipped, so the folder is checked again.
      const left = insideFolder(uid, await listFiles(deps, bucket, uid))
      objects[bucket] = found.length - left.filter((p) => found.includes(p)).length
      remaining += left.length
    } catch (e) {
      deps.log('storage_failed', `${bucket} ${e instanceof Error ? e.message : ''}`)
      return fail('storage_incomplete')
    }
  }
  if (remaining > 0) {
    deps.log('storage_incomplete', String(remaining))
    return fail('storage_incomplete', { remaining_objects: remaining })
  }

  try {
    await deps.deleteUser(uid)
  } catch (e) {
    deps.log('delete_user_failed', e instanceof Error ? e.message : undefined)
    return fail('delete_failed')
  }

  // The user is gone either way; a failed recount is logged, not shown as a failure.
  let rowsLeft: number | null = null
  try {
    const after = await countAll(deps, uid)
    rowsLeft = ACCOUNT_TABLES.reduce((n, t) => n + after[t], 0)
    if (rowsLeft > 0) deps.log('rows_left', String(rowsLeft))
  } catch {
    deps.log('recount_failed')
  }

  return { status: 200, body: { deleted: true, rows, objects, rows_left: rowsLeft } }
}

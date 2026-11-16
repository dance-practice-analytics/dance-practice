// Unit tests of the delete-account Edge Function's pure flow (handler.ts with a fake
// database and storage) and of the browser helper deleteAccount. No network.

import { describe, expect, it } from 'vitest'
import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import {
  ACCOUNT_TABLES,
  CONFIRM_WORD,
  FAILURES,
  isDeleteAccountReport,
  type AccountBucket,
  type AccountTable,
  type DeleteAccountReport,
} from '../../supabase/functions/delete-account/contract'
import {
  MAX_DEPTH,
  REMOVE_BATCH,
  chunk,
  handleDeleteAccount,
  insideFolder,
  isUuid,
  parseRequest,
  type Deps,
} from '../../supabase/functions/delete-account/handler'
import { accountDeletionError, deleteAccount } from './deleteData'

const ME = '11111111-2222-4333-8444-555555555555'
const OTHER = '99999999-8888-4777-8666-555555555555'

/** Fake Storage + tables. Files are full paths; folders are implied by '/'. */
function fake(opts: { files?: Partial<Record<AccountBucket, string[]>>; rows?: Partial<Record<AccountTable, number>> } = {}) {
  const files: Record<AccountBucket, Set<string>> = {
    keypoints: new Set(opts.files?.keypoints ?? []),
    videos: new Set(opts.files?.videos ?? []),
  }
  const rows: Record<AccountTable, number> = Object.fromEntries(ACCOUNT_TABLES.map((t) => [t, opts.rows?.[t] ?? 0])) as Record<
    AccountTable,
    number
  >
  const log: string[] = []
  const state = { userDeleted: false, stuck: new Set<string>(), uid: ME as string | null, failDelete: false }
  const deps: Deps = {
    userId: async () => state.uid,
    countRows: async (t, uid) => (uid === ME && !state.userDeleted ? rows[t] : 0),
    list: async (bucket, folder, offset, limit) => {
      const prefix = `${folder}/`
      const names = new Map<string, boolean>()
      for (const p of files[bucket]) {
        if (!p.startsWith(prefix)) continue
        const rest = p.slice(prefix.length)
        const [head, ...tail] = rest.split('/')
        names.set(head, tail.length > 0 || (names.get(head) ?? false))
      }
      return [...names.entries()].sort().slice(offset, offset + limit).map(([name, folder]) => ({ name, folder }))
    },
    remove: async (bucket, paths) => {
      log.push(`remove:${bucket}:${paths.length}`)
      for (const p of paths) if (!state.stuck.has(p)) files[bucket].delete(p)
    },
    deleteUser: async (uid) => {
      log.push(`deleteUser:${uid === ME}`)
      if (state.failDelete) throw new Error('boom')
      state.userDeleted = true
    },
    log: (code) => log.push(`log:${code}`),
  }
  return { deps, files, rows, log, state }
}

const POST = (deps: Deps, body: unknown = { confirm: CONFIRM_WORD }) => handleDeleteAccount('POST', body, deps)

describe('delete-account handler (FR-3.9.x)', () => {
  it('removes the caller’s files, then the auth user, and reports what went', async () => {
    const f = fake({
      files: {
        keypoints: [`${ME}/a1.json.gz`, `${ME}/a2.json.gz`, `${OTHER}/x.json.gz`],
        videos: [`${ME}/a3.mp4`],
      },
      rows: { profiles: 1, sessions: 2, attempts: 3, attempt_metrics: 2, consents: 2, subjects: 1 },
    })
    const res = await POST(f.deps)
    expect(res.status).toBe(200)
    expect(isDeleteAccountReport(res.body)).toBe(true)
    const report = res.body as DeleteAccountReport
    expect(report.objects).toEqual({ keypoints: 2, videos: 1 })
    expect(report.rows.attempts).toBe(3)
    expect(report.rows.profiles).toBe(1)
    expect(report.rows_left).toBe(0)
    // Another user's file is never touched.
    expect([...f.files.keypoints]).toEqual([`${OTHER}/x.json.gz`])
    // Files go before the user.
    expect(f.log.indexOf('deleteUser:true')).toBeGreaterThan(f.log.indexOf('remove:videos:1'))
  })

  it('walks sub-folders and removes in batches', async () => {
    const many = Array.from({ length: REMOVE_BATCH + 5 }, (_, i) => `${ME}/k${String(i).padStart(4, '0')}.json.gz`)
    const f = fake({ files: { keypoints: [...many, `${ME}/old/nested.json.gz`] } })
    const res = await POST(f.deps)
    expect(res.status).toBe(200)
    expect((res.body as DeleteAccountReport).objects.keypoints).toBe(many.length + 1)
    expect(f.log.filter((l) => l.startsWith('remove:keypoints'))).toEqual([`remove:keypoints:${REMOVE_BATCH}`, 'remove:keypoints:6'])
    expect(MAX_DEPTH).toBeGreaterThan(0)
  })

  it('keeps the account when a file stays behind, so the user can try again', async () => {
    const f = fake({ files: { keypoints: [`${ME}/a1.json.gz`, `${ME}/a2.json.gz`] }, rows: { attempts: 2 } })
    f.state.stuck.add(`${ME}/a2.json.gz`)
    const res = await POST(f.deps)
    expect(res.status).toBe(500)
    expect(res.body).toMatchObject({ error: { code: 'storage_incomplete', remaining_objects: 1 } })
    expect(f.log).not.toContain('deleteUser:true')
    expect(f.state.userDeleted).toBe(false)
  })

  it('needs the typed word, a POST and a valid user before doing anything', async () => {
    const f = fake({ files: { keypoints: [`${ME}/a1.json.gz`] } })
    expect((await handleDeleteAccount('GET', null, f.deps)).status).toBe(405)
    expect((await POST(f.deps, null)).body).toMatchObject({ error: { code: 'bad_request' } })
    expect((await POST(f.deps, { confirm: 'delete' })).body).toMatchObject({ error: { code: 'not_confirmed' } })
    f.state.uid = null
    expect((await POST(f.deps)).status).toBe(401)
    // A user id that isn't a uuid would make the storage prefix unsafe.
    f.state.uid = ''
    expect((await POST(f.deps)).body).toMatchObject({ error: { code: 'unauthorized' } })
    expect(f.log).toEqual([])
    expect(f.files.keypoints.size).toBe(1)
  })

  it('reports a failed auth delete without claiming success', async () => {
    const f = fake()
    f.state.failDelete = true
    const res = await POST(f.deps)
    expect(res.status).toBe(500)
    expect(res.body).toMatchObject({ error: { code: 'delete_failed' } })
  })

  it('pure helpers', () => {
    expect(isUuid(ME)).toBe(true)
    expect(isUuid('../x')).toBe(false)
    expect(parseRequest({ confirm: ' DELETE ' })).toEqual({ ok: true })
    expect(parseRequest([])).toEqual({ ok: false, code: 'bad_request' })
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]])
    expect(insideFolder(ME, [`${ME}/a`, `${OTHER}/b`, `${ME}/`, `${ME}/../${OTHER}/c`, ME])).toEqual([`${ME}/a`])
  })
})

/** A client whose functions.invoke answers like supabase-js does. */
function invoking(answer: { data?: unknown; status?: number; body?: unknown }) {
  const calls: { name: string; body: unknown }[] = []
  const client = {
    functions: {
      invoke: async (name: string, opts: { body: unknown }) => {
        calls.push({ name, body: opts.body })
        if (answer.status && answer.status >= 400) {
          const res = new Response(JSON.stringify(answer.body ?? {}), { status: answer.status })
          return { data: null, error: new FunctionsHttpError(res) }
        }
        return { data: answer.data, error: null }
      },
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

describe('deleteAccount (browser)', () => {
  const report: DeleteAccountReport = {
    deleted: true,
    rows: Object.fromEntries(ACCOUNT_TABLES.map((t) => [t, 1])) as Record<AccountTable, number>,
    objects: { keypoints: 2, videos: 0 },
    rows_left: 0,
  }

  it('sends only the typed word and returns the report', async () => {
    const { client, calls } = invoking({ data: report })
    await expect(deleteAccount(client, 'DELETE')).resolves.toEqual(report)
    expect(calls).toEqual([{ name: 'delete-account', body: { confirm: 'DELETE' } }])
  })

  it('maps the function’s error codes to its own safe copy', async () => {
    const { client } = invoking({ status: 500, body: { error: { code: 'storage_incomplete', message: 'raw text' } } })
    const e = await deleteAccount(client, 'DELETE').catch((x) => x)
    expect(e.code).toBe('storage_incomplete')
    expect(e.message).toBe(FAILURES.storage_incomplete.message)
  })

  it('reads a platform answer without our body', () => {
    expect(accountDeletionError(401, null).code).toBe('unauthorized')
    expect(accountDeletionError(404, 'not found').code).toBe('not_configured')
    expect(accountDeletionError(502, null).code).toBe('delete_failed')
  })

  it('does not trust a 2xx without a report', async () => {
    const { client } = invoking({ data: { ok: true } })
    expect((await deleteAccount(client, 'DELETE').catch((x) => x)).code).toBe('unexpected_response')
  })
})

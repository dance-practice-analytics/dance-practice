import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../../../api/errors'
import type { DeleteReport } from '../../../data/deleteData'
import { ACCOUNT_REMAINS_TEXT, CONFIRM_WORD, confirmMatches, describeReport, runDeleteAll } from './report'
import { summarizeStorage } from './storage'

// ---------- a small in-memory Supabase stand-in (synthetic data only) ----------

type Row = Record<string, unknown>
const UID = '00000000-0000-4000-8000-0000000000aa'
const OTHER = '00000000-0000-4000-8000-0000000000bb'

class FakeDb {
  tables: Record<string, Row[]> = {}
  objects = new Set<string>()
  /** Objects the storage policy silently refuses to remove. */
  stuck = new Set<string>()
  deletes: string[] = []

  client(): SupabaseClient {
    const db = this
    const query = (table: string) => {
      let op: 'select' | 'delete' = 'select'
      const filters: ((r: Row) => boolean)[] = []
      const q = {
        select: () => q,
        delete: () => ((op = 'delete'), q),
        eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
        in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), q),
        order: () => q,
        range: () => q,
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => {
          const rows = (db.tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
          if (op === 'delete') {
            db.deletes.push(table)
            db.tables[table] = (db.tables[table] ?? []).filter((r) => !rows.includes(r))
            return Promise.resolve({ data: null, error: null, status: 204, count: rows.length }).then(ok, fail)
          }
          return Promise.resolve({ data: rows, error: null, status: 200 }).then(ok, fail)
        },
      }
      return q
    }
    return {
      auth: { getSession: async () => ({ data: { session: { user: { id: UID } } }, error: null }) },
      from: query,
      storage: {
        from: (bucket: string) => ({
          list: async (folder: string) => ({
            data: [...db.objects]
              .filter((k) => k.startsWith(`${bucket}/${folder}/`))
              .map((k) => ({ name: k.slice(bucket.length + folder.length + 2), id: k })),
            error: null,
          }),
          remove: async (paths: string[]) => {
            const gone = paths.filter((p) => !db.stuck.has(`${bucket}/${p}`) && db.objects.delete(`${bucket}/${p}`))
            return { data: gone.map((name) => ({ name })), error: null }
          },
        }),
      },
    } as unknown as SupabaseClient
  }
}

function seed(): FakeDb {
  const db = new FakeDb()
  const own = { owner_id: UID }
  db.tables = {
    subjects: [{ id: 'sub1', ...own, subject_code: 'S01' }],
    sessions: [
      { id: 'ses1', ...own },
      { id: 'ses2', ...own },
      { id: 'ses9', owner_id: OTHER },
    ],
    attempts: [
      { id: 'a1', ...own, session_id: 'ses1', video_path: null, created_at: '1' },
      { id: 'a2', ...own, session_id: 'ses1', video_path: null, created_at: '2' },
      { id: 'a3', ...own, session_id: 'ses2', video_path: null, created_at: '3' },
      { id: 'a9', owner_id: OTHER, session_id: 'ses9', video_path: null, created_at: '4' },
    ],
    attempt_keypoints: [
      { attempt_id: 'a1', ...own },
      { attempt_id: 'a2', ...own },
    ],
    attempt_metrics: [
      { attempt_id: 'a1', ...own },
      { attempt_id: 'a2', ...own },
    ],
    feedback: [{ id: 'f1', attempt_id: 'a1', ...own }],
    consents: [
      { id: 'c1', ...own },
      { id: 'c2', ...own },
      { id: 'c3', ...own },
    ],
    profiles: [{ id: UID, ...own, role: 'dancer' }],
  }
  db.objects.add(`keypoints/${UID}/a1.json.gz`)
  db.objects.add(`keypoints/${UID}/a2.json.gz`)
  db.objects.add(`keypoints/${OTHER}/a9.json.gz`)
  return db
}

const report = (change: Partial<DeleteReport> = {}): DeleteReport => ({
  scope: 'attempt',
  rows: { feedback: 0, attempt_metrics: 0, attempt_keypoints: 0, attempts: 0, sessions: 0, consents: 0, subjects: 0 },
  objects: { keypoints: 0, videos: 0 },
  failedObjects: [],
  keptAttempts: [],
  complete: true,
  remaining: [],
  ...change,
})

describe('typed confirmation', () => {
  it('accepts only the word, ignoring outer spaces', () => {
    expect(confirmMatches(CONFIRM_WORD)).toBe(true)
    expect(confirmMatches(' DELETE ')).toBe(true)
    for (const typed of ['', 'delete', 'DELET', 'DELETE!', 'DELETE everything']) expect(confirmMatches(typed)).toBe(false)
  })

  it('deletes nothing without it', async () => {
    const db = seed()
    await expect(runDeleteAll(db.client(), 'delete')).rejects.toMatchObject({ code: 'not_confirmed' })
    await expect(runDeleteAll(db.client(), '')).rejects.toBeInstanceOf(ApiError)
    expect(db.deletes).toEqual([])
    expect(db.objects.size).toBe(3)
    expect(db.tables.attempts).toHaveLength(4)
  })
})

describe('delete everything, start to finish', () => {
  it('removes the account’s files and rows, leaves other accounts and the profile, and says so', async () => {
    const db = seed()
    const result = await runDeleteAll(db.client(), 'DELETE')

    expect(result.complete).toBe(true)
    expect(result.rows).toEqual({ feedback: 1, attempt_metrics: 2, attempt_keypoints: 2, attempts: 3, sessions: 2, consents: 3, subjects: 1 })
    expect(result.objects.keypoints).toBe(2)
    expect([...db.objects]).toEqual([`keypoints/${OTHER}/a9.json.gz`])
    expect(db.tables.attempts).toEqual([expect.objectContaining({ id: 'a9' })])
    expect(db.tables.profiles).toHaveLength(1)
    expect(db.deletes).not.toContain('profiles')

    const text = describeReport(result)
    expect(text.title).toBe('Your data was deleted')
    expect(text.removed).toEqual([
      '2 sessions',
      '3 attempts',
      '2 keypoint records',
      '2 metrics records',
      '1 set of practice notes',
      '1 subject code',
      '3 consent records',
      '2 keypoint files',
    ])
    expect(text.notRemoved).toEqual([])
    expect(text.remaining).toBe(ACCOUNT_REMAINS_TEXT)
    expect(text.remaining).toMatch(/sign-in account and profile .* still there/)
  })

  it('reports a file that is still stored as a partial delete, without printing the account id', async () => {
    const db = seed()
    db.stuck.add(`keypoints/${UID}/a2.json.gz`)
    const result = await runDeleteAll(db.client(), 'DELETE')

    expect(result.complete).toBe(false)
    expect(result.failedObjects).toHaveLength(1)
    const text = describeReport(result)
    expect(text.title).toBe('Your data was only partly deleted')
    expect(text.complete).toBe(false)
    expect(text.removed).toContain('1 keypoint file')
    expect(text.notRemoved).toHaveLength(1)
    expect(text.notRemoved[0]).toMatch(/keypoint file of attempt a2… is still stored/)
    expect(JSON.stringify(text)).not.toContain(UID)
  })

  it('a second run on an empty account removes nothing and says that', async () => {
    const db = seed()
    await runDeleteAll(db.client(), 'DELETE')
    const text = describeReport(await runDeleteAll(db.client(), 'DELETE'))
    expect(text.removed).toEqual([])
    expect(text.title).toBe('There was nothing left to delete')
    expect(text.remaining).toBe(ACCOUNT_REMAINS_TEXT)
  })
})

describe('describeReport', () => {
  it('one attempt: singular words and no account note', () => {
    const text = describeReport(
      report({ rows: { ...report().rows, attempts: 1, attempt_metrics: 1, attempt_keypoints: 1 }, objects: { keypoints: 1, videos: 0 } }),
    )
    expect(text.title).toBe('The attempt was deleted')
    expect(text.removed).toEqual(['1 attempt', '1 keypoint record', '1 metrics record', '1 keypoint file'])
    expect(text.remaining).toBeNull()
    expect(text.kept).toBeNull()
  })

  it('an attempt kept because its file is stuck', () => {
    const text = describeReport(
      report({
        complete: false,
        keptAttempts: ['abcdef12-0000'],
        failedObjects: [{ bucket: 'keypoints', path: `${UID}/abcdef12-0000.json.gz`, code: 'not_removed', message: 'This file is still stored.' }],
      }),
    )
    expect(text.title).toBe('The attempt couldn’t be deleted')
    expect(text.kept).toMatch(/^1 attempt was left in place/)
    expect(text.notRemoved[0]).toContain('abcdef12…')
  })

  it('a folder that could not be checked, and a long list is cut with a count', () => {
    const failedObjects = [
      { bucket: 'videos' as const, path: `${UID}/`, code: 'network', message: 'x' },
      ...Array.from({ length: 7 }, (_, i) => ({ bucket: 'keypoints' as const, path: `${UID}/a${i}.json.gz`, code: 'not_removed', message: 'This file is still stored.' })),
    ]
    const text = describeReport(report({ scope: 'all', complete: false, failedObjects }))
    expect(text.notRemoved[0]).toMatch(/stored videos couldn’t be checked/)
    expect(text.notRemoved).toHaveLength(6)
    expect(text.notRemoved[5]).toBe('…and 3 more files.')
  })
})

describe('summarizeStorage', () => {
  it('adds the recorded sizes and counts the files without one, never guessing', () => {
    expect(summarizeStorage([{ size_bytes: 1000 }, { size_bytes: null }, { size_bytes: 24 }], [1, 2])).toEqual({
      keypointFiles: 3,
      keypointBytes: 1024,
      keypointUnsized: 1,
      feedbackSets: 2,
    })
    expect(summarizeStorage([], [])).toEqual({ keypointFiles: 0, keypointBytes: 0, keypointUnsized: 0, feedbackSets: 0 })
  })
})

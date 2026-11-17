import 'fake-indexeddb/auto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { idbGetAll } from './idb'
import {
  bindQueue,
  clearQueue,
  flushQueue,
  isRetryableSaveError,
  offlineStore,
  onUploaded,
  saveOrQueue,
  type PendingUpload,
  type ProcessedResult,
} from './uploadQueue'

// ---------- a fake Supabase client: just the calls saveResult makes ----------

type Mode = 'ok' | 'offline' | 'permission' | 'gone'

interface Fake {
  client: SupabaseClient
  mode: Mode
  uid: string
  uploads: string[]
  metrics: string[]
  statuses: [string, string][]
}

function fakeClient(uid = 'user-a'): Fake {
  const f: Fake = { client: null as unknown as SupabaseClient, mode: 'ok', uid, uploads: [], metrics: [], statuses: [] }
  const failure = () => {
    if (f.mode === 'offline') throw new TypeError('Failed to fetch')
    if (f.mode === 'permission') return { data: null, error: { code: '42501', message: 'denied' }, status: 403 }
    if (f.mode === 'gone') return { data: null, error: { code: '23503', message: 'fk' }, status: 409 }
    return null
  }
  const chain = (table: string) => {
    let payload: Record<string, unknown> = {}
    const done = async () => {
      const bad = failure()
      if (bad) return bad
      if (table === 'attempt_metrics') f.metrics.push(String(payload.attempt_id))
      if (table === 'attempts') f.statuses.push([String(payload.__id), String(payload.status)])
      return { data: { ...payload }, error: null, status: 200 }
    }
    const q = {
      upsert(row: Record<string, unknown>) {
        payload = row
        return q
      },
      update(row: Record<string, unknown>) {
        payload = { ...row }
        return q
      },
      eq(_col: string, value: string) {
        payload.__id = value
        return q
      },
      select() {
        return q
      },
      single: done,
      maybeSingle: done,
    }
    return q
  }
  f.client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: f.uid } } }, error: null }) },
    from: chain,
    storage: {
      from: () => ({
        upload: async (path: string) => {
          const bad = failure()
          if (bad) return bad
          f.uploads.push(path)
          return { data: { path }, error: null }
        },
      }),
    },
  } as unknown as SupabaseClient
  return f
}

// A gzip member header plus a few bytes: the repo only checks the magic number.
const gz = () => new Blob([new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0, 0x03, 0x01, 0x02])], { type: 'application/gzip' })

const result = (attemptId: string, keypoints: Blob = gz()): ProcessedResult => ({
  attemptId,
  keypoints,
  frameCount: 90,
  model: 'full',
  metrics: { movement: 'releve_balance', algorithm_version: 'test', phases: [], confidence: {} } as ProcessedResult['metrics'],
  clipName: 'clip_01.mp4',
})

let fake: Fake

beforeEach(async () => {
  fake = fakeClient()
  bindQueue(() => ({ db: fake.client, uid: fake.uid }))
  await clearQueue()
})

afterEach(() => {
  bindQueue(() => null)
})

describe('offline upload queue (FR-3.8.6)', () => {
  it('saves straight away when the network works', async () => {
    expect(await saveOrQueue({ db: fake.client, uid: 'user-a' }, result('a1'))).toBe('saved')
    expect(fake.uploads).toEqual(['user-a/a1.json.gz'])
    expect(fake.metrics).toEqual(['a1'])
    expect(fake.statuses).toEqual([['a1', 'done']])
    expect(await idbGetAll()).toEqual([])
  })

  it('keeps the result in IndexedDB on a network error', async () => {
    fake.mode = 'offline'
    expect(await saveOrQueue({ db: fake.client, uid: 'user-a' }, result('a1'))).toBe('queued')
    const kept = await idbGetAll<PendingUpload>()
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ attemptId: 'a1', ownerId: 'user-a', frameCount: 90, model: 'full', tries: 0 })
    // Only the gzipped keypoints are kept: the bytes start with the gzip magic number.
    const head = new Uint8Array(kept[0].keypoints.slice(0, 2))
    expect([head[0], head[1]]).toEqual([0x1f, 0x8b])
    expect(offlineStore.get().ids).toEqual(['a1'])
  })

  it('uploads kept results on retry and clears them', async () => {
    fake.mode = 'offline'
    await saveOrQueue({ db: fake.client, uid: 'user-a' }, result('a1'))
    await saveOrQueue({ db: fake.client, uid: 'user-a' }, result('a2'))

    // Still offline: nothing leaves, the entries stay and count a try.
    const stillOffline = await flushQueue()
    expect(stillOffline.uploaded).toEqual([])
    expect(stillOffline.remaining).toBe(2)
    expect(offlineStore.get().lastError?.code).toBe('network')

    fake.mode = 'ok'
    const seen: string[] = []
    const stop = onUploaded((id) => seen.push(id))
    const back = await flushQueue()
    stop()
    expect(back.uploaded.sort()).toEqual(['a1', 'a2'])
    expect(seen.sort()).toEqual(['a1', 'a2'])
    // The same repo path as the live save: the user's own folder.
    expect(fake.uploads.sort()).toEqual(['user-a/a1.json.gz', 'user-a/a2.json.gz'])
    expect(fake.statuses.filter(([, s]) => s === 'done')).toHaveLength(2)
    expect(await idbGetAll()).toEqual([])
    expect(offlineStore.get().ids).toEqual([])
  })

  it('clears every kept result on sign-out, so another account never uploads them', async () => {
    fake.mode = 'offline'
    await saveOrQueue({ db: fake.client, uid: 'user-a' }, result('a1'))
    expect(await idbGetAll()).toHaveLength(1)

    await clearQueue()
    expect(await idbGetAll()).toEqual([])
    expect(offlineStore.get().ids).toEqual([])

    const other = fakeClient('user-b')
    bindQueue(() => ({ db: other.client, uid: other.uid }))
    const r = await flushQueue()
    expect(r.uploaded).toEqual([])
    expect(other.uploads).toEqual([])
  })

  it('never uploads another account’s entries, even if they were left behind', async () => {
    fake.mode = 'offline'
    await saveOrQueue({ db: fake.client, uid: 'user-a' }, result('a1'))
    const other = fakeClient('user-b')
    bindQueue(() => ({ db: other.client, uid: other.uid }))
    const r = await flushQueue()
    expect(r.uploaded).toEqual([])
    expect(other.uploads).toEqual([])
    expect(await idbGetAll()).toHaveLength(1)
  })

  it('does not keep results on permission or validation errors', async () => {
    fake.mode = 'permission'
    await expect(saveOrQueue({ db: fake.client, uid: 'user-a' }, result('a1'))).rejects.toMatchObject({ code: 'permission' })
    expect(await idbGetAll()).toEqual([])

    // A non-gzip blob (a clip handed over by mistake) is refused before any network call.
    fake.mode = 'ok'
    const video = new Blob([new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74])], { type: 'video/mp4' })
    await expect(saveOrQueue({ db: fake.client, uid: 'user-a' }, result('a2', video))).rejects.toMatchObject({ code: 'not_keypoints' })
    expect(await idbGetAll()).toEqual([])
    expect(fake.uploads).toEqual([])
  })

  it('drops a kept result whose attempt was deleted meanwhile', async () => {
    fake.mode = 'offline'
    await saveOrQueue({ db: fake.client, uid: 'user-a' }, result('a1'))
    fake.mode = 'gone'
    const r = await flushQueue()
    expect(r.dropped).toEqual(['a1'])
    expect(await idbGetAll()).toEqual([])
  })

  it('tells network failures from permanent ones', () => {
    expect(isRetryableSaveError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isRetryableSaveError({ status: 503, message: 'unavailable' })).toBe(true)
    expect(isRetryableSaveError({ code: '42501' })).toBe(false)
    expect(isRetryableSaveError({ code: '23514' })).toBe(false)
    expect(isRetryableSaveError({ statusCode: '413' })).toBe(false)
  })
})

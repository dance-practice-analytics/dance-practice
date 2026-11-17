import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../api/errors'
import { baseName, parseClipName, readVideoMeta, sha256Hex } from './clipFile'
import {
  activeConsents,
  createSession,
  createStudyAttempts,
  dataError,
  deleteAttempt,
  deleteSession,
  downloadKeypoints,
  ensureSubject,
  getMetrics,
  grantConsents,
  keypointsPath,
  listAttempts,
  listConsents,
  listSessions,
  listSubjects,
  revokeConsent,
  saveMetrics,
  setAttemptStatus,
  uploadKeypoints,
  type StudyClipInput,
} from './repo'

// ---------- a small in-memory stand-in for the Supabase client (no network) ----------

type Row = Record<string, unknown>
interface Res {
  data: unknown
  error: unknown
  status: number
}

const UID = '00000000-0000-4000-8000-0000000000aa'
const OTHER_UID = '00000000-0000-4000-8000-0000000000bb'
const PK: Record<string, string> = { attempt_keypoints: 'attempt_id', attempt_metrics: 'attempt_id' }

class FakeDb {
  uid: string | null = UID
  tables: Record<string, Row[]> = {}
  objects = new Map<string, Blob>()
  /** Every write that reached the "server", for assertions on what was sent. */
  writes: { table: string; op: string; payload: unknown }[] = []
  uploads: { bucket: string; path: string; body: Blob; options: unknown }[] = []
  removed: { bucket: string; paths: string[] }[] = []
  private failures: (Res | Error)[] = []
  private seq = 0

  /** The next request answers with this error (or throws it). */
  failNext(error: Row | Error, status = 400) {
    this.failures.push(error instanceof Error ? error : { data: null, error, status })
  }
  takeFailure(): Res | null {
    const f = this.failures.shift()
    if (f instanceof Error) throw f
    return f ?? null
  }
  rows(table: string): Row[] {
    return (this.tables[table] ??= [])
  }
  nextId(): string {
    return `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`
  }

  client(): SupabaseClient {
    const db = this
    const fake = {
      auth: {
        getSession: async () => ({ data: { session: db.uid ? { user: { id: db.uid } } : null }, error: null }),
      },
      from: (table: string) => new FakeQuery(db, table),
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string, body: Blob, options: unknown) => {
            const failure = db.takeFailure()
            if (failure) return failure
            db.uploads.push({ bucket, path, body, options })
            db.objects.set(`${bucket}/${path}`, body)
            return { data: { path }, error: null }
          },
          download: async (path: string) => {
            const failure = db.takeFailure()
            if (failure) return failure
            const blob = db.objects.get(`${bucket}/${path}`)
            return blob
              ? { data: blob, error: null }
              : { data: null, error: { message: 'Object not found', status: 400, statusCode: '404' } }
          },
          remove: async (paths: string[]) => {
            const failure = db.takeFailure()
            if (failure) return failure
            db.removed.push({ bucket, paths })
            for (const p of paths) db.objects.delete(`${bucket}/${p}`)
            return { data: [], error: null }
          },
        }),
      },
    }
    return fake as unknown as SupabaseClient
  }
}

class FakeQuery implements PromiseLike<Res> {
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
  private payload: unknown
  private cols = '*'
  private filters: ((r: Row) => boolean)[] = []
  private orders: { col: string; asc: boolean }[] = []
  private one: 'single' | 'maybe' | null = null
  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(cols = '*') {
    if (this.op === 'select') this.cols = cols
    return this
  }
  insert(payload: unknown) {
    this.op = 'insert'
    this.payload = payload
    return this
  }
  upsert(payload: unknown) {
    this.op = 'upsert'
    this.payload = payload
    return this
  }
  update(payload: unknown) {
    this.op = 'update'
    this.payload = payload
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }
  eq(col: string, value: unknown) {
    this.filters.push((r) => r[col] === value)
    return this
  }
  in(col: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[col]))
    return this
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending ?? true })
    return this
  }
  single() {
    this.one = 'single'
    return this
  }
  maybeSingle() {
    this.one = 'maybe'
    return this
  }
  then<A = Res, B = never>(ok?: ((v: Res) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return new Promise<Res>((resolve) => resolve(this.run())).then(ok, fail)
  }

  private run(): Res {
    const failure = this.db.takeFailure()
    if (failure) return failure
    if (this.op !== 'select') this.db.writes.push({ table: this.table, op: this.op, payload: this.payload })
    const out = this.exec()
    if (out.error || !this.one) return out
    const rows = out.data as Row[]
    if (rows.length === 1) return { ...out, data: rows[0] }
    if (rows.length === 0 && this.one === 'maybe') return { ...out, data: null }
    return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, status: 406 }
  }

  /** Row-level security: only the signed-in owner's rows are visible. */
  private visible(): Row[] {
    return this.db.rows(this.table).filter((r) => r.owner_id === this.db.uid && this.filters.every((f) => f(r)))
  }

  private exec(): Res {
    const all = this.db.rows(this.table)
    const pk = PK[this.table] ?? 'id'
    switch (this.op) {
      case 'select': {
        let rows = this.visible().map((r) => ({ ...r }))
        for (const { col, asc } of [...this.orders].reverse()) {
          rows.sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1))
        }
        if (this.table === 'sessions' && this.cols.includes('attempts(count)')) {
          rows = rows.map((r) => ({
            ...r,
            subjects: this.db.rows('subjects').find((s) => s.id === r.subject_id) ?? null,
            attempts: [{ count: this.db.rows('attempts').filter((a) => a.session_id === r.id).length }],
          }))
        }
        return { data: rows, error: null, status: 200 }
      }
      case 'insert':
      case 'upsert': {
        if (!this.db.uid) return rls(401)
        const input = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[]
        const next = [...all]
        const written: Row[] = []
        for (const item of input) {
          const row: Row = {
            ...(pk === 'id' ? { id: this.db.nextId() } : {}),
            owner_id: this.db.uid,
            created_at: new Date(1_800_000_000_000 + next.length).toISOString(),
            ...item,
          }
          const violation = this.constraint(row, next)
          if (violation) return violation
          const at = this.op === 'upsert' ? next.findIndex((r) => r[pk] === row[pk]) : -1
          if (at >= 0) next[at] = row
          else next.push(row)
          written.push(row)
        }
        // All or nothing, like one INSERT statement.
        this.db.tables[this.table] = next
        return { data: written.map((r) => ({ ...r })), error: null, status: 201 }
      }
      case 'update': {
        const rows = this.visible()
        for (const r of rows) Object.assign(r, this.payload)
        return { data: rows.map((r) => ({ ...r })), error: null, status: 200 }
      }
      case 'delete': {
        const rows = this.visible()
        this.db.tables[this.table] = all.filter((r) => !rows.includes(r))
        return { data: rows, error: null, status: 200 }
      }
    }
  }

  private constraint(row: Row, existing: Row[]): Res | null {
    const unique = (cols: string[], name: string): Res | null =>
      existing.some((r) => cols.every((c) => r[c] === row[c]))
        ? { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${name}"` }, status: 409 }
        : null
    if (this.table === 'subjects') {
      if (!/^S[0-9]{2}$/.test(String(row.subject_code))) return check('subjects_subject_code_check')
      return unique(['owner_id', 'subject_code'], 'subjects_owner_id_subject_code_key')
    }
    if (this.table === 'attempts') {
      if (row.source === 'study_dataset' && row.video_path != null) return check('study_no_video')
      if (!this.db.rows('sessions').some((s) => s.id === row.session_id)) {
        return { data: null, error: { code: '23503', message: 'violates foreign key constraint "attempts_session_id_fkey"' }, status: 409 }
      }
      return row.video_sha256 == null ? null : unique(['owner_id', 'video_sha256'], 'attempts_owner_sha')
    }
    return null
  }
}

const rls = (status: number): Res => ({
  data: null,
  error: { code: '42501', message: 'new row violates row-level security policy' },
  status,
})
const check = (name: string): Res => ({
  data: null,
  error: { code: '23514', message: `new row violates check constraint "${name}"` },
  status: 400,
})

// ---------- helpers ----------

const sha = (n: number) => n.toString(16).padStart(64, '0')
const clip = (n: number, extra: Partial<StudyClipInput> = {}): StudyClipInput => ({
  clip_name: `S01_releve_take${n}.mp4`,
  video_sha256: sha(n),
  duration_s: 12.5,
  ...extra,
})
const gzipBlob = (bytes = 64) => {
  const body = new Uint8Array(bytes)
  body.set([0x1f, 0x8b, 0x08, 0x00])
  return new Blob([body], { type: 'application/gzip' })
}

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  )
  expect(e).toBeInstanceOf(ApiError)
  return e as ApiError
}

async function setup() {
  const db = new FakeDb()
  const client = db.client()
  const subject = await ensureSubject(client, 'S01')
  const session = await createSession(client, {
    movement_type: 'releve_balance',
    subject_id: subject.id,
    camera_view: 'front',
    recorded_on: '2026-11-15',
  })
  return { db, client, subject, session }
}

// ---------- subjects ----------

describe('subjects', () => {
  it('rejects codes that are not S plus two digits, before any request', async () => {
    const db = new FakeDb()
    for (const bad of ['', 'S1', 'S001', 'P07', 'SAB', 'S01 extra', 'Ana']) {
      const e = await rejection(ensureSubject(db.client(), bad))
      expect(e.code).toBe('invalid_subject_code')
      expect(e.status).toBe(422)
    }
    expect(db.writes).toHaveLength(0)
  })

  it('ensureSubject returns the same row the second time', async () => {
    const db = new FakeDb()
    const first = await ensureSubject(db.client(), 'S07')
    const again = await ensureSubject(db.client(), ' s07 ')
    expect(again.id).toBe(first.id)
    expect(db.rows('subjects')).toHaveLength(1)
    expect(db.writes.filter((w) => w.op === 'insert')).toHaveLength(1)
  })

  it('ensureSubject uses the existing row when another import created it first', async () => {
    const db = new FakeDb()
    const client = db.client()
    const first = await ensureSubject(client, 'S02')
    // The first lookup answers "not there yet"; the insert then hits the unique constraint.
    const real = client.from
    let calls = 0
    client.from = ((table: string) => {
      if (++calls > 1) return real(table)
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null, status: 200 }) }) }) }
    }) as unknown as SupabaseClient['from']
    const row = await ensureSubject(client, 'S02')
    expect(row.id).toBe(first.id)
    expect(db.rows('subjects')).toHaveLength(1)
    expect(db.writes.filter((w) => w.table === 'subjects')).toHaveLength(2)
  })

  it('lists subjects by code', async () => {
    const db = new FakeDb()
    await ensureSubject(db.client(), 'S10')
    await ensureSubject(db.client(), 'S03')
    expect((await listSubjects(db.client())).map((s) => s.subject_code)).toEqual(['S03', 'S10'])
  })
})

// ---------- consents ----------

describe('consents', () => {
  it('writes one row per accepted scope with the consent version and no owner_id', async () => {
    const db = new FakeDb()
    const rows = await grantConsents(db.client(), ['on_device_processing', 'keypoints_and_metrics_storage', 'ai_metrics_only'])
    expect(rows.map((r) => r.scope)).toEqual(['on_device_processing', 'keypoints_and_metrics_storage', 'ai_metrics_only'])
    const sent = db.writes[0].payload as Row[]
    expect(sent).toHaveLength(3)
    for (const row of sent) {
      expect(row).toEqual({ scope: row.scope, form_reference: 'app-consent-v1', subject_id: null })
    }
    expect([...activeConsents(await listConsents(db.client()))].sort()).toEqual([
      'ai_metrics_only',
      'keypoints_and_metrics_storage',
      'on_device_processing',
    ])
  })

  it('does not repeat a scope that is already active', async () => {
    const db = new FakeDb()
    await grantConsents(db.client(), ['on_device_processing'])
    await grantConsents(db.client(), ['on_device_processing', 'own_video_upload'])
    expect(db.rows('consents').map((r) => r.scope)).toEqual(['on_device_processing', 'own_video_upload'])
  })

  it('revokes a scope by date and grants it again as a new row', async () => {
    const db = new FakeDb()
    const client = db.client()
    await grantConsents(client, ['on_device_processing', 'ai_metrics_only'])
    const after = await revokeConsent(client, 'ai_metrics_only')
    expect(after.find((r) => r.scope === 'ai_metrics_only')?.revoked_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(activeConsents(after).has('ai_metrics_only')).toBe(false)
    expect(activeConsents(after).has('on_device_processing')).toBe(true)

    await grantConsents(client, ['ai_metrics_only'])
    expect(db.rows('consents').filter((r) => r.scope === 'ai_metrics_only')).toHaveLength(2)
    expect(activeConsents(await listConsents(client)).has('ai_metrics_only')).toBe(true)
  })

  it('ignores per-subject paper-form rows and unknown scopes', () => {
    const rows = [
      { scope: 'ai_metrics_only', subject_id: 'sub-1', revoked_on: null },
      { scope: 'demo_display', subject_id: null, revoked_on: null },
      { scope: 'own_video_upload', subject_id: null, revoked_on: '2026-11-15' },
    ]
    expect(activeConsents(rows).size).toBe(0)
  })

  it('refuses an unknown scope before any request, and needs a session', async () => {
    const db = new FakeDb()
    const e = await rejection(grantConsents(db.client(), ['everything' as never]))
    expect(e.code).toBe('invalid_consent')
    expect(db.writes).toHaveLength(0)
    db.uid = null
    expect((await rejection(listConsents(db.client()))).code).toBe('not_signed_in')
  })
})

// ---------- sessions ----------

describe('sessions', () => {
  it('lists sessions with subject code and attempt count', async () => {
    const { client, session } = await setup()
    await createSession(client, { movement_type: 'pirouette' })
    await createStudyAttempts(client, session.id, [clip(1), clip(2), clip(3)])
    const list = await listSessions(client)
    expect(list).toHaveLength(2)
    const withClips = list.find((s) => s.id === session.id)!
    expect(withClips).toMatchObject({ subject_code: 'S01', attempt_count: 3, camera_view: 'front' })
    expect(withClips).not.toHaveProperty('attempts')
    expect(list.find((s) => s.id !== session.id)).toMatchObject({ subject_code: null, attempt_count: 0 })
  })

  it('never sends an owner_id; the database sets it', async () => {
    const { db, client } = await setup()
    await createSession(client, { movement_type: 'pirouette', owner_id: OTHER_UID } as never)
    for (const w of db.writes) expect(JSON.stringify(w.payload)).not.toContain('owner_id')
  })

  it('deleteSession removes the stored keypoints of its attempts, then the session', async () => {
    const { db, client, session } = await setup()
    const [a, b] = await createStudyAttempts(client, session.id, [clip(1), clip(2)])
    if (a.outcome !== 'created' || b.outcome !== 'created') throw new Error('setup')
    await uploadKeypoints(client, a.attempt.id, gzipBlob(), 10)
    await deleteSession(client, session.id)
    expect(db.removed).toEqual([
      { bucket: 'keypoints', paths: [`${UID}/${a.attempt.id}.json.gz`, `${UID}/${b.attempt.id}.json.gz`] },
    ])
    expect(db.objects.size).toBe(0)
    expect(db.rows('sessions')).toHaveLength(0)
  })

  it('deleteSession reports a session that is not there', async () => {
    const { client } = await setup()
    const e = await rejection(deleteSession(client, 'missing'))
    expect(e.code).toBe('not_found')
    expect(e.message).toMatch(/session/)
  })
})

// ---------- attempts ----------

describe('study attempts', () => {
  it('creates queued study_dataset rows that never carry a video_path', async () => {
    const { db, client, session } = await setup()
    // Even a caller that tries to pass a path or a local folder gets neither stored.
    const sneaky = {
      ...clip(1),
      clip_name: 'C:\\Users\\someone\\Videos\\S01_releve_take1.mp4',
      video_path: `${UID}/clip.mp4`,
      source: 'user_upload',
      fps: 30,
    } as unknown as StudyClipInput
    const results = await createStudyAttempts(client, session.id, [sneaky, clip(2)])
    expect(results.map((r) => r.outcome)).toEqual(['created', 'created'])

    const sent = db.writes.filter((w) => w.table === 'attempts').flatMap((w) => w.payload as Row[])
    expect(sent).toHaveLength(2)
    for (const row of sent) {
      expect(row.video_path).toBeNull()
      expect(row.source).toBe('study_dataset')
      expect(row.status).toBe('queued')
    }
    // FR-3.2.5: only a label rebuilt from the subject code and clip number is stored.
    expect(sent[0]).toMatchObject({ clip_name: 'S01_att01.mp4', clip_number: 1, video_sha256: sha(1), duration_s: 12.5, fps: 30 })
    expect(JSON.stringify(sent)).not.toMatch(/someone|Users|releve_take/)
    expect(sent[1]).toMatchObject({ fps: null })
    for (const row of db.rows('attempts')) expect(row.video_path ?? null).toBeNull()
    // Rows only: the import touched no storage bucket.
    expect(db.uploads).toHaveLength(0)
  })

  it('reports a clip imported before as a duplicate and still creates the rest', async () => {
    const { db, client, session } = await setup()
    const [first] = await createStudyAttempts(client, session.id, [clip(1)])
    if (first.outcome !== 'created') throw new Error('setup')

    const results = await createStudyAttempts(client, session.id, [clip(2), clip(1), clip(3)])
    expect(results.map((r) => r.outcome)).toEqual(['created', 'duplicate', 'created'])
    const dup = results[1]
    if (dup.outcome !== 'duplicate') throw new Error('expected duplicate')
    expect(dup.existing_attempt_id).toBe(first.attempt.id)
    expect(dup.error.code).toBe('duplicate_clip')
    expect(dup.error.message).toBe('This clip is already in your library.')
    expect(dup.error.recovery).toBeTruthy()
    expect(db.rows('attempts')).toHaveLength(3)
  })

  it('reports the same file picked twice in one batch', async () => {
    const { db, client, session } = await setup()
    const results = await createStudyAttempts(client, session.id, [
      clip(5),
      clip(5, { clip_name: 'copy.mp4', video_sha256: sha(5).toUpperCase() }),
    ])
    expect(results.map((r) => r.outcome)).toEqual(['created', 'duplicate'])
    const [a, b] = results
    if (a.outcome !== 'created' || b.outcome !== 'duplicate') throw new Error('unexpected')
    expect(b.existing_attempt_id).toBe(a.attempt.id)
    expect(db.rows('attempts')).toHaveLength(1)
  })

  it('falls back to one insert per clip when the batch hits the unique index', async () => {
    const { db, client, session } = await setup()
    // Another tab imports clip 2 between the lookup and the insert.
    const real = client.from
    let lookups = 0
    client.from = ((table: string) => {
      const q = real(table)
      if (table === 'attempts' && ++lookups === 2) {
        db.rows('attempts').push({ id: 'other-tab', owner_id: UID, session_id: session.id, video_sha256: sha(2) })
      }
      return q
    }) as unknown as SupabaseClient['from']

    const results = await createStudyAttempts(client, session.id, [clip(1), clip(2), clip(3)])
    expect(results.map((r) => r.outcome)).toEqual(['created', 'duplicate', 'created'])
    expect(db.rows('attempts')).toHaveLength(3)
  })

  it('reports an unreadable hash per clip without sending it', async () => {
    const { db, client, session } = await setup()
    const results = await createStudyAttempts(client, session.id, [clip(1, { video_sha256: 'not-a-hash' }), clip(2)])
    expect(results.map((r) => r.outcome)).toEqual(['failed', 'created'])
    expect(db.rows('attempts')).toHaveLength(1)
  })

  it('throws one mapped error when the session is gone', async () => {
    const { client } = await setup()
    const e = await rejection(createStudyAttempts(client, 'missing-session', [clip(1)]))
    expect(e.code).toBe('not_found')
    expect(e.message).not.toMatch(/foreign key|constraint/)
  })

  it('lists attempts of a session and updates their status', async () => {
    const { client, session } = await setup()
    await createStudyAttempts(client, session.id, [clip(2), clip(1)])
    const list = await listAttempts(client, session.id)
    expect(list.map((a) => a.clip_name)).toEqual(['S01_att02.mp4', 'S01_att01.mp4'])

    const failed = await setAttemptStatus(client, list[0].id, 'failed', '  No person was found in this clip.  ')
    expect(failed).toMatchObject({ status: 'failed', error: 'No person was found in this clip.' })
    // A reason only belongs to a failed attempt.
    const done = await setAttemptStatus(client, list[0].id, 'done', 'stale reason')
    expect(done).toMatchObject({ status: 'done', error: null })
  })

  it('treats another account’s attempt as not found', async () => {
    const { db, client, session } = await setup()
    const [a] = await createStudyAttempts(client, session.id, [clip(1)])
    if (a.outcome !== 'created') throw new Error('setup')
    db.uid = OTHER_UID
    expect((await rejection(setAttemptStatus(client, a.attempt.id, 'done'))).code).toBe('not_found')
    expect((await rejection(deleteAttempt(client, a.attempt.id))).code).toBe('not_found')
    expect(db.rows('attempts')).toHaveLength(1)
    expect(db.removed).toHaveLength(0)
  })

  it('deleteAttempt removes the keypoints file and the row', async () => {
    const { db, client, session } = await setup()
    const [a] = await createStudyAttempts(client, session.id, [clip(1)])
    if (a.outcome !== 'created') throw new Error('setup')
    await uploadKeypoints(client, a.attempt.id, gzipBlob(), 10)
    await deleteAttempt(client, a.attempt.id)
    expect(db.removed).toEqual([{ bucket: 'keypoints', paths: [`${UID}/${a.attempt.id}.json.gz`] }])
    expect(db.rows('attempts')).toHaveLength(0)
  })
})

// ---------- keypoints and metrics ----------

describe('keypoints', () => {
  it('stores them at {uid}/{attemptId}.json.gz in the keypoints bucket', async () => {
    const { db, client, session } = await setup()
    const [a] = await createStudyAttempts(client, session.id, [clip(1)])
    if (a.outcome !== 'created') throw new Error('setup')
    const blob = gzipBlob(128)
    const row = await uploadKeypoints(client, a.attempt.id, blob, 360)

    expect(keypointsPath(UID, a.attempt.id)).toBe(`${UID}/${a.attempt.id}.json.gz`)
    expect(db.uploads).toHaveLength(1)
    expect(db.uploads[0]).toMatchObject({
      bucket: 'keypoints',
      path: `${UID}/${a.attempt.id}.json.gz`,
      options: { contentType: 'application/gzip', upsert: true },
    })
    expect(row).toMatchObject({
      attempt_id: a.attempt.id,
      storage_path: `${UID}/${a.attempt.id}.json.gz`,
      frame_count: 360,
      size_bytes: 128,
      model: 'pose_landmarker_full',
    })

    // Processing again replaces the row instead of adding one.
    await uploadKeypoints(client, a.attempt.id, gzipBlob(200), 361)
    expect(db.rows('attempt_keypoints')).toHaveLength(1)
    expect(db.rows('attempt_keypoints')[0]).toMatchObject({ frame_count: 361, size_bytes: 200 })

    const back = await downloadKeypoints(client, a.attempt.id)
    expect(back.size).toBe(200)
  })

  it('refuses anything that is not a gzip file, so a clip can’t be uploaded by mistake', async () => {
    const { db, client } = await setup()
    const video = new Blob([new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])], { type: 'video/mp4' })
    const mislabelled = new Blob([new Uint8Array([0x1f, 0x8b, 8, 0])], { type: 'video/webm' })
    for (const blob of [video, mislabelled, new Blob([])]) {
      expect((await rejection(uploadKeypoints(client, 'a1', blob, 10))).code).toBe('not_keypoints')
    }
    expect((await rejection(uploadKeypoints(client, 'a1', gzipBlob(), -1))).code).toBe('not_keypoints')
    expect(db.uploads).toHaveLength(0)
  })

  it('refuses a file over the bucket limit before sending it', async () => {
    const { db, client } = await setup()
    const e = await rejection(uploadKeypoints(client, 'a1', gzipBlob(10_485_761), 10))
    expect(e.code).toBe('too_large')
    expect(db.uploads).toHaveLength(0)
  })

  it('says so when no keypoints were saved yet', async () => {
    const { client } = await setup()
    const e = await rejection(downloadKeypoints(client, 'a1'))
    expect(e.code).toBe('not_found')
    expect(e.message).toBe('No pose data is saved for this clip yet.')
  })
})

describe('metrics', () => {
  it('upserts one row per attempt and keeps unavailable values as null', async () => {
    const { db, client, session } = await setup()
    const [a] = await createStudyAttempts(client, session.id, [clip(1)])
    if (a.outcome !== 'created') throw new Error('setup')
    const id = a.attempt.id
    await saveMetrics(client, id, {
      movement: 'releve_balance',
      trunk_inclination_deg: 3.2,
      balance_duration_s: Number.NaN,
      algorithm_version: '0.1.0',
    })
    const saved = await saveMetrics(client, id, {
      movement: 'releve_balance',
      trunk_inclination_deg: 2.9,
      pelvis_ankle_offset_norm: 0,
      phases: [{ phase: 'hold', start: 1.2, end: 4.8 }],
      confidence: { trunk_inclination_deg: { level: 'high', score: 0.91 } },
      algorithm_version: '0.1.1',
    })
    expect(db.rows('attempt_metrics')).toHaveLength(1)
    expect(saved).toMatchObject({
      attempt_id: id,
      trunk_inclination_deg: 2.9,
      pelvis_ankle_offset_norm: 0,
      balance_duration_s: null,
      turn_count: null,
      algorithm_version: '0.1.1',
    })
    expect(await getMetrics(client, [id, id, 'none'])).toHaveLength(1)
    expect(await getMetrics(client, [])).toEqual([])
  })
})

// ---------- error mapping ----------

describe('error mapping', () => {
  const RAW = 'duplicate key value violates unique constraint "attempts_owner_sha" DETAIL: Key (owner_id, video_sha256)'

  it.each([
    [{ code: 'PGRST301', message: 'JWT expired' }, 401, 'not_signed_in'],
    [{ code: '42501', message: 'new row violates row-level security policy' }, 401, 'not_signed_in'],
    [{ code: '23505', message: RAW }, 409, 'duplicate'],
    [{ code: '42501', message: 'new row violates row-level security policy for table "attempts"' }, 403, 'permission'],
    [{ message: 'new row violates row-level security policy', status: 400, statusCode: '403' }, undefined, 'permission'],
    [{ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, 406, 'not_found'],
    [{ code: '23503', message: 'violates foreign key constraint "attempts_session_id_fkey"' }, 409, 'not_found'],
    [{ message: 'Object not found', status: 400, statusCode: '404' }, undefined, 'not_found'],
    [{ message: 'The object exceeded the maximum allowed size', status: 400, statusCode: '413' }, undefined, 'too_large'],
    [{ message: 'Storage quota exceeded for this project', status: 400 }, undefined, 'storage_quota'],
    [{ code: '23514', message: 'violates check constraint "study_no_video"' }, 400, 'invalid'],
    [{ code: '', message: 'TypeError: Failed to fetch' }, 0, 'network'],
    [new TypeError('Failed to fetch'), undefined, 'network'],
    [{ message: 'upstream connect error' }, 503, 'network'],
    [{ message: 'something else' }, 400, 'data_error'],
  ])('%j (%s) → %s', (raw, status, code) => {
    const e = dataError(raw, {}, status)
    expect(e).toBeInstanceOf(ApiError)
    expect(e.code).toBe(code)
    expect(e.recovery).toBeTruthy()
    // Nothing from Postgres or Storage leaks into the copy.
    expect(`${e.message} ${e.recovery}`).not.toMatch(/constraint|violates|row-level|JWT|fetch|PGRST|owner_id|sha256|upstream/i)
  })

  it('asks for sign-in before any request when there is no session', async () => {
    const db = new FakeDb()
    db.uid = null
    const client = db.client()
    for (const call of [
      listSubjects(client),
      ensureSubject(client, 'S01'),
      listSessions(client),
      createStudyAttempts(client, 's', [clip(1)]),
      uploadKeypoints(client, 'a', gzipBlob(), 1),
      getMetrics(client, ['a']),
    ]) {
      const e = await rejection(call)
      expect(e.code).toBe('not_signed_in')
      expect(e.status).toBe(401)
    }
    expect(db.writes).toHaveLength(0)
    expect(db.uploads).toHaveLength(0)
  })

  it('maps a dropped connection, returned or thrown', async () => {
    const { db, client, session } = await setup()
    db.failNext({ code: '', message: 'TypeError: Failed to fetch' }, 0)
    expect((await rejection(listAttempts(client, session.id))).code).toBe('network')
    db.failNext(new TypeError('Failed to fetch'))
    expect((await rejection(listSessions(client))).code).toBe('network')
  })

  it('maps storage failures during a keypoints upload', async () => {
    const { db, client } = await setup()
    db.failNext({ message: 'Storage quota exceeded', status: 400 })
    const quota = await rejection(uploadKeypoints(client, 'a1', gzipBlob(), 10))
    expect(quota.code).toBe('storage_quota')
    expect(quota.message).toBe('The project storage is full.')
    db.failNext({ message: 'new row violates row-level security policy', status: 400, statusCode: '403' })
    expect((await rejection(uploadKeypoints(client, 'a1', gzipBlob(), 10))).code).toBe('permission')
    // The row is only written once the file is stored.
    expect(db.rows('attempt_keypoints')).toHaveLength(0)
  })

  it('uses the clip wording for a duplicate when the caller asks for it', () => {
    const e = dataError({ code: '23505', message: RAW }, { duplicate: ['This clip is already in your library.', 'Open it.'] })
    expect(e.message).toBe('This clip is already in your library.')
  })
})

// ---------- clip files ----------

describe('parseClipName', () => {
  it.each([
    ['S03_releve_take2.mp4', 'S03', 'releve_balance', 2],
    ['s11-pirouette-07.MOV', 'S11', 'pirouette', 7],
    ['S05 Relevé Balance clip 12.webm', 'S05', 'releve_balance', 12],
    ['S01_pirouette_t03.mp4', 'S01', 'pirouette', 3],
    ['S12_take_4.mp4', 'S12', null, 4],
    ['S02.mp4', 'S02', null, null],
    ['releve_front.mp4', null, 'releve_balance', null],
    ['C:\\clips\\S04\\S04_releve_01.mp4', 'S04', 'releve_balance', 1],
  ])('%s', (name, subjectCode, movement, take) => {
    expect(parseClipName(name)).toEqual({ subjectCode, movement, take })
  })

  it.each([
    ['IMG_0042.MOV'],
    ['VID_123.mp4'],
    ['2026-11-15 14.30.05.mp4'],
    ['S3_warmup.mp4'],
    ['S100_clip.mp4'],
    ['practice.mp4'],
    [''],
  ])('returns nulls for %s', (name) => {
    expect(parseClipName(name)).toEqual({ subjectCode: null, movement: null, take: null })
  })

  it('does not choose when the name is ambiguous', () => {
    expect(parseClipName('S01_S02_releve.mp4').subjectCode).toBeNull()
    expect(parseClipName('S01_releve_pirouette.mp4').movement).toBeNull()
    expect(parseClipName('S01_releve_take1_take2.mp4').take).toBeNull()
    expect(parseClipName('S01_releve_2026_11_15.mp4').take).toBeNull()
    expect(parseClipName('S01_releve_00.mp4').take).toBeNull()
  })

  it('baseName drops folders', () => {
    expect(baseName('C:\\Users\\someone\\S01_releve.mp4')).toBe('S01_releve.mp4')
    expect(baseName('study/S01/clip.mp4')).toBe('clip.mp4')
    expect(baseName('clip.mp4')).toBe('clip.mp4')
  })
})

describe('sha256Hex', () => {
  const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  const TWO_BLOCKS = '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
  const chunked = { oneShotMaxBytes: -1 }
  afterEach(() => vi.unstubAllGlobals())

  it('matches the known digests through WebCrypto', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe(ABC)
    expect(await sha256Hex(new Blob([]))).toBe(EMPTY)
  })

  it('matches the known digests when hashing in chunks', async () => {
    expect(await sha256Hex(new Blob(['abc']), chunked)).toBe(ABC)
    expect(await sha256Hex(new Blob([]), chunked)).toBe(EMPTY)
    const text = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'
    expect(await sha256Hex(new Blob([text]), chunked)).toBe(TWO_BLOCKS)
  })

  it('gives the same digest for any chunk size, on synthetic bytes', async () => {
    const bytes = new Uint8Array(200_003)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff
    const file = new File([bytes], 'synthetic.bin')
    const expected = await sha256Hex(file)
    const progress: number[] = []
    for (const chunkBytes of [64, 1000, 4096, 65_537]) {
      expect(await sha256Hex(file, { ...chunked, chunkBytes, onProgress: (done) => progress.push(done) })).toBe(expected)
    }
    expect(progress.at(-1)).toBe(bytes.length)
    // Lengths around the padding boundary (55, 56, 63, 64, 65 bytes).
    for (const n of [55, 56, 63, 64, 65, 119, 120]) {
      const part = new Blob([bytes.subarray(0, n)])
      expect(await sha256Hex(part, { ...chunked, chunkBytes: 64 })).toBe(await sha256Hex(part))
    }
  })

  it('works without crypto.subtle', async () => {
    vi.stubGlobal('crypto', {})
    expect(await sha256Hex(new Blob(['abc']))).toBe(ABC)
  })
})

describe('readVideoMeta', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  interface FakeVideo {
    duration: number
    videoWidth: number
    videoHeight: number
    onloadedmetadata: (() => void) | null
    onerror: (() => void) | null
    src: string
    removeAttribute(name: string): void
    load(): void
  }

  function stubVideo(outcome: 'ok' | 'error' | 'silent', meta = { duration: 12.5, videoWidth: 1920, videoHeight: 1080 }) {
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    let current = ''
    const video: FakeVideo = {
      ...meta,
      onloadedmetadata: null,
      onerror: null,
      get src() {
        return current
      },
      set src(value: string) {
        current = value
        if (outcome === 'ok') queueMicrotask(() => video.onloadedmetadata?.())
        if (outcome === 'error') queueMicrotask(() => video.onerror?.())
      },
      removeAttribute: () => {
        current = ''
      },
      load: () => {},
    }
    vi.stubGlobal('document', { createElement: () => video })
    return { created, revoked, video }
  }

  it('reads duration and size and revokes the object URL', async () => {
    const { created, revoked, video } = stubVideo('ok')
    const meta = await readVideoMeta(new Blob([new Uint8Array(8)], { type: 'video/mp4' }))
    expect(meta).toEqual({ durationS: 12.5, width: 1920, height: 1080 })
    expect(created).toHaveBeenCalledTimes(1)
    expect(revoked).toHaveBeenCalledWith('blob:synthetic')
    expect(video.src).toBe('')
  })

  it('reports an unknown duration as null', async () => {
    stubVideo('ok', { duration: Number.POSITIVE_INFINITY, videoWidth: 640, videoHeight: 480 })
    expect((await readVideoMeta(new Blob([]))).durationS).toBeNull()
  })

  it('revokes the object URL when the file is not a video', async () => {
    const failed = stubVideo('error')
    const e = await rejection(readVideoMeta(new Blob(['not a video'])))
    expect(e.code).toBe('clip_unreadable')
    expect(failed.revoked).toHaveBeenCalledTimes(1)
  })

  it('revokes the object URL when the file never loads', async () => {
    const silent = stubVideo('silent')
    expect((await rejection(readVideoMeta(new Blob([]), 5))).code).toBe('clip_unreadable')
    expect(silent.revoked).toHaveBeenCalledTimes(1)
  })
})

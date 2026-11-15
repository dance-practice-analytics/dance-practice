import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../api/errors'
import {
  ACCOUNT_REMAINS,
  DELETE_ORDER,
  deleteAccount,
  deleteAllMyData,
  deleteAttemptData,
  deleteSessionData,
} from './deleteData'
import {
  EXPORT_FORMAT,
  EXPORT_METRICS,
  EXPORT_VERSION,
  METRICS_CSV_COLUMNS,
  buildExportDocument,
  csvCell,
  exportAll,
  exportMetricsCsv,
  metricsCsv,
  type ExportDocument,
  type ExportRows,
} from './exportData'

// ---------- a small in-memory stand-in for the Supabase client (no network) ----------
// Adapted from data.test.ts, with paging, counted deletes, storage listing and a log
// of the order in which requests arrived. All data here is synthetic.

type Row = Record<string, unknown>
interface Res {
  data: unknown
  error: unknown
  status: number
  count?: number | null
}

const UID = '00000000-0000-4000-8000-0000000000aa'
const OTHER_UID = '00000000-0000-4000-8000-0000000000bb'

class FakeDb {
  uid: string | null = UID
  /** Row-level security. Switched off in one test to show the uid filters stand on their own. */
  rls = true
  tables: Record<string, Row[]> = {}
  objects = new Map<string, Blob>()
  /** Objects the server silently refuses to remove (what a storage policy does). */
  stuck = new Set<string>()
  /** Every request, in order: 'select:attempts', 'delete:feedback', 'storage.remove:keypoints', … */
  ops: string[] = []
  removeCalls: { bucket: string; paths: string[] }[] = []
  selects: { table: string; cols: string }[] = []
  pageSize = 1000
  private failures: { match: (op: string) => boolean; error: Row | Error; status: number; times: number }[] = []

  /** Requests whose name matches answer with this error (or throw it), `times` times. */
  failOn(match: string | RegExp, error: Row | Error, status = 400, times = 1) {
    const test = typeof match === 'string' ? (op: string) => op === match : (op: string) => match.test(op)
    this.failures.push({ match: test, error, status, times })
  }
  begin(op: string): Res | null {
    this.ops.push(op)
    const f = this.failures.find((x) => x.times > 0 && x.match(op))
    if (!f) return null
    f.times--
    if (f.error instanceof Error) throw f.error
    return { data: null, error: f.error, status: f.status }
  }
  rows(table: string): Row[] {
    return (this.tables[table] ??= [])
  }
  add(table: string, ...rows: Row[]) {
    this.rows(table).push(...rows)
  }
  put(bucket: string, path: string, blob: Blob = gzipBlob()) {
    this.objects.set(`${bucket}/${path}`, blob)
  }
  paths(bucket: string): string[] {
    return [...this.objects.keys()].filter((k) => k.startsWith(`${bucket}/`)).map((k) => k.slice(bucket.length + 1))
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
          download: async (path: string) => {
            const failure = db.begin(`storage.download:${bucket}`)
            if (failure) return failure
            const blob = db.objects.get(`${bucket}/${path}`)
            return blob
              ? { data: blob, error: null }
              : { data: null, error: { message: 'Object not found', status: 400, statusCode: '404' } }
          },
          list: async (folder: string, opts?: { limit?: number; offset?: number }) => {
            const failure = db.begin(`storage.list:${bucket}`)
            if (failure) return failure
            const names = db
              .paths(bucket)
              .filter((p) => p.startsWith(`${folder}/`))
              .map((p) => p.slice(folder.length + 1))
              .sort()
            const offset = opts?.offset ?? 0
            const page = names.slice(offset, offset + (opts?.limit ?? 100))
            return { data: page.map((name) => ({ name, id: `obj-${name}` })), error: null }
          },
          remove: async (paths: string[]) => {
            const failure = db.begin(`storage.remove:${bucket}`)
            if (failure) return failure
            db.removeCalls.push({ bucket, paths })
            const gone: { name: string }[] = []
            for (const p of paths) {
              const key = `${bucket}/${p}`
              // Like the storage policy: only the signed-in user's folder, and no error for the rest.
              const allowed = !db.rls || p.startsWith(`${db.uid}/`)
              if (allowed && !db.stuck.has(key) && db.objects.delete(key)) gone.push({ name: p })
            }
            return { data: gone, error: null }
          },
          upload: async () => {
            throw new Error('nothing in the export or delete layer uploads')
          },
        }),
      },
    }
    return fake as unknown as SupabaseClient
  }
}

class FakeQuery implements PromiseLike<Res> {
  private op: 'select' | 'delete' | 'write' = 'select'
  private cols = '*'
  private filters: ((r: Row) => boolean)[] = []
  private orders: { col: string; asc: boolean }[] = []
  private window: [number, number] | null = null
  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(cols = '*') {
    if (this.op === 'select') this.cols = cols
    return this
  }
  delete(_opts?: { count?: string }) {
    this.op = 'delete'
    return this
  }
  insert() {
    this.op = 'write'
    return this
  }
  update() {
    this.op = 'write'
    return this
  }
  upsert() {
    this.op = 'write'
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
  range(from: number, to: number) {
    this.window = [from, to]
    return this
  }
  then<A = Res, B = never>(ok?: ((v: Res) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return new Promise<Res>((resolve) => resolve(this.run())).then(ok, fail)
  }

  private visible(): Row[] {
    const mine = (r: Row) => !this.db.rls || r.owner_id === this.db.uid
    return this.db.rows(this.table).filter((r) => mine(r) && this.filters.every((f) => f(r)))
  }

  private run(): Res {
    if (this.op === 'write') throw new Error(`unexpected write to ${this.table}`)
    const failure = this.db.begin(`${this.op}:${this.table}`)
    if (failure) return failure
    if (this.op === 'delete') {
      // Like the grants in the migration: the browser may not delete a profile.
      if (this.table === 'profiles') {
        return { data: null, error: { code: '42501', message: 'permission denied for table profiles' }, status: 403 }
      }
      const rows = this.visible()
      this.db.tables[this.table] = this.db.rows(this.table).filter((r) => !rows.includes(r))
      return { data: null, error: null, status: 204, count: rows.length }
    }
    this.db.selects.push({ table: this.table, cols: this.cols })
    const names = this.cols.split(',').map((c) => c.trim())
    let rows = this.visible()
    for (const { col, asc } of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1))
    }
    const [from, to] = this.window ?? [0, this.db.pageSize - 1]
    rows = rows.slice(from, Math.min(to + 1, from + this.db.pageSize))
    // Only the requested columns come back, as from PostgREST.
    return { data: rows.map((r) => Object.fromEntries(names.map((n) => [n, r[n] ?? null]))), error: null, status: 200 }
  }
}

// ---------- synthetic data ----------

const gzipBlob = (bytes = 64) => {
  const body = new Uint8Array(bytes)
  body.set([0x1f, 0x8b, 0x08, 0x00])
  return new Blob([body], { type: 'application/gzip' })
}
const at = (n: number) => new Date(Date.UTC(2026, 10, 15, 9, 0, n)).toISOString()
const kp = (uid: string, attemptId: string) => `${uid}/${attemptId}.json.gz`

// Text that must never show up in an export unless labels were asked for.
const NAME = 'Quillfeather'
const EMAIL = 'quill.feather@example.test'

const CONF = (level: string, score: number, extra: Row = {}) => ({ level, score, phases: ['hold', 'finish'], ...extra })

/** One account with two sessions and four attempts in different states, plus another account's data. */
function seed(db = new FakeDb()) {
  const own = { owner_id: UID }
  db.add('profiles', { id: UID, ...own, display_name: NAME, role: 'researcher', created_at: at(0) })
  db.add(
    'subjects',
    { id: 'sub-1', ...own, subject_code: 'S01', notes: `${NAME} asked to be filmed from the left`, created_at: at(1) },
    { id: 'sub-2', ...own, subject_code: 'S02', notes: null, created_at: at(2) },
  )
  db.add(
    'consents',
    { id: 'con-1', ...own, subject_id: null, scope: 'on_device_processing', form_reference: 'app-consent-v1', granted_on: '2026-11-15', revoked_on: null, created_at: at(3) },
    { id: 'con-2', ...own, subject_id: null, scope: 'ai_metrics_only', form_reference: 'app-consent-v1', granted_on: '2026-11-15', revoked_on: '2026-11-16', created_at: at(4) },
    { id: 'con-3', ...own, subject_id: 'sub-1', scope: 'keypoints_and_metrics_storage', form_reference: 'FORM-0007', granted_on: '2026-10-01', revoked_on: null, created_at: at(5) },
  )
  db.add(
    'sessions',
    { id: 'ses-1', ...own, subject_id: 'sub-1', movement_type: 'releve_balance', title: `${NAME}, "front" view`, recorded_on: '2026-11-10', camera_view: 'front', created_at: at(10) },
    { id: 'ses-2', ...own, subject_id: null, movement_type: 'pirouette', title: null, recorded_on: null, camera_view: null, created_at: at(11) },
  )
  const attempt = (id: string, session_id: string, n: number, extra: Row = {}): Row => ({
    id,
    ...own,
    session_id,
    source: 'study_dataset',
    label: `${NAME} take ${n}`,
    clip_name: `C:\\clips\\${NAME}\\S01_releve_take${n}.mp4`,
    video_path: null,
    video_sha256: n.toString(16).padStart(64, '0'),
    duration_s: 12.5,
    fps: 30,
    status: 'done',
    error: null,
    created_at: at(20 + n),
    ...extra,
  })
  db.add(
    'attempts',
    attempt('att-1', 'ses-1', 1),
    attempt('att-2', 'ses-1', 2, { status: 'failed', error: 'No person was found in this clip.' }),
    attempt('att-3', 'ses-1', 3, { status: 'queued', fps: null }),
    attempt('att-4', 'ses-2', 4, { source: 'user_upload', video_path: `${UID}/att-4.mp4` }),
  )
  db.add(
    'attempt_keypoints',
    { attempt_id: 'att-1', ...own, storage_path: kp(UID, 'att-1'), frame_count: 360, size_bytes: 64, model: 'pose_landmarker_full', created_at: at(30) },
    { attempt_id: 'att-4', ...own, storage_path: kp(UID, 'att-4'), frame_count: 200, size_bytes: 80, model: 'pose_landmarker_full', created_at: at(31) },
  )
  db.add(
    'attempt_metrics',
    {
      attempt_id: 'att-1',
      ...own,
      movement: 'releve_balance',
      trunk_inclination_deg: 3.2,
      // A real zero: the pelvis is over the ankle. It must stay 0, not become empty.
      pelvis_ankle_offset_norm: 0,
      balance_duration_s: 4.1,
      knee_tracking_dev_deg: null,
      turn_count: null,
      phases: [
        { phase: 'prep', start: 0, end: 1.2 },
        { phase: 'hold', start: 1.2, end: 5.3 },
      ],
      confidence: {
        trunk_inclination_deg: CONF('high', 0.91),
        pelvis_ankle_offset_norm: CONF('medium', 0.62),
        balance_duration_s: CONF('high', 0.88),
        knee_tracking_dev_deg: CONF('low', 0, { reason: 'knee_not_bent' }),
        turn_count: CONF('low', 0, { reason: 'not_applicable' }),
      },
      algorithm_version: '0.1.0',
      computed_at: at(40),
    },
    {
      attempt_id: 'att-4',
      ...own,
      movement: 'pirouette',
      trunk_inclination_deg: 5.5,
      pelvis_ankle_offset_norm: null,
      balance_duration_s: null,
      knee_tracking_dev_deg: 7.25,
      turn_count: 1.75,
      phases: [{ phase: 'turn', start: 2, end: 3.5 }],
      // An older row without reasons: the export still says why in its own words.
      confidence: { turn_count: CONF('low', 0.4, { notes: ['tracking_lost_in_turn'] }) },
      algorithm_version: '0.1.0',
      computed_at: at(41),
    },
  )
  db.add('feedback', {
    id: 'fb-1',
    ...own,
    attempt_id: 'att-1',
    model: 'claude-sonnet-5-5',
    prompt_version: 'p1',
    input_hash: 'abc123',
    response: {
      summary: 'Trunk stayed close to vertical, "steady" through the hold.',
      observations: [{ metric: 'trunk_inclination_deg', observation: '3.2 deg', suggestion: 'Repeat and compare.', confidence: 'high' }],
      cautions: [],
      disclaimer: 'Notes are based on measurements only.',
    },
    created_at: at(50),
  })
  db.put('keypoints', kp(UID, 'att-1'))
  db.put('keypoints', kp(UID, 'att-4'), gzipBlob(80))
  db.put('videos', `${UID}/att-4.mp4`, new Blob([new Uint8Array(16)], { type: 'video/mp4' }))

  // Another account. Nothing below may be read, exported or deleted.
  const other = { owner_id: OTHER_UID }
  db.add('profiles', { id: OTHER_UID, ...other, display_name: 'other-person', role: 'dancer', created_at: at(0) })
  db.add('subjects', { id: 'o-sub', ...other, subject_code: 'S09', notes: null, created_at: at(1) })
  db.add('consents', { id: 'o-con', ...other, subject_id: null, scope: 'on_device_processing', form_reference: 'app-consent-v1', granted_on: '2026-11-15', revoked_on: null, created_at: at(2) })
  db.add('sessions', { id: 'o-ses', ...other, subject_id: 'o-sub', movement_type: 'releve_balance', title: null, recorded_on: null, camera_view: 'side', created_at: at(3) })
  db.add('attempts', { ...attempt('o-att', 'o-ses', 9), ...other })
  db.add('attempt_keypoints', { attempt_id: 'o-att', ...other, storage_path: kp(OTHER_UID, 'o-att'), frame_count: 10, size_bytes: 64, model: 'pose_landmarker_full', created_at: at(4) })
  db.add('attempt_metrics', { attempt_id: 'o-att', ...other, movement: 'releve_balance', trunk_inclination_deg: 9.9, pelvis_ankle_offset_norm: null, balance_duration_s: null, knee_tracking_dev_deg: null, turn_count: null, phases: [], confidence: {}, algorithm_version: '0.1.0', computed_at: at(5) })
  db.add('feedback', { id: 'o-fb', ...other, attempt_id: 'o-att', model: 'm', prompt_version: 'p1', input_hash: 'x', response: {}, created_at: at(6) })
  db.put('keypoints', kp(OTHER_UID, 'o-att'))
  db.put('videos', `${OTHER_UID}/o-att.mp4`, new Blob([new Uint8Array(8)], { type: 'video/mp4' }))

  return { db, client: db.client() }
}

const OTHER_TABLES = ['profiles', 'subjects', 'consents', 'sessions', 'attempts', 'attempt_keypoints', 'attempt_metrics', 'feedback']
function expectOtherAccountUntouched(db: FakeDb) {
  for (const t of OTHER_TABLES) expect(db.rows(t).filter((r) => r.owner_id === OTHER_UID), t).toHaveLength(1)
  expect(db.objects.has(`keypoints/${kp(OTHER_UID, 'o-att')}`)).toBe(true)
  expect(db.objects.has(`videos/${OTHER_UID}/o-att.mp4`)).toBe(true)
}

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  )
  expect(e).toBeInstanceOf(ApiError)
  return e as ApiError
}

/** Every key used anywhere in a JSON value. */
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) keysOf(v, out)
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k)
      keysOf(v, out)
    }
  }
  return out
}

/** A small RFC 4180 reader, to check the CSV by reading it back. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i++
    } else cell += c
  }
  if (cell || row.length) rows.push([...row, cell])
  return rows
}

const NOW = new Date('2026-11-15T12:00:00.000Z')

// ---------- JSON export ----------

describe('exportAll', () => {
  it('returns a versioned document with a generated-at time and counts', async () => {
    const { client } = seed()
    const { document, json, keypoints, keypointsUnavailable } = await exportAll(client, { now: NOW })
    expect(document.format).toBe(EXPORT_FORMAT)
    expect(document.version).toBe(EXPORT_VERSION)
    expect(EXPORT_VERSION).toBe(1)
    expect(document.generated_at).toBe('2026-11-15T12:00:00.000Z')
    expect(document.includes).toEqual({ labels: false, keypoint_files: false })
    expect(document.counts).toEqual({ sessions: 2, attempts: 4, attempts_with_metrics: 2, feedback: 1, consents: 3 })
    expect(JSON.parse(json)).toEqual(document)
    expect(Object.keys(JSON.parse(json))).toEqual(['format', 'version', 'generated_at', 'about', 'includes', 'counts', 'sessions', 'consents'])
    expect(keypoints).toEqual([])
    expect(keypointsUnavailable).toEqual([])
  })

  it('nests sessions → attempts → metrics, phases, confidence and practice notes', async () => {
    const { client } = seed()
    const { document } = await exportAll(client, { now: NOW })
    expect(document.sessions.map((s) => [s.id, s.subject_code, s.attempts.map((a) => a.id)])).toEqual([
      ['ses-1', 'S01', ['att-1', 'att-2', 'att-3']],
      ['ses-2', null, ['att-4']],
    ])
    const [a1] = document.sessions[0].attempts
    expect(a1.metrics_run).toEqual({ movement: 'releve_balance', algorithm_version: '0.1.0', computed_at: at(40) })
    expect(a1.phases).toEqual([
      { phase: 'prep', start: 0, end: 1.2 },
      { phase: 'hold', start: 1.2, end: 5.3 },
    ])
    expect(a1.metrics.map((m) => m.metric)).toEqual(EXPORT_METRICS.map((m) => m.metric))
    expect(a1.metrics[0]).toEqual({
      metric: 'trunk_inclination_deg',
      unit: 'deg',
      value: 3.2,
      null_reason: null,
      confidence_level: 'high',
      confidence_score: 0.91,
      qualifiers: [],
    })
    expect(a1.keypoints).toEqual({
      frame_count: 360,
      size_bytes: 64,
      model: 'pose_landmarker_full',
      created_at: at(30),
      file: null,
      file_null_reason: 'not_included',
    })
    expect(a1.feedback).toHaveLength(1)
    expect(a1.feedback[0]).toMatchObject({ id: 'fb-1', model: 'claude-sonnet-5-5', prompt_version: 'p1' })
    expect((a1.feedback[0].response as { observations: unknown[] }).observations).toHaveLength(1)
  })

  it('keeps a missing value as null with its reason, and a measured zero as 0', async () => {
    const { client } = seed()
    const { document } = await exportAll(client, { now: NOW })
    const [a1, a2, a3] = document.sessions[0].attempts
    const a4 = document.sessions[1].attempts[0]
    const pick = (a: typeof a1, metric: string) => a.metrics.find((m) => m.metric === metric)!

    expect(pick(a1, 'pelvis_ankle_offset_norm')).toMatchObject({ value: 0, null_reason: null })
    // The engine's own reason is passed through.
    expect(pick(a1, 'knee_tracking_dev_deg')).toMatchObject({ value: null, null_reason: 'knee_not_bent', confidence_level: 'low' })
    expect(pick(a1, 'turn_count')).toMatchObject({ value: null, null_reason: 'not_applicable' })

    // No metrics row: every metric is listed, null, with the state of the attempt as the reason.
    expect(a2.status_reason).toBe('No person was found in this clip.')
    expect(a2.metrics_run).toBeNull()
    expect(a2.phases).toBeNull()
    expect(a2.keypoints).toBeNull()
    expect(a2.metrics).toHaveLength(5)
    for (const m of a2.metrics) expect(m).toMatchObject({ value: null, null_reason: 'processing_failed', confidence_level: null, confidence_score: null })
    for (const m of a3.metrics) expect(m).toMatchObject({ value: null, null_reason: 'not_processed' })
    expect(a3.fps).toBeNull()

    // A row without a stored reason still gets one.
    expect(pick(a4, 'balance_duration_s')).toMatchObject({ value: null, null_reason: 'not_measured', confidence_level: null })
    expect(pick(a4, 'turn_count')).toMatchObject({ value: 1.75, null_reason: null, confidence_level: 'low', qualifiers: ['tracking_lost_in_turn'] })

    // Exactly the null values have a reason, everywhere.
    for (const a of [a1, a2, a3, a4]) for (const m of a.metrics) expect(m.null_reason === null).toBe(m.value !== null)
  })

  it('lists consents with subject codes, including the revoked one', async () => {
    const { client } = seed()
    const { document } = await exportAll(client, { now: NOW })
    expect(document.consents).toEqual([
      { scope: 'on_device_processing', subject_code: null, form_reference: 'app-consent-v1', granted_on: '2026-11-15', revoked_on: null, created_at: at(3) },
      { scope: 'ai_metrics_only', subject_code: null, form_reference: 'app-consent-v1', granted_on: '2026-11-15', revoked_on: '2026-11-16', created_at: at(4) },
      { scope: 'keypoints_and_metrics_storage', subject_code: 'S01', form_reference: 'FORM-0007', granted_on: '2026-10-01', revoked_on: null, created_at: at(5) },
    ])
  })

  it('adds keypoint files as separate gzip blobs when asked', async () => {
    const { db, client } = seed()
    db.objects.delete(`keypoints/${kp(UID, 'att-4')}`)
    const { document, keypoints, keypointsUnavailable } = await exportAll(client, { includeKeypoints: true, now: NOW })
    expect(keypoints.map((f) => f.path)).toEqual(['keypoints/att-1.json.gz'])
    expect(keypoints[0].blob.size).toBe(64)
    expect(keypoints[0].blob.type).toBe('application/gzip')
    // One file that can't be read is reported; the export is still complete.
    expect(keypointsUnavailable).toEqual([
      { attempt_id: 'att-4', code: 'not_found', message: 'The pose data for this clip couldn’t be read.' },
    ])
    expect(document.includes.keypoint_files).toBe(true)
    expect(document.sessions[0].attempts[0].keypoints).toMatchObject({ file: 'keypoints/att-1.json.gz', file_null_reason: null })
    expect(document.sessions[1].attempts[0].keypoints).toMatchObject({ file: null, file_null_reason: 'not_available' })
    // Only the keypoints bucket was read, and only the caller's folder.
    expect(db.ops.filter((o) => o.startsWith('storage.'))).toEqual(['storage.download:keypoints', 'storage.download:keypoints'])
  })

  it('does not pass on a stored object that is not a gzip file', async () => {
    const { db, client } = seed()
    db.put('keypoints', kp(UID, 'att-1'), new Blob([new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])], { type: 'video/mp4' }))
    const { keypoints, keypointsUnavailable } = await exportAll(client, { includeKeypoints: true })
    expect(keypoints.map((f) => f.path)).toEqual(['keypoints/att-4.json.gz'])
    expect(keypointsUnavailable).toMatchObject([{ attempt_id: 'att-1', code: 'not_keypoints' }])
  })

  it('reads every page of a long table', async () => {
    const { db, client } = seed()
    db.pageSize = 1000
    for (let i = 0; i < 1500; i++) {
      db.add('attempts', {
        id: `bulk-${String(i).padStart(4, '0')}`,
        owner_id: UID,
        session_id: 'ses-2',
        source: 'study_dataset',
        status: 'queued',
        created_at: at(100),
      })
    }
    const { document } = await exportAll(client)
    expect(document.counts.attempts).toBe(1504)
    expect(new Set(document.sessions[1].attempts.map((a) => a.id)).size).toBe(1501)
    expect(db.ops.filter((o) => o === 'select:attempts')).toHaveLength(2)
  })
})

// ---------- what an export may contain ----------

describe('export contents', () => {
  const FORBIDDEN_KEYS = [
    'owner_id',
    'user_id',
    'email',
    'display_name',
    'name',
    'notes',
    'video_path',
    'video_sha256',
    'storage_path',
    'input_hash',
    'role',
  ]
  const LABEL_KEYS = ['title', 'label', 'clip_name']

  function expectClean(text: string) {
    expect(text).not.toContain(UID)
    expect(text).not.toContain(OTHER_UID)
    expect(text).not.toContain(EMAIL)
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
    expect(text).not.toMatch(/\.(mp4|mov|webm|jpe?g|png)\b/i)
    expect(text).not.toMatch(/data:(video|image)|blob:/)
    expect(text).not.toContain('S09')
    expect(text).not.toContain('o-att')
    expect(text).not.toContain('other-person')
  }

  it('has no video, frame, path, hash, email, name or user id in the JSON, the CSV or the files', async () => {
    const { db, client } = seed()
    const bundle = await exportAll(client, { includeKeypoints: true, now: NOW })
    const csv = await exportMetricsCsv(client)

    const keys = keysOf(bundle.document)
    for (const k of [...FORBIDDEN_KEYS, ...LABEL_KEYS]) expect(keys.has(k), k).toBe(false)
    for (const text of [bundle.json, csv]) {
      expectClean(text)
      expect(text).not.toContain(NAME)
    }
    for (const f of bundle.keypoints) {
      expect(f.path).toMatch(/^keypoints\/[\w-]+\.json\.gz$/)
      expect(f.blob.type).not.toMatch(/^(video|image)\//)
    }
    expect(JSON.stringify(bundle.keypointsUnavailable)).not.toContain(UID)

    // The requests themselves never ask for those columns, the profile or the videos bucket.
    expect(db.selects.map((s) => s.table)).not.toContain('profiles')
    for (const s of db.selects) {
      expect(s.cols).not.toMatch(/\*|owner_id|video_path|video_sha256|storage_path|input_hash|notes|display_name/)
    }
    expect(db.ops.some((o) => o.endsWith(':videos'))).toBe(false)
    expect(db.ops.some((o) => o.startsWith('delete:') || o.startsWith('storage.remove'))).toBe(false)
  })

  it('adds typed labels only when asked, and a clip name without its folder', async () => {
    const { client } = seed()
    const { document, json } = await exportAll(client, { includeLabels: true, now: NOW })
    expect(document.includes.labels).toBe(true)
    expect(document.sessions[0].title).toBe(`${NAME}, "front" view`)
    expect(document.sessions[0].attempts[0]).toMatchObject({ label: `${NAME} take 1`, clip_name: 'S01_releve_take1.mp4' })
    expect(json).not.toContain('C:\\\\clips')
    const keys = keysOf(document)
    for (const k of FORBIDDEN_KEYS) expect(keys.has(k), k).toBe(false)
    expect(json).not.toContain(UID)
    // Subject notes are never exported.
    expect(json).not.toContain('filmed from the left')
  })

  it('drops a subject code that is not a code', () => {
    const rows: ExportRows = {
      subjects: [{ id: 'sub-x', subject_code: NAME }],
      sessions: [{ id: 's', subject_id: 'sub-x', movement_type: 'pirouette', title: null, recorded_on: null, camera_view: null, created_at: at(1) }],
      attempts: [],
      keypoints: [],
      metrics: [],
      feedback: [],
      consents: [],
    }
    const doc = buildExportDocument(rows, { now: NOW })
    expect(doc.sessions[0].subject_code).toBeNull()
    expect(JSON.stringify(doc)).not.toContain(NAME)
  })

  it('exports only the signed-in account, even without row-level security', async () => {
    const { db, client } = seed()
    db.rls = false
    const { document, json } = await exportAll(client, { includeKeypoints: true })
    expect(document.counts).toMatchObject({ sessions: 2, attempts: 4, consents: 3 })
    expectClean(json)
    expectClean(await exportMetricsCsv(client))
  })
})

// ---------- CSV ----------

describe('metrics CSV', () => {
  it('has a fixed header and one row per attempt × metric', async () => {
    const { client } = seed()
    const csv = await exportMetricsCsv(client)
    expect(csv.charCodeAt(0)).not.toBe(0xfeff)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    const rows = parseCsv(csv)
    expect(rows[0]).toEqual([...METRICS_CSV_COLUMNS])
    expect(rows[0].join(',')).toBe(
      'session_id,subject_code,movement,recorded_on,camera_view,attempt_id,attempt_source,attempt_status,' +
        'attempt_created_at,metric,unit,value,null_reason,confidence_level,confidence_score,algorithm_version,computed_at',
    )
    expect(rows).toHaveLength(1 + 4 * 5)
    for (const r of rows) expect(r).toHaveLength(METRICS_CSV_COLUMNS.length)
    expect(rows[1].join(',')).toBe(
      `ses-1,S01,releve_balance,2026-11-10,front,att-1,study_dataset,done,${at(21)},trunk_inclination_deg,deg,3.2,,high,0.91,0.1.0,${at(40)}`,
    )
  })

  it('writes a missing value as an empty cell with its reason, never as 0', async () => {
    const { client } = seed()
    const [header, ...rows] = parseCsv(await exportMetricsCsv(client))
    const col = (name: string) => header.indexOf(name)
    const find = (attempt: string, metric: string) => rows.find((r) => r[col('attempt_id')] === attempt && r[col('metric')] === metric)!
    const cells = (r: string[]) => [r[col('value')], r[col('null_reason')], r[col('confidence_level')], r[col('confidence_score')]]

    expect(cells(find('att-1', 'pelvis_ankle_offset_norm'))).toEqual(['0', '', 'medium', '0.62'])
    expect(cells(find('att-1', 'knee_tracking_dev_deg'))).toEqual(['', 'knee_not_bent', 'low', '0'])
    expect(cells(find('att-1', 'turn_count'))).toEqual(['', 'not_applicable', 'low', '0'])
    expect(cells(find('att-2', 'trunk_inclination_deg'))).toEqual(['', 'processing_failed', '', ''])
    expect(cells(find('att-3', 'balance_duration_s'))).toEqual(['', 'not_processed', '', ''])
    expect(cells(find('att-4', 'balance_duration_s'))).toEqual(['', 'not_measured', '', ''])
    expect(cells(find('att-4', 'turn_count'))).toEqual(['1.75', '', 'low', '0.4'])

    // Exactly the empty values have a reason; no metrics row means no version or time either.
    for (const r of rows) expect(r[col('value')] === '').toBe(r[col('null_reason')] !== '')
    expect(find('att-2', 'turn_count')[col('algorithm_version')]).toBe('')
    expect(find('att-2', 'turn_count')[col('computed_at')]).toBe('')
    // A session without a subject or a date has empty cells, not "null".
    expect(find('att-4', 'turn_count').slice(0, 5)).toEqual(['ses-2', '', 'pirouette', '', ''])
    expect(rows.flat()).not.toContain('null')
    expect(rows.flat()).not.toContain('NaN')
  })

  it('escapes commas, quotes, line breaks, outer spaces and formula starts', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('two\r\nlines')).toBe('"two\r\nlines"')
    expect(csvCell(' padded ')).toBe('" padded "')
    expect(csvCell('relevé — équilibre')).toBe('relevé — équilibre')
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)")
    expect(csvCell('@cmd')).toBe("'@cmd")
    expect(csvCell('-2,5')).toBe('"\'-2,5"')
    // Numbers are written as they are; a negative number is not a formula.
    expect(csvCell(-2.5)).toBe('-2.5')
    expect(csvCell(0)).toBe('0')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(Number.NaN)).toBe('')
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('')
    expect(csvCell(true)).toBe('true')
  })

  it('survives awkward text in a row and reads back unchanged', () => {
    const awkward = 'no lift, "heel" stayed\r\ndown'
    const doc: ExportDocument = buildExportDocument(
      {
        subjects: [{ id: 'sub-1', subject_code: 'S01' }],
        sessions: [{ id: 'ses, "1"', subject_id: 'sub-1', movement_type: 'releve_balance', title: null, recorded_on: null, camera_view: 'front', created_at: at(1) }],
        attempts: [{ id: 'att-1', session_id: 'ses, "1"', source: 'study_dataset', label: null, clip_name: null, duration_s: 1, fps: 30, status: 'done', error: null, created_at: at(2) }],
        keypoints: [],
        metrics: [
          {
            attempt_id: 'att-1',
            movement: 'releve_balance',
            trunk_inclination_deg: Number.NaN,
            pelvis_ankle_offset_norm: -0.5,
            balance_duration_s: null,
            knee_tracking_dev_deg: null,
            turn_count: null,
            phases: [],
            confidence: { balance_duration_s: { level: 'low', score: 0, reason: awkward } } as never,
            algorithm_version: '=1+1',
            computed_at: at(3),
          },
        ],
        feedback: [],
        consents: [],
      },
      { now: NOW },
    )
    const [header, ...rows] = parseCsv(metricsCsv(doc))
    const col = (name: string) => header.indexOf(name)
    expect(rows).toHaveLength(5)
    for (const r of rows) expect(r).toHaveLength(header.length)
    expect(rows[0][col('session_id')]).toBe('ses, "1"')
    // NaN is not a measurement.
    expect([rows[0][col('value')], rows[0][col('null_reason')]]).toEqual(['', 'not_measured'])
    expect(rows[1][col('value')]).toBe('-0.5')
    expect(rows[2][col('null_reason')]).toBe(awkward)
    expect(rows[2][col('algorithm_version')]).toBe("'=1+1")
  })

  it('is only a header when there is nothing to export', async () => {
    const db = new FakeDb()
    expect(await exportMetricsCsv(db.client())).toBe(METRICS_CSV_COLUMNS.join(',') + '\r\n')
    const { document } = await exportAll(db.client(), { now: NOW })
    expect(document).toMatchObject({ sessions: [], consents: [], counts: { sessions: 0, attempts: 0 } })
  })
})

// ---------- delete ----------

const mine = (db: FakeDb, table: string) => db.rows(table).filter((r) => r.owner_id === UID)
const ZERO = { feedback: 0, attempt_metrics: 0, attempt_keypoints: 0, attempts: 0, sessions: 0, consents: 0, subjects: 0 }

describe('deleteAllMyData', () => {
  it('removes stored files first, then rows from children to parents, and counts them', async () => {
    const { db, client } = seed()
    const report = await deleteAllMyData(client)

    expect(report).toEqual({
      scope: 'all',
      rows: { feedback: 1, attempt_metrics: 2, attempt_keypoints: 2, attempts: 4, sessions: 2, consents: 3, subjects: 2 },
      objects: { keypoints: 2, videos: 1 },
      failedObjects: [],
      keptAttempts: [],
      complete: true,
      remaining: ['sign-in account', 'profile'],
    })
    expect(Object.keys(report.rows)).toEqual([...DELETE_ORDER])

    // Order of the requests that change something.
    const changes = db.ops.filter((o) => o.startsWith('delete:') || o.startsWith('storage.remove:'))
    expect(changes).toEqual([
      'storage.remove:keypoints',
      'storage.remove:videos',
      'delete:feedback',
      'delete:attempt_metrics',
      'delete:attempt_keypoints',
      'delete:attempts',
      'delete:sessions',
      'delete:consents',
      'delete:subjects',
    ])
    const firstDelete = db.ops.findIndex((o) => o.startsWith('delete:'))
    expect(db.ops.slice(firstDelete).some((o) => o.startsWith('storage.'))).toBe(false)

    for (const t of DELETE_ORDER) expect(mine(db, t), t).toHaveLength(0)
    expect(db.paths('keypoints').filter((p) => p.startsWith(UID))).toEqual([])
    expect(db.paths('videos').filter((p) => p.startsWith(UID))).toEqual([])
    // The profile goes with the sign-in account, which the browser can't remove.
    expect(mine(db, 'profiles')).toHaveLength(1)
    expect(db.ops).not.toContain('delete:profiles')
    expectOtherAccountUntouched(db)
  })

  it('can be run again: the second run finds nothing and changes nothing', async () => {
    const { db, client } = seed()
    await deleteAllMyData(client)
    db.ops = []
    db.removeCalls = []
    const again = await deleteAllMyData(client)
    expect(again).toMatchObject({ rows: ZERO, objects: { keypoints: 0, videos: 0 }, failedObjects: [], complete: true })
    expect(db.removeCalls).toEqual([])
    expectOtherAccountUntouched(db)
  })

  it('only sends the caller’s own paths and rows, even without row-level security', async () => {
    const { db, client } = seed()
    db.rls = false
    // A row that points outside the caller's folder is reported and never sent.
    mine(db, 'attempts').find((a) => a.id === 'att-4')!.video_path = `${OTHER_UID}/o-att.mp4`
    const report = await deleteAllMyData(client)

    for (const call of db.removeCalls) for (const p of call.paths) expect(p.startsWith(`${UID}/`)).toBe(true)
    expect(report.failedObjects).toEqual([
      { bucket: 'videos', path: `${OTHER_UID}/o-att.mp4`, code: 'outside_own_folder', message: expect.any(String) },
    ])
    expect(report.complete).toBe(false)
    expect(report.rows.attempts).toBe(4)
    for (const t of DELETE_ORDER) expect(mine(db, t), t).toHaveLength(0)
    expectOtherAccountUntouched(db)
  })

  it('reports a file that the server left in place, and finds it again on the next run', async () => {
    const { db, client } = seed()
    const key = `keypoints/${kp(UID, 'att-1')}`
    db.stuck.add(key)
    const report = await deleteAllMyData(client)
    expect(report.failedObjects).toEqual([
      { bucket: 'keypoints', path: kp(UID, 'att-1'), code: 'not_removed', message: 'This file is still stored.' },
    ])
    expect(report.objects).toEqual({ keypoints: 1, videos: 1 })
    expect(report.complete).toBe(false)
    // Rows are gone all the same; the file is found by listing the folder next time.
    expect(report.rows.attempts).toBe(4)
    expect(db.objects.has(key)).toBe(true)

    db.stuck.clear()
    const again = await deleteAllMyData(client)
    expect(again).toMatchObject({ rows: ZERO, objects: { keypoints: 1, videos: 0 }, failedObjects: [], complete: true })
    expect(db.objects.has(key)).toBe(false)
  })

  it('reports a storage error per file and still clears the other bucket and the rows', async () => {
    const { db, client } = seed()
    db.failOn('storage.remove:keypoints', { message: 'upstream connect error', status: 400, statusCode: '503' })
    const report = await deleteAllMyData(client)
    expect(report.failedObjects.map((f) => [f.bucket, f.path, f.code])).toEqual([
      ['keypoints', kp(UID, 'att-1'), 'network'],
      ['keypoints', kp(UID, 'att-4'), 'network'],
    ])
    expect(report.failedObjects[0].message).not.toMatch(/upstream/)
    expect(report.objects).toEqual({ keypoints: 0, videos: 1 })
    expect(report.rows.attempts).toBe(4)
    expect(report.complete).toBe(false)
  })

  it('says so when the folder can’t be checked afterwards', async () => {
    const { db, client } = seed()
    // The first listing of each bucket works; the check after removing keypoints does not.
    let lists = 0
    const real = db.begin.bind(db)
    db.begin = (op: string) => {
      if (op === 'storage.list:keypoints' && ++lists === 2) {
        db.ops.push(op)
        return { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 }
      }
      return real(op)
    }
    const report = await deleteAllMyData(client)
    expect(report.failedObjects).toEqual([
      { bucket: 'keypoints', path: `${UID}/`, code: 'network', message: 'Your stored files couldn’t be checked after the delete.' },
    ])
    expect(report.complete).toBe(false)
  })
})

describe('deleteAttemptData', () => {
  it('removes the files, then the attempt with its keypoints record, metrics and notes', async () => {
    const { db, client } = seed()
    const report = await deleteAttemptData(client, 'att-1')
    expect(report).toEqual({
      scope: 'attempt',
      rows: { ...ZERO, feedback: 1, attempt_metrics: 1, attempt_keypoints: 1, attempts: 1 },
      objects: { keypoints: 1, videos: 0 },
      failedObjects: [],
      keptAttempts: [],
      complete: true,
      remaining: [],
    })
    expect(db.ops.filter((o) => o.startsWith('delete:') || o.startsWith('storage.remove:'))).toEqual([
      'storage.remove:keypoints',
      'delete:feedback',
      'delete:attempt_metrics',
      'delete:attempt_keypoints',
      'delete:attempts',
    ])
    expect(db.removeCalls).toEqual([{ bucket: 'keypoints', paths: [kp(UID, 'att-1')] }])
    expect(mine(db, 'attempts').map((a) => a.id)).toEqual(['att-2', 'att-3', 'att-4'])
    expect(mine(db, 'sessions')).toHaveLength(2)
    expect(db.objects.has(`keypoints/${kp(UID, 'att-4')}`)).toBe(true)
    expectOtherAccountUntouched(db)
  })

  it('removes a stored clip of a user upload too', async () => {
    const { db, client } = seed()
    const report = await deleteAttemptData(client, 'att-4')
    expect(report.objects).toEqual({ keypoints: 1, videos: 1 })
    expect(db.removeCalls).toEqual([
      { bucket: 'keypoints', paths: [kp(UID, 'att-4')] },
      { bucket: 'videos', paths: [`${UID}/att-4.mp4`] },
    ])
    expect(db.paths('videos')).toEqual([`${OTHER_UID}/o-att.mp4`])
  })

  it('is idempotent: an attempt that is already gone gives zeros', async () => {
    const { db, client } = seed()
    await deleteAttemptData(client, 'att-1')
    const again = await deleteAttemptData(client, 'att-1')
    expect(again).toMatchObject({ rows: ZERO, objects: { keypoints: 0, videos: 0 }, failedObjects: [], keptAttempts: [], complete: true })
    expect((await deleteAttemptData(client, 'never-existed')).complete).toBe(true)
    expect(mine(db, 'attempts')).toHaveLength(3)
  })

  it('keeps the rows when a file could not be removed, so it can be run again', async () => {
    const { db, client } = seed()
    db.failOn('storage.remove:keypoints', { message: 'new row violates row-level security policy', status: 400, statusCode: '403' })
    const report = await deleteAttemptData(client, 'att-1')
    expect(report.failedObjects).toEqual([
      { bucket: 'keypoints', path: kp(UID, 'att-1'), code: 'permission', message: 'This account can’t change that item.' },
    ])
    expect(report.keptAttempts).toEqual(['att-1'])
    expect(report.complete).toBe(false)
    expect(report.rows).toEqual(ZERO)
    expect(db.ops.some((o) => o.startsWith('delete:'))).toBe(false)
    expect(mine(db, 'attempts')).toHaveLength(4)
    expect(mine(db, 'feedback')).toHaveLength(1)

    const retry = await deleteAttemptData(client, 'att-1')
    expect(retry).toMatchObject({ complete: true, rows: { attempts: 1, feedback: 1 }, objects: { keypoints: 1, videos: 0 } })
  })

  it('treats another account’s attempt as already gone and touches nothing', async () => {
    const { db, client } = seed()
    for (const rls of [true, false]) {
      db.rls = rls
      const report = await deleteAttemptData(client, 'o-att')
      expect(report).toMatchObject({ rows: ZERO, objects: { keypoints: 0, videos: 0 } })
      for (const call of db.removeCalls) for (const p of call.paths) expect(p.startsWith(`${UID}/`)).toBe(true)
      expectOtherAccountUntouched(db)
    }
  })
})

describe('deleteSessionData', () => {
  it('removes the session, its attempts and their files, and leaves the subject', async () => {
    const { db, client } = seed()
    const report = await deleteSessionData(client, 'ses-1')
    expect(report).toMatchObject({
      scope: 'session',
      rows: { ...ZERO, feedback: 1, attempt_metrics: 1, attempt_keypoints: 1, attempts: 3, sessions: 1 },
      objects: { keypoints: 1, videos: 0 },
      failedObjects: [],
      complete: true,
    })
    expect(db.ops.filter((o) => o.startsWith('delete:') || o.startsWith('storage.remove:'))).toEqual([
      'storage.remove:keypoints',
      'delete:feedback',
      'delete:attempt_metrics',
      'delete:attempt_keypoints',
      'delete:attempts',
      'delete:sessions',
    ])
    expect(mine(db, 'sessions').map((s) => s.id)).toEqual(['ses-2'])
    expect(mine(db, 'attempts').map((a) => a.id)).toEqual(['att-4'])
    expect(mine(db, 'subjects')).toHaveLength(2)
    expect(db.objects.has(`keypoints/${kp(UID, 'att-4')}`)).toBe(true)
    expectOtherAccountUntouched(db)

    const again = await deleteSessionData(client, 'ses-1')
    expect(again).toMatchObject({ rows: ZERO, complete: true })
  })

  it('keeps the session and the attempt whose file stayed, and removes the rest', async () => {
    const { db, client } = seed()
    db.stuck.add(`keypoints/${kp(UID, 'att-1')}`)
    const report = await deleteSessionData(client, 'ses-1')
    expect(report.failedObjects.map((f) => [f.path, f.code])).toEqual([[kp(UID, 'att-1'), 'not_removed']])
    expect(report.keptAttempts).toEqual(['att-1'])
    expect(report.complete).toBe(false)
    expect(report.rows).toMatchObject({ attempts: 2, sessions: 0, feedback: 0 })
    expect(mine(db, 'attempts').map((a) => a.id)).toEqual(['att-1', 'att-4'])
    expect(mine(db, 'sessions')).toHaveLength(2)

    db.stuck.clear()
    expect(await deleteSessionData(client, 'ses-1')).toMatchObject({ complete: true, rows: { attempts: 1, sessions: 1, feedback: 1 } })
  })

  it('does not delete another account’s session', async () => {
    const { db, client } = seed()
    db.rls = false
    expect(await deleteSessionData(client, 'o-ses')).toMatchObject({ rows: ZERO })
    expect(db.removeCalls).toEqual([])
    expectOtherAccountUntouched(db)
  })
})

// ---------- errors ----------

describe('errors', () => {
  it('asks for sign-in before any request', async () => {
    const { db, client } = seed()
    db.uid = null
    for (const call of [
      exportAll(client),
      exportMetricsCsv(client),
      deleteAttemptData(client, 'att-1'),
      deleteSessionData(client, 'ses-1'),
      deleteAllMyData(client),
    ]) {
      const e = await rejection(call)
      expect(e.code).toBe('not_signed_in')
      expect(e.status).toBe(401)
    }
    expect(db.ops).toEqual([])
  })

  it('maps a failed read without leaking the server message, and exports nothing partial', async () => {
    const { db, client } = seed()
    db.failOn('select:attempt_metrics', { code: 'PGRST301', message: 'JWT expired' }, 401)
    expect((await rejection(exportAll(client))).code).toBe('not_signed_in')
    db.failOn('select:sessions', new TypeError('Failed to fetch'))
    expect((await rejection(exportMetricsCsv(client))).code).toBe('network')
    db.failOn('select:feedback', { message: 'relation "feedback" has a problem' }, 400)
    const e = await rejection(exportAll(client))
    expect(e.code).toBe('export_failed')
    expect(e.message).toBe('The export couldn’t be prepared.')
    expect(e.recovery).toBeTruthy()
    expect(`${e.message} ${e.recovery}`).not.toMatch(/relation|feedback/)
  })

  it('maps a failed row delete and can be finished by running it again', async () => {
    const { db, client } = seed()
    db.failOn('delete:attempts', { code: '42501', message: 'permission denied for table attempts' }, 403)
    const e = await rejection(deleteAllMyData(client))
    expect(e.code).toBe('permission')
    expect(`${e.message} ${e.recovery}`).not.toMatch(/denied|table/)
    // Children went, parents stayed: nothing is left pointing at a missing row.
    expect(mine(db, 'feedback')).toHaveLength(0)
    expect(mine(db, 'attempts')).toHaveLength(4)
    expect(mine(db, 'sessions')).toHaveLength(2)

    const retry = await deleteAllMyData(client)
    expect(retry).toMatchObject({ complete: true, rows: { feedback: 0, attempts: 4, sessions: 2, consents: 3, subjects: 2 } })

    db.failOn('delete:feedback', { message: 'something else' }, 400)
    const seeded = seed(db)
    const generic = await rejection(deleteAttemptData(seeded.client, 'att-1'))
    expect(generic.code).toBe('delete_failed')
    expect(generic.message).toBe('That couldn’t be deleted.')
  })

  it('stops before changing anything when the attempts can’t be read', async () => {
    const { db, client } = seed()
    db.failOn('select:attempts', { message: 'upstream connect error' }, 503)
    expect((await rejection(deleteAllMyData(client))).code).toBe('network')
    expect(db.ops).toEqual(['select:attempts'])
    expect(mine(db, 'attempts')).toHaveLength(4)
  })

  it('does not pretend to delete the sign-in account', async () => {
    const { db, client } = seed()
    const e = await rejection(deleteAccount(client))
    expect(e.code).toBe('account_deletion_unavailable')
    expect(e.status).toBe(501)
    expect(e.recovery).toMatch(/Delete all your data/)
    expect(db.ops).toEqual([])
    expect([...ACCOUNT_REMAINS]).toEqual(['sign-in account', 'profile'])
  })
})

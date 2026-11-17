// FR-3.1.5 / NFR privacy: two-user row level security check against the real project.
//
//   npm run check:rls
//
// Signs in as the test account (A, TEST_ACCOUNT_EMAIL / TEST_ACCOUNT_PASSWORD in
// .env.local) and creates a throwaway account (B, rls-check-<random>@<A's domain>, random
// password made here and never printed). Each account then tries to read, list, update,
// delete and insert the other's rows and keypoint files with the publishable key only,
// as the browser would. Every attempt must come back empty or refused.
//
// Safety: anything that would change data if RLS were broken (update, delete, remove)
// only ever targets throwaway rows: B's own, and a small set of rows + one file that A
// creates for this run and removes at the end. A's real data is only read (one real
// keypoints path is used for the download / list checks). The profile update writes the
// value the row already has. B is deleted at the end through the deployed Edge Function
// `delete-account`, exactly as Settings → Delete account does.
//
// Prints a PASS/FAIL table (no emails, passwords, tokens or file contents). Exit code 1
// on any FAIL.

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

// ---------- env ----------

function readEnv() {
  const env = {}
  if (existsSync('.env.local')) {
    const text = readFileSync('.env.local', 'utf8').replace(/^﻿/, '')
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
      if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  return { ...env, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k in env || /^(VITE_SUPABASE|TEST_ACCOUNT)/.test(k))) }
}

const env = readEnv()
const URL_ = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY
const A_EMAIL = env.TEST_ACCOUNT_EMAIL
const A_PASSWORD = env.TEST_ACCOUNT_PASSWORD
if (!URL_ || !KEY || !A_EMAIL || !A_PASSWORD) {
  console.log('SKIP: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, TEST_ACCOUNT_EMAIL and TEST_ACCOUNT_PASSWORD are needed in .env.local.')
  process.exit(0)
}

const newClient = () =>
  createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })

// ---------- results ----------

const results = []
function record(area, check, pass, detail = '') {
  results.push({ area, check, pass, detail })
}
const errText = (e) => (e ? `${e.code ?? e.statusCode ?? e.status ?? 'error'}` : '')

// ---------- tables ----------

// pk, a column to tamper with in an update, and a minimal insert row for each table.
const TABLES = {
  profiles: { pk: 'id' },
  subjects: { pk: 'id', tamper: { notes: 'rls-check tampered' } },
  consents: { pk: 'id', tamper: { form_reference: 'rls-check tampered' } },
  sessions: { pk: 'id', tamper: { title: 'rls-check tampered' } },
  attempts: { pk: 'id', tamper: { label: 'rls-check tampered' } },
  attempt_keypoints: { pk: 'attempt_id', tamper: { frame_count: 424242 } },
  attempt_metrics: { pk: 'attempt_id', tamper: { algorithm_version: 'rls-check tampered' } },
  feedback: { pk: 'id', tamper: { model: 'rls-check tampered' } },
}

function insertRow(table, owner, fx) {
  switch (table) {
    case 'profiles':
      return { id: owner, owner_id: owner, display_name: 'rls-check' }
    case 'subjects':
      return { owner_id: owner, subject_code: 'S89' }
    case 'consents':
      return { owner_id: owner, scope: 'rls_check' }
    case 'sessions':
      return { owner_id: owner, movement_type: 'releve_balance', title: 'rls-check' }
    case 'attempts':
      return { owner_id: owner, session_id: fx.session, source: 'study_dataset' }
    case 'attempt_keypoints':
      return { owner_id: owner, attempt_id: fx.attempt, storage_path: `${owner}/${fx.attempt}.json.gz`, frame_count: 1 }
    case 'attempt_metrics':
      return { owner_id: owner, attempt_id: fx.attempt, movement: 'releve_balance', algorithm_version: 'rls-check' }
    case 'feedback':
      return { owner_id: owner, attempt_id: fx.attempt, model: 'rls-check', prompt_version: 'rls-check', input_hash: 'rls-check', response: {} }
  }
}

// ---------- fixtures: a small set of synthetic rows + one keypoints file per account ----------

const must = (res, what) => {
  if (res.error) throw new Error(`${what}: ${errText(res.error)} ${res.error.message ?? ''}`)
  return res.data
}

async function makeFixtures(c, uid, label) {
  const existing = must(await c.from('subjects').select('subject_code'), `${label} subjects`).map((r) => r.subject_code)
  const code = ['S99', 'S98', 'S97', 'S96', 'S95'].find((s) => !existing.includes(s))
  if (!code) throw new Error(`${label}: no free subject code for the fixture`)
  const fx = { uid, code }
  fx.subject = must(await c.from('subjects').insert({ subject_code: code, notes: 'rls-check fixture' }).select('id').single(), `${label} subject`).id
  fx.consent = must(await c.from('consents').insert({ scope: 'rls_check_fixture' }).select('id').single(), `${label} consent`).id
  fx.session = must(
    await c.from('sessions').insert({ subject_id: fx.subject, movement_type: 'releve_balance', title: 'rls-check fixture', camera_view: 'front' }).select('id').single(),
    `${label} session`,
  ).id
  fx.attempt = must(
    await c.from('attempts').insert({ session_id: fx.session, source: 'study_dataset', label: 'rls-check fixture', status: 'done' }).select('id').single(),
    `${label} attempt`,
  ).id
  fx.path = `${uid}/${fx.attempt}.json.gz`
  const body = gzipSync(Buffer.from(JSON.stringify({ rls_check: true, frames: [] })))
  must(await c.storage.from('keypoints').upload(fx.path, body, { contentType: 'application/gzip', upsert: true }), `${label} keypoints file`)
  must(await c.from('attempt_keypoints').insert({ attempt_id: fx.attempt, storage_path: fx.path, frame_count: 0, size_bytes: body.length }), `${label} keypoints row`)
  must(await c.from('attempt_metrics').insert({ attempt_id: fx.attempt, movement: 'releve_balance', algorithm_version: 'rls-check' }), `${label} metrics row`)
  fx.feedback = must(
    await c.from('feedback').insert({ attempt_id: fx.attempt, model: 'rls-check', prompt_version: 'rls-check', input_hash: 'rls-check', response: {} }).select('id').single(),
    `${label} feedback`,
  ).id
  fx.ids = {
    profiles: uid,
    subjects: fx.subject,
    consents: fx.consent,
    sessions: fx.session,
    attempts: fx.attempt,
    attempt_keypoints: fx.attempt,
    attempt_metrics: fx.attempt,
    feedback: fx.feedback,
  }
  return fx
}

async function dropFixtures(c, fx) {
  if (!fx) return
  // Session delete cascades to attempts, keypoints row, metrics and feedback.
  if (fx.path) await c.storage.from('keypoints').remove([fx.path])
  if (fx.session) await c.from('sessions').delete().eq('id', fx.session)
  if (fx.consent) await c.from('consents').delete().eq('id', fx.consent)
  if (fx.subject) await c.from('subjects').delete().eq('id', fx.subject)
}

// ---------- the checks: `viewer` against `owner`'s rows ----------

async function crossChecks(dir, viewer, ownerClient, owner, fx, realPath) {
  for (const [table, def] of Object.entries(TABLES)) {
    const id = fx.ids[table]
    const area = `${dir} ${table}`

    // Control: the owner sees its own row, so an empty answer below means RLS, not a bad id.
    const own = await ownerClient.from(table).select(def.pk).eq(def.pk, id)
    record(area, 'owner reads own row (control)', !own.error && own.data.length === 1, errText(own.error))

    const byId = await viewer.from(table).select('*').eq(def.pk, id)
    record(area, 'select by id → nothing', !!byId.error || byId.data.length === 0, byId.error ? `refused ${errText(byId.error)}` : `${byId.data.length} rows`)

    const byOwner = await viewer.from(table).select(def.pk).eq('owner_id', owner)
    record(area, 'select by owner_id → nothing', !!byOwner.error || byOwner.data.length === 0, byOwner.error ? `refused ${errText(byOwner.error)}` : `${byOwner.data.length} rows`)

    // Profiles: same value as now (a no-op even if RLS were broken); others: a fixture row.
    let patch = def.tamper
    if (table === 'profiles') {
      const cur = await ownerClient.from('profiles').select('display_name').eq('id', owner).single()
      patch = { display_name: cur.data?.display_name ?? null }
    }
    const upd = await viewer.from(table).update(patch).eq(def.pk, id).select(def.pk)
    const updOk = !!upd.error || upd.data.length === 0
    let unchanged = true
    if (table !== 'profiles') {
      const [col, val] = Object.entries(patch)[0]
      const after = await ownerClient.from(table).select(col).eq(def.pk, id).single()
      unchanged = !after.error && after.data[col] !== val
    }
    record(area, 'update → no row changed', updOk && unchanged, upd.error ? `refused ${errText(upd.error)}` : `${upd.data.length} rows matched`)

    const del = await viewer.from(table).delete().eq(def.pk, id).select(def.pk)
    const still = await ownerClient.from(table).select(def.pk).eq(def.pk, id)
    record(
      area,
      'delete → row still there',
      (!!del.error || del.data.length === 0) && !still.error && still.data.length === 1,
      del.error ? `refused ${errText(del.error)}` : `${del.data.length} rows matched`,
    )

    const ins = await viewer.from(table).insert(insertRow(table, owner, fx)).select(def.pk)
    if (!ins.error && ins.data?.length) {
      // Should never happen; clean up through the owner so nothing is left behind.
      await ownerClient.from(table).delete().eq(def.pk, ins.data[0][def.pk])
    }
    record(area, `insert with owner_id = other → refused`, !!ins.error, ins.error ? `refused ${errText(ins.error)}` : 'ROW INSERTED')
  }

  // Storage (bucket keypoints, folder = owner id).
  const area = `${dir} storage`
  const ownDl = await ownerClient.storage.from('keypoints').download(fx.path)
  record(area, 'owner downloads own file (control)', !ownDl.error, errText(ownDl.error))
  for (const [what, path] of [['fixture file', fx.path], ...(realPath ? [['real keypoints file', realPath]] : [])]) {
    const dl = await viewer.storage.from('keypoints').download(path)
    record(area, `download ${what} → refused`, !!dl.error, dl.error ? `refused ${errText(dl.error)}` : 'DOWNLOADED')
    const signed = await viewer.storage.from('keypoints').createSignedUrl(path, 60)
    record(area, `signed URL for ${what} → refused`, !!signed.error, signed.error ? `refused ${errText(signed.error)}` : 'URL ISSUED')
  }
  const list = await viewer.storage.from('keypoints').list(owner, { limit: 100 })
  record(area, "list the other's folder → empty", !!list.error || list.data.length === 0, list.error ? `refused ${errText(list.error)}` : `${list.data.length} objects`)
  const videos = await viewer.storage.from('videos').list(owner, { limit: 100 })
  record(area, "list the other's videos folder → empty", !!videos.error || videos.data.length === 0, videos.error ? `refused ${errText(videos.error)}` : `${videos.data.length} objects`)
  const up = await viewer.storage
    .from('keypoints')
    .upload(`${owner}/rls-check-${Date.now()}.json.gz`, gzipSync(Buffer.from('{}')), { contentType: 'application/gzip' })
  if (!up.error) await ownerClient.storage.from('keypoints').remove([up.data.path])
  record(area, "upload into the other's folder → refused", !!up.error, up.error ? `refused ${errText(up.error)}` : 'UPLOADED')
  const rm = await viewer.storage.from('keypoints').remove([fx.path])
  const stillThere = await ownerClient.storage.from('keypoints').download(fx.path)
  record(
    area,
    'remove the fixture file → still there',
    (!!rm.error || rm.data.length === 0) && !stillThere.error,
    rm.error ? `refused ${errText(rm.error)}` : `${rm.data.length} removed`,
  )
}

// ---------- run ----------

const a = newClient()
const b = newClient()
let fxA = null
let fxB = null
let bCreated = false
const bEmail = `rls-check-${randomBytes(4).toString('hex')}@${A_EMAIL.split('@')[1]}`
const bPassword = randomBytes(24).toString('base64url')
let fatal = null

try {
  const sa = await a.auth.signInWithPassword({ email: A_EMAIL, password: A_PASSWORD })
  if (sa.error) throw new Error(`test account sign-in failed: ${errText(sa.error)}`)
  const aId = sa.data.user.id
  record('setup', 'A signed in (test account)', true)

  const sb = await b.auth.signUp({ email: bEmail, password: bPassword })
  if (sb.error) throw new Error(`throwaway sign-up failed: ${errText(sb.error)} ${sb.error.message}`)
  bCreated = !!sb.data.user
  if (!sb.data.session) throw new Error('throwaway sign-up returned no session (is email confirmation on?)')
  const bId = sb.data.user.id
  record('setup', 'B created and signed in (throwaway)', true)

  // A real keypoints path of A (read-only checks).
  const real = await a.from('attempt_keypoints').select('storage_path').limit(1)
  const realPath = real.data?.[0]?.storage_path ?? null
  record('setup', 'A has a real keypoints file to probe', !!realPath, realPath ? '' : 'none found; only the fixture file is probed')

  fxA = await makeFixtures(a, aId, 'A')
  fxB = await makeFixtures(b, bId, 'B')
  record('setup', 'fixtures created for A and B', true)

  await crossChecks('B→A', b, a, aId, fxA, realPath)
  await crossChecks('A→B', a, b, bId, fxB, null)
} catch (e) {
  fatal = e instanceof Error ? e.message : String(e)
  record('setup', 'run completed', false, fatal)
} finally {
  // A's fixtures go first; B's go with the account.
  try {
    await dropFixtures(a, fxA)
    if (fxA) {
      const left = await a.from('sessions').select('id').eq('id', fxA.session)
      const subj = await a.from('subjects').select('id').eq('id', fxA.subject)
      // List, not download: a download right after the remove can still be served from cache.
      const name = fxA.path.split('/')[1]
      const file = await a.storage.from('keypoints').list(fxA.uid, { search: name })
      const fileLeft = (file.data ?? []).some((o) => o.name === name)
      record(
        'cleanup',
        "A's fixture rows and file removed",
        left.data?.length === 0 && subj.data?.length === 0 && !file.error && !fileLeft,
        `sessions=${left.data?.length ?? '?'} subjects=${subj.data?.length ?? '?'} file=${fileLeft ? 'left' : file.error ? errText(file.error) : 'gone'}`,
      )
    }
  } catch (e) {
    record('cleanup', "A's fixture rows and file removed", false, String(e))
  }
  if (bCreated) {
    const res = await b.functions.invoke('delete-account', { body: { confirm: 'DELETE' } })
    const report = res.data
    record(
      'cleanup',
      'B deleted through Edge Function delete-account',
      !res.error && report?.deleted === true,
      res.error ? `failed ${res.error.context?.status ?? ''}` : `rows_left=${report?.rows_left} files=${report?.objects?.keypoints ?? '?'}`,
    )
    const again = await newClient().auth.signInWithPassword({ email: bEmail, password: bPassword })
    record('cleanup', 'B can no longer sign in', !!again.error, again.error ? `refused ${errText(again.error)}` : 'SIGNED IN')
    if (fxB) {
      const gone = await a.from('sessions').select('id').eq('id', fxB.session)
      record('cleanup', "B's rows are not visible to A afterwards", !gone.error && gone.data.length === 0)
    }
  }
  await a.auth.signOut()
}

// ---------- report ----------

const w1 = Math.max(...results.map((r) => r.area.length), 4)
const w2 = Math.max(...results.map((r) => r.check.length), 5)
console.log(`${'AREA'.padEnd(w1)}  ${'CHECK'.padEnd(w2)}  RESULT  DETAIL`)
console.log(`${'-'.repeat(w1)}  ${'-'.repeat(w2)}  ------  ------`)
for (const r of results) console.log(`${r.area.padEnd(w1)}  ${r.check.padEnd(w2)}  ${r.pass ? 'PASS  ' : 'FAIL  '}  ${r.detail}`)
const failed = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

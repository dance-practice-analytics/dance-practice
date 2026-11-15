// Typed client for the DAD Session API (Development Document 2.3.4). With no
// VITE_DAD_API_URL it uses the in-browser mock, so the UI never waits on the
// backend or on MovAI data.
//
// MT-2: when VITE_SUPABASE_URL is set, accounts go through Supabase Auth
// (FR-3.1.1, 3.1.2, 3.1.7) and the session data still comes from the mock
// until import, pose and metrics are wired to Postgres (build steps 2–4).

import { ApiError } from './errors'
import { authError } from './authErrors'
import { supabase } from './supabase'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { AttemptsUpdate, CreateSessionRequest, Job, SessionPatch, SessionResults, SessionSummary } from '../types'

export interface Account {
  /** Code that identifies the account in exports and the study log; never a name or an email. */
  participant: string
  /** What to call the user on screen. Falls back to the code. */
  name?: string
  email?: string
}

export type ExportFormat = 'json' | 'csv'

export interface DadApi {
  me(): Promise<Account | null>
  /** Email + password with Supabase Auth; participant code + passcode on the mock. */
  signIn(identifier: string, secret: string): Promise<Account>
  /** Create an account (Supabase Auth only). */
  signUp?(email: string, password: string): Promise<Account>
  signOut(): Promise<void>
  /** Sign-in state changed outside this call: token expired, or another tab signed in or out. Returns an unsubscribe. */
  onAuthChange?(listener: (account: Account | null) => void): () => void
  listSessions(): Promise<SessionSummary[]>
  createSession(req: CreateSessionRequest, video: File | null): Promise<SessionSummary>
  /** Upload the pose export for a session; returns the import job. */
  uploadPose(sessionId: string, file: File | null, scenario?: 'mismatch'): Promise<Job>
  getJob(jobId: string): Promise<Job>
  getSessionResults(sessionId: string): Promise<SessionResults>
  putAttempts(sessionId: string, update: AttemptsUpdate): Promise<{ boundaryRevision: number }>
  patchSession(sessionId: string, patch: SessionPatch): Promise<void>
  exportSession(sessionId: string, format: ExportFormat): Promise<Blob>
  deleteSession(sessionId: string): Promise<void>
  /** Source video for synchronized playback, when the backend serves one. */
  videoUrl(sessionId: string): string | null
}

export { ApiError }

const baseUrl = (import.meta.env.VITE_DAD_API_URL as string | undefined)?.replace(/\/$/, '')

function httpApi(base: string): DadApi {
  const id = encodeURIComponent
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const isForm = body instanceof FormData
    const res = await fetch(`${base}${path}`, {
      method,
      credentials: 'include',
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `The server could not complete this (HTTP ${res.status}).`, err?.recovery)
    }
    if (res.status === 204) return undefined as T
    const type = res.headers.get('Content-Type') ?? ''
    return (type.includes('json') ? await res.json() : await res.blob()) as T
  }
  return {
    me: () => call<Account>('GET', '/auth/me').catch((e: ApiError) => (e.status === 401 ? null : Promise.reject(e))),
    signIn: (participant, passcode) => call('POST', '/auth/session', { participant, passcode }),
    signOut: () => call('DELETE', '/auth/session'),
    listSessions: () => call('GET', '/sessions'),
    createSession(req, video) {
      const form = new FormData()
      form.set('request', JSON.stringify(req))
      if (video) form.set('video', video)
      return call('POST', '/sessions', form)
    },
    uploadPose(sessionId, file) {
      const form = new FormData()
      if (file) form.set('pose', file)
      return call('POST', `/sessions/${id(sessionId)}/pose`, form)
    },
    getJob: (jobId) => call('GET', `/jobs/${id(jobId)}`),
    getSessionResults: (sessionId) => call('GET', `/sessions/${id(sessionId)}/results`),
    putAttempts: (sessionId, update) => call('PUT', `/sessions/${id(sessionId)}/attempts`, update),
    patchSession: (sessionId, patch) => call('PATCH', `/sessions/${id(sessionId)}`, patch),
    exportSession: (sessionId, format) => call('GET', `/sessions/${id(sessionId)}/export?format=${format}`),
    deleteSession: (sessionId) => call('DELETE', `/sessions/${id(sessionId)}`),
    videoUrl: (sessionId) => `${base}/sessions/${id(sessionId)}/video`,
  }
}

/** Loads the mock lazily so it never ships in a build that points at the real API. */
function lazyMock(): DadApi {
  let loaded: DadApi | null = null
  const load = () => import('../mock/server').then((m) => (loaded = m.mockApi))
  return new Proxy({} as DadApi, {
    // videoUrl is synchronous; by the time a session's results have loaded, so has the mock.
    get: (_, key: keyof DadApi) =>
      // Optional members the mock doesn't have must read as missing, not as a callable.
      key === 'signUp' || key === 'onAuthChange' ? undefined :
      key === 'videoUrl' ? (id: string) => loaded?.videoUrl(id) ?? null : (...args: unknown[]) => load().then((api) => (api[key] as (...a: unknown[]) => unknown)(...args)),
  })
}

/** Supabase Auth in front of another DadApi, which keeps serving the session data. */
function withSupabaseAuth(sb: SupabaseClient, data: DadApi): DadApi {
  const toAccount = (user: User): Account => ({
    participant: `U${user.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
    name: user.email?.split('@')[0],
    email: user.email,
  })
  // The mock keeps one synthetic history per account code.
  const adopt = async (account: Account | null) => {
    const mock = await import('../mock/server')
    mock.adoptAccount(account?.participant ?? null)
    return account
  }
  const authApi: Partial<DadApi> = {
    async me() {
      const { data: found, error } = await sb.auth.getSession()
      if (error) throw authError(error)
      return adopt(found.session ? toAccount(found.session.user) : null)
    },
    async signIn(email, password) {
      const { data: made, error } = await sb.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw authError(error)
      return (await adopt(toAccount(made.user)))!
    },
    async signUp(email, password) {
      const { data: made, error } = await sb.auth.signUp({ email: email.trim(), password })
      if (error) throw authError(error)
      // No session means the project still asks for email confirmation.
      if (!made.session || !made.user) {
        throw new ApiError(202, 'confirm_email', 'Almost there: confirm your email to finish.', 'Open the link we sent you, then sign in.')
      }
      return (await adopt(toAccount(made.user)))!
    },
    async signOut() {
      await sb.auth.signOut({ scope: 'local' })
      await adopt(null)
    },
    onAuthChange(listener) {
      // Keep this callback free of Supabase calls: they would wait on the auth lock it runs under.
      const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
        if (event === 'INITIAL_SESSION') return
        void adopt(session ? toAccount(session.user) : null).then(listener)
      })
      return () => sub.subscription.unsubscribe()
    },
  }
  return new Proxy(authApi as DadApi, {
    get: (target, key: keyof DadApi) => (key in target ? target[key] : data[key]),
  })
}

/** True while session data is synthetic and stored in this browser. */
export const usingMockApi = !baseUrl
/** True when accounts are real (email + password); false means the mock's participant codes. */
export const usingSupabaseAuth = !baseUrl && supabase !== null
export const api: DadApi = baseUrl ? httpApi(baseUrl) : supabase ? withSupabaseAuth(supabase, lazyMock()) : lazyMock()

/** Save a Blob as a file. */
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

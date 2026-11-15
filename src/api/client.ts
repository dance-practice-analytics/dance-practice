// Typed client for the DAD Session API (Development Document 2.3.4). With no
// VITE_DAD_API_URL it uses the in-browser mock, so the UI never waits on the
// backend or on MovAI data. Credentials live in an httpOnly cookie set by the
// server; the browser never holds tokens or API keys.

import type { AttemptsUpdate, CreateSessionRequest, Job, SessionPatch, SessionResults, SessionSummary } from '../types'

export interface Account {
  participant: string
}

export type ExportFormat = 'json' | 'csv'

export interface DadApi {
  me(): Promise<Account | null>
  signIn(participant: string, passcode: string): Promise<Account>
  signOut(): Promise<void>
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

/** A typed failure from the API. `message` is safe to show to the dancer. */
export class ApiError extends Error {
  status: number
  code: string
  recovery?: string
  constructor(status: number, code: string, message: string, recovery?: string) {
    super(message)
    this.status = status
    this.code = code
    this.recovery = recovery
  }
}

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
      key === 'videoUrl' ? (id: string) => loaded?.videoUrl(id) ?? null : (...args: unknown[]) => load().then((api) => (api[key] as (...a: unknown[]) => unknown)(...args)),
  })
}

export const usingMockApi = !baseUrl
export const api: DadApi = baseUrl ? httpApi(baseUrl) : lazyMock()

/** Save a Blob as a file. */
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

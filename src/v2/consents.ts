// Consent state of the signed-in account (FR-3.1.6). Rows live in `consents`, one per
// accepted scope; this store keeps them for the consent gate, Settings and Notes.

import { useEffect } from 'react'
import type { ApiError } from '../api/errors'
import { activeConsents, dataError, grantConsents, listConsents, revokeConsent } from '../data/repo'
import { REQUIRED_CONSENT_SCOPES, type ConsentRow, type ConsentScope } from '../data/schema'
import { createStore, useStore } from '../state/store'
import { client, useAuth } from './auth'

export { CONSENT_SCOPES, CONSENT_VERSION, REQUIRED_CONSENT_SCOPES, type ConsentScope } from '../data/schema'

/** The two optional choices on the consent screen. */
export const OPTIONAL_CONSENT_SCOPES: readonly ConsentScope[] = ['ai_metrics_only', 'own_video_upload']

interface ConsentState {
  /** Whose rows these are; a different signed-in user means "not loaded". */
  uid: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  rows: ConsentRow[]
  error: ApiError | null
}

const store = createStore<ConsentState>({ uid: null, status: 'idle', rows: [], error: null })

async function load(uid: string): Promise<void> {
  store.set({ uid, status: 'loading', rows: [], error: null })
  try {
    const rows = await listConsents(client())
    if (store.get().uid === uid) store.set({ uid, status: 'ready', rows, error: null })
  } catch (e) {
    if (store.get().uid === uid) store.set({ uid, status: 'error', rows: [], error: dataError(e) })
  }
}

function setRows(rows: ConsentRow[]) {
  store.set((s) => ({ ...s, status: 'ready', rows, error: null }))
}

/** Records the accepted scopes (required and optional) with the consent version. */
export async function acceptConsents(scopes: readonly ConsentScope[]): Promise<void> {
  setRows(await grantConsents(client(), scopes))
}

/** Turns one optional choice on or off later (Settings). */
export async function setConsent(scope: ConsentScope, granted: boolean): Promise<void> {
  setRows(granted ? await grantConsents(client(), [scope]) : await revokeConsent(client(), scope))
}

export interface Consents {
  /** 'loading' until the rows of the signed-in account are known. */
  status: 'loading' | 'ready' | 'error'
  error: ApiError | null
  /** Scopes that are accepted and not revoked. */
  granted: ReadonlySet<ConsentScope>
  has(scope: ConsentScope): boolean
  /** Both required scopes accepted: the app may store data. */
  requiredAccepted: boolean
  /** Date (YYYY-MM-DD) the scope was last accepted, for Settings. */
  grantedOn(scope: ConsentScope): string | null
  reload(): void
}

/**
 * Consent state for the signed-in user; loads on first use.
 * `has('ai_metrics_only')` gates the AI notes; `has('own_video_upload')` gates uploads.
 */
export function useConsents(): Consents {
  const { user } = useAuth()
  const uid = user?.id ?? null
  const state = useStore(store)
  const mine = state.uid === uid && uid !== null

  useEffect(() => {
    if (uid && store.get().uid !== uid) void load(uid)
  }, [uid])

  const granted = mine ? activeConsents(state.rows) : new Set<ConsentScope>()
  return {
    status: !mine || state.status === 'idle' || state.status === 'loading' ? 'loading' : state.status,
    error: mine ? state.error : null,
    granted,
    has: (scope) => granted.has(scope),
    requiredAccepted: REQUIRED_CONSENT_SCOPES.every((s) => granted.has(s)),
    grantedOn: (scope) =>
      [...state.rows].reverse().find((r) => mine && r.scope === scope && r.revoked_on == null)?.granted_on ?? null,
    reload: () => {
      if (uid) void load(uid)
    },
  }
}

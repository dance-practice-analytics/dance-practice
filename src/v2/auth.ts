// v2 auth store, straight on Supabase Auth (FR-3.1.x). It never goes through the old
// src/api/client.ts, which would pull the mock in. The role comes from the user's
// `profiles` row and can't be changed from the browser (FR-3.1.4).

import type { Session } from '@supabase/supabase-js'
import { authError } from '../api/authErrors'
import { ApiError } from '../api/errors'
import { supabase } from '../api/supabase'
import type { ProfileRow, UserRole } from '../data/schema'
import { createStore, useStore } from '../state/store'

export interface AuthState {
  /** 'loading' until the stored session has been read. */
  status: 'loading' | 'signedOut' | 'signedIn'
  user: { id: string; email: string } | null
  /** Null while it loads, or if the row couldn't be read; `role` then falls back to dancer. */
  profile: ProfileRow | null
  role: UserRole
}

const SIGNED_OUT: AuthState = { status: 'signedOut', user: null, profile: null, role: 'dancer' }

export const authStore = createStore<AuthState>({ ...SIGNED_OUT, status: 'loading' })

export function useAuth(): AuthState {
  return useStore(authStore)
}

/** The Supabase client; v2 only mounts when it exists (main.tsx). */
export function client() {
  if (!supabase) throw new ApiError(0, 'not_configured', 'This build has no server configured.', 'Check .env.local.')
  return supabase
}

async function loadProfile(uid: string): Promise<void> {
  const { data } = await client()
    .from('profiles')
    .select('id, owner_id, display_name, role, created_at')
    .eq('id', uid)
    .maybeSingle()
  const now = authStore.get()
  // The user may have signed out, or another account in, while this was in flight.
  if (now.user?.id !== uid) return
  const profile = (data as ProfileRow | null) ?? null
  authStore.set({ ...now, profile, role: profile?.role ?? 'dancer' })
}

function accept(session: Session | null): void {
  const prev = authStore.get()
  if (!session?.user) {
    if (prev.status !== 'signedOut') authStore.set(SIGNED_OUT)
    return
  }
  const user = { id: session.user.id, email: session.user.email ?? '' }
  const same = prev.user?.id === user.id
  // Token refreshes fire often; only a change of user resets the profile.
  if (same && prev.status === 'signedIn') return
  authStore.set({ status: 'signedIn', user, profile: same ? prev.profile : null, role: same ? prev.role : 'dancer' })
  void loadProfile(user.id)
}

let started = false

/** Restores the stored session and follows sign-in / sign-out from any tab. Call once. */
export function startAuth(): void {
  if (started || !supabase) return
  started = true
  supabase.auth
    .getSession()
    .then(({ data }) => accept(data.session))
    .catch(() => accept(null))
  // No awaits on the client inside this callback: supabase-js holds a lock while it runs.
  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => accept(session), 0)
  })
}

const fail = (e: unknown): ApiError =>
  e instanceof ApiError ? e : authError((e && typeof e === 'object' ? e : {}) as Parameters<typeof authError>[0])

/** Rejects with an ApiError whose `message` and `recovery` are safe to show. */
export async function signIn(email: string, password: string): Promise<void> {
  try {
    const { data, error } = await client().auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw authError(error)
    accept(data.session)
  } catch (e) {
    throw fail(e)
  }
}

export async function signUp(email: string, password: string): Promise<void> {
  try {
    const { data, error } = await client().auth.signUp({ email: email.trim(), password })
    if (error) throw authError(error)
    // With email confirmation on there is no session yet; say so instead of a blank screen.
    if (!data.session) throw authError({ status: 401, code: 'email_not_confirmed' })
    accept(data.session)
  } catch (e) {
    throw fail(e)
  }
}

export async function signOut(): Promise<void> {
  try {
    // 'local' ends this browser's session even when the server can't be reached.
    await client().auth.signOut({ scope: 'local' })
  } finally {
    authStore.set(SIGNED_OUT)
  }
}

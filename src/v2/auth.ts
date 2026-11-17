// v2 auth store, straight on Supabase Auth (FR-3.1.x). It never goes through the old
// src/api/client.ts, which would pull the mock in. The role comes from the user's
// `profiles` row and can't be changed from the browser (FR-3.1.4).

import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { MIN_PASSWORD, authError, authLinkError, type AuthContext } from '../api/authErrors'
import { ApiError } from '../api/errors'
import { authLinkAtLoad, supabase } from '../api/supabase'
import type { ProfileRow, UserRole } from '../data/schema'
import { createStore, useStore } from '../state/store'
import { clearQueue } from './offline/uploadQueue'

export interface AuthState {
  /** 'loading' until the stored session has been read. */
  status: 'loading' | 'signedOut' | 'signedIn'
  user: { id: string; email: string } | null
  /** Null while it loads, or if the row couldn't be read; `role` then falls back to dancer. */
  profile: ProfileRow | null
  role: UserRole
  /**
   * Signed in through a password-reset link (FR-3.1.3): the app shows only the
   * "set a new password" screen until `updatePassword` succeeds or the user signs out.
   */
  recovery: boolean
  /** A reset link that didn't work (expired, already used); SignIn shows it. */
  linkError: ApiError | null
}

const SIGNED_OUT: AuthState = { status: 'signedOut', user: null, profile: null, role: 'dancer', recovery: false, linkError: null }

// Survives a reload of the reset screen within the tab, so a reload doesn't skip it.
const RECOVERY_KEY = 'dpa:recovery'
function rememberRecovery(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(RECOVERY_KEY, '1')
    else sessionStorage.removeItem(RECOVERY_KEY)
  } catch {
    // Storage may be blocked; the PASSWORD_RECOVERY event still opens the screen.
  }
}
function recoveryRemembered(): boolean {
  try {
    return sessionStorage.getItem(RECOVERY_KEY) === '1'
  } catch {
    return false
  }
}

// What the page was opened with; read once, before supabase-js clears the fragment.
let recoveryPending = authLinkAtLoad.kind === 'tokens' && authLinkAtLoad.type === 'recovery'
const initialLinkError = authLinkAtLoad.kind === 'error' ? authLinkError(authLinkAtLoad.errorCode) : null

export const authStore = createStore<AuthState>({ ...SIGNED_OUT, status: 'loading', linkError: initialLinkError })

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

function accept(session: Session | null, event?: AuthChangeEvent): void {
  const prev = authStore.get()
  if (!session?.user) {
    recoveryPending = false
    rememberRecovery(false)
    if (prev.status !== 'signedOut') authStore.set({ ...SIGNED_OUT, linkError: prev.linkError })
    return
  }
  const user = { id: session.user.id, email: session.user.email ?? '' }
  const same = prev.user?.id === user.id
  const recovery =
    event === 'PASSWORD_RECOVERY' || recoveryPending || (same && prev.recovery) || (!same && prev.status === 'loading' && recoveryRemembered())
  if (recovery) {
    recoveryPending = false
    rememberRecovery(true)
  }
  // Token refreshes fire often; only a change of user resets the profile.
  if (same && prev.status === 'signedIn' && prev.recovery === recovery) return
  authStore.set({
    status: 'signedIn',
    user,
    profile: same ? prev.profile : null,
    role: same ? prev.role : 'dancer',
    recovery,
    // A link that worked replaces an older failure.
    linkError: recovery ? null : prev.linkError,
  })
  if (!same) void loadProfile(user.id)
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
  supabase.auth.onAuthStateChange((event, session) => {
    setTimeout(() => accept(session, event), 0)
  })
}

const fail = (e: unknown, context?: AuthContext): ApiError =>
  e instanceof ApiError ? e : authError((e && typeof e === 'object' ? e : {}) as Parameters<typeof authError>[0], context)

/** Where the reset email sends the user back: this origin and base path, on a hash route. */
export function resetRedirectUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}#/reset-password`
}

/**
 * Sends the password-reset email (FR-3.1.3). The server answers the same way whether or
 * not the email has an account, so the screen must not say which.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  try {
    const { error } = await client().auth.resetPasswordForEmail(email.trim(), { redirectTo: resetRedirectUrl() })
    if (error) throw authError(error, 'reset')
  } catch (e) {
    throw fail(e, 'reset')
  }
}

/**
 * Sets a new password for the signed-in user: after a reset link, or from Settings with
 * `currentPassword`, which is checked first so an unattended open tab can't change it.
 */
export async function updatePassword(password: string, opts: { currentPassword?: string } = {}): Promise<void> {
  if (password.length < MIN_PASSWORD) throw authError({ status: 422, code: 'weak_password' }, 'password')
  try {
    const auth = client().auth
    if (opts.currentPassword !== undefined) {
      const email = authStore.get().user?.email
      if (!email) throw authError({ status: 401, code: 'session_not_found' }, 'password')
      const { error } = await auth.signInWithPassword({ email, password: opts.currentPassword })
      if (error) throw authError(error, 'password')
    }
    const { error } = await auth.updateUser({ password })
    if (error) throw authError(error, 'password')
  } catch (e) {
    throw fail(e, 'password')
  }
  rememberRecovery(false)
  const now = authStore.get()
  if (now.recovery) authStore.set({ ...now, recovery: false })
}

/**
 * Sets the optional name on the user's own profile row (empty clears it). The database
 * grants updates on `display_name` only, so the role can't change through this.
 */
export async function updateDisplayName(name: string): Promise<void> {
  const uid = authStore.get().user?.id
  if (!uid) throw new ApiError(401, 'signed_out', 'You are signed out.', 'Sign in again, then try once more.')
  const display_name = name.trim().slice(0, 60) || null
  const { data, error } = await client()
    .from('profiles')
    .update({ display_name })
    .eq('id', uid)
    .select('id, owner_id, display_name, role, created_at')
    .maybeSingle()
  if (error || !data) throw new ApiError(0, 'profile_not_saved', 'Your name wasn’t saved.', 'Check your connection and try again.')
  const now = authStore.get()
  if (now.user?.id === uid) authStore.set({ ...now, profile: data as ProfileRow })
}

/** Hides the "link didn't work" message once it has been read. */
export function clearLinkError(): void {
  const now = authStore.get()
  if (now.linkError) authStore.set({ ...now, linkError: null })
}

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
  // Results waiting offline must never be uploaded by the next account on this device.
  await clearQueue()
  try {
    // 'local' ends this browser's session even when the server can't be reached.
    await client().auth.signOut({ scope: 'local' })
  } finally {
    recoveryPending = false
    rememberRecovery(false)
    authStore.set(SIGNED_OUT)
  }
}

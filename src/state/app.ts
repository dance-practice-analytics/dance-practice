// App-wide state outside the review workspace: who is signed in, whether the
// workspace's edits are saved, and short confirmation toasts.

import { api, type Account } from '../api/client'
import { createStore } from './store'

export type AuthState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; account: Account }

export const auth = createStore<AuthState>({ status: 'loading' })

export async function restoreAuth() {
  try {
    const account = await api.me()
    auth.set(account ? { status: 'signedIn', account } : { status: 'signedOut' })
  } catch {
    auth.set({ status: 'signedOut' })
  }
  if (watching) return
  watching = true
  // Token expiry and sign-in or sign-out from another tab (FR-3.1.7).
  api.onAuthChange?.((account) => {
    const now = auth.get()
    const current = now.status === 'signedIn' ? now.account.participant : null
    if (now.status !== 'loading' && (account?.participant ?? null) === current) return
    auth.set(account ? { status: 'signedIn', account } : { status: 'signedOut' })
  })
}

let watching = false

export async function signIn(identifier: string, secret: string) {
  const account = await api.signIn(identifier, secret)
  auth.set({ status: 'signedIn', account })
}

export async function signUp(email: string, password: string) {
  if (!api.signUp) throw new Error('Accounts are not available on the mock API.')
  const account = await api.signUp(email, password)
  auth.set({ status: 'signedIn', account })
}

export async function signOut() {
  await api.signOut().catch(() => undefined)
  auth.set({ status: 'signedOut' })
}

export type SaveState = { state: 'idle' } | { state: 'saving' } | { state: 'saved'; at: number } | { state: 'error'; message: string }

export const saveStatus = createStore<SaveState>({ state: 'idle' })

export interface Toast {
  id: number
  text: string
}

export const toasts = createStore<Toast[]>([])
let toastSeq = 0

export function toast(text: string) {
  const id = ++toastSeq
  toasts.set((ts) => [...ts, { id, text }])
  setTimeout(() => toasts.set((ts) => ts.filter((t) => t.id !== id)), 3800)
}

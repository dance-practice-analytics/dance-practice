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
}

export async function signIn(participant: string, passcode: string) {
  const account = await api.signIn(participant, passcode)
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

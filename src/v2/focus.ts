// The dancer's focus themes for phrase attempts (up to three), stored per account in
// user_preferences. Review shows those theme cards first. Chosen by the dancer only.

import { useEffect } from 'react'
import type { ApiError } from '../api/errors'
import { getFocusThemes, setFocusThemes } from '../data/preferences'
import type { ThemeKey } from '../metrics/phrase'
import { createStore, useStore } from '../state/store'
import { client, useAuth } from './auth'

interface FocusState {
  uid: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  themes: ThemeKey[]
  saving: boolean
  error: ApiError | null
}

const store = createStore<FocusState>({ uid: null, status: 'idle', themes: [], saving: false, error: null })

async function load(uid: string): Promise<void> {
  store.set({ uid, status: 'loading', themes: [], saving: false, error: null })
  try {
    const themes = await getFocusThemes(client())
    if (store.get().uid === uid) store.set((s) => ({ ...s, status: 'ready', themes }))
  } catch (e) {
    if (store.get().uid === uid) store.set((s) => ({ ...s, status: 'error', error: e as ApiError }))
  }
}

/** Saves at once; the screen shows the new order right away and goes back on failure. */
export async function saveFocus(themes: ThemeKey[]): Promise<void> {
  const before = store.get().themes
  store.set((s) => ({ ...s, themes, saving: true, error: null }))
  try {
    const saved = await setFocusThemes(client(), themes)
    store.set((s) => ({ ...s, themes: saved, saving: false }))
  } catch (e) {
    store.set((s) => ({ ...s, themes: before, saving: false, error: e as ApiError }))
  }
}

export interface Focus {
  themes: ThemeKey[]
  status: 'loading' | 'ready' | 'error'
  saving: boolean
  error: ApiError | null
}

export function useFocusThemes(): Focus {
  const { user } = useAuth()
  const uid = user?.id ?? null
  const state = useStore(store)
  const mine = uid !== null && state.uid === uid
  useEffect(() => {
    if (uid && store.get().uid !== uid) void load(uid)
  }, [uid])
  return {
    themes: mine ? state.themes : [],
    status: !mine || state.status === 'idle' || state.status === 'loading' ? 'loading' : state.status,
    saving: mine && state.saving,
    error: mine ? state.error : null,
  }
}

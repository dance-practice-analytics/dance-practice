// Display preferences of the signed-in account (table user_preferences, migration
// 20261117020000, owner-only RLS): the up to three phrase themes the dancer chose to see
// first. No practice data and no free text; nothing here comes from a teacher.

import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../api/errors'
import { THEME_KEYS, type ThemeKey } from '../metrics/phrase'
import { dataError } from './repo'
import { MAX_FOCUS_THEMES } from './schema'

/** Known keys only, no repeats, at most MAX_FOCUS_THEMES (the CHECKs in the table). */
export function cleanFocus(themes: readonly unknown[]): ThemeKey[] {
  const out: ThemeKey[] = []
  for (const t of themes) if ((THEME_KEYS as readonly unknown[]).includes(t) && !out.includes(t as ThemeKey)) out.push(t as ThemeKey)
  return out.slice(0, MAX_FOCUS_THEMES)
}

async function uidOf(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession()
  const uid = data?.session?.user?.id
  if (!uid) throw new ApiError(401, 'not_signed_in', 'You’re not signed in.', 'Sign in and try again.')
  return uid
}

/** The account's focus themes; [] when none were chosen yet. */
export async function getFocusThemes(client: SupabaseClient): Promise<ThemeKey[]> {
  try {
    const uid = await uidOf(client)
    const res = await client.from('user_preferences').select('focus_themes').eq('owner_id', uid).maybeSingle()
    if (res.error) throw res.error
    const row = res.data as { focus_themes?: unknown[] } | null
    return cleanFocus(row?.focus_themes ?? [])
  } catch (e) {
    throw e instanceof ApiError ? e : dataError(e)
  }
}

/** Saves the focus themes (one row per account, created on first save). */
export async function setFocusThemes(client: SupabaseClient, themes: readonly ThemeKey[]): Promise<ThemeKey[]> {
  try {
    const uid = await uidOf(client)
    const focus = cleanFocus(themes)
    const res = await client
      .from('user_preferences')
      .upsert({ owner_id: uid, focus_themes: focus, updated_at: new Date().toISOString() }, { onConflict: 'owner_id' })
      .select('focus_themes')
      .single()
    if (res.error) throw res.error
    return cleanFocus((res.data as { focus_themes?: unknown[] } | null)?.focus_themes ?? focus)
  } catch (e) {
    throw e instanceof ApiError ? e : dataError(e)
  }
}

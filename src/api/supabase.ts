// Supabase client (FR-3.1.x). The browser only ever holds the publishable key;
// row-level security protects the data. With no VITE_SUPABASE_URL the app runs
// on the in-browser mock alone (unit tests, e2e, offline demos).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { normalizeAuthHash, readAuthLink, type AuthLink } from './authLink'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim()
const configured = Boolean(url && key)

/**
 * The email link the page was opened with, read before supabase-js consumes and clears
 * the fragment. The v2 auth store uses it to open the "set new password" screen.
 */
export const authLinkAtLoad: AuthLink =
  configured && typeof window !== 'undefined' ? readAuthLink(window.location.hash) : { kind: 'none', type: null, errorCode: null }

// A reset link may come back as '#/reset-password#access_token=…'; supabase-js only reads
// a fragment that starts with the parameters. This must run before createClient.
if (configured && typeof window !== 'undefined') {
  const fixed = normalizeAuthHash(window.location.hash)
  if (fixed) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + fixed)
}

export const supabase: SupabaseClient | null = configured ? createClient(url!, key!) : null

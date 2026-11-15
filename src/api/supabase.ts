// Supabase client (FR-3.1.x). The browser only ever holds the publishable key;
// row-level security protects the data. With no VITE_SUPABASE_URL the app runs
// on the in-browser mock alone (unit tests, e2e, offline demos).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim()

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null

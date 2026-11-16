// Supabase Edge Function delete-account (FR-3.9.x): POST { confirm: 'DELETE' } with the
// caller's JWT → removes the caller's stored files, then the auth user, which cascades
// to every row the account owns. Returns a DeleteAccountReport.
//
// - The user is identified only by the verified access token; the body has no user id.
// - SUPABASE_SERVICE_ROLE_KEY is injected by the platform and never leaves this function.
//   It is used only for the caller's own folder, rows and auth user.
//
// The request flow lives in handler.ts; this file wires it to Supabase.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { errorBody, FAILURES } from './contract.ts'
import { allowedOrigins, corsHeaders } from '../generate-feedback/cors.ts'
import { handleDeleteAccount, type Deps } from './handler.ts'

function deps(admin: SupabaseClient, token: string): Deps {
  return {
    async userId() {
      const { data, error } = await admin.auth.getUser(token)
      return error ? null : (data.user?.id ?? null)
    },

    async countRows(table, uid) {
      const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true }).eq('owner_id', uid)
      if (error) throw new Error(`count ${table}: ${error.code ?? 'error'}`)
      return count ?? 0
    },

    async list(bucket, folder, offset, limit) {
      const { data, error } = await admin.storage.from(bucket).list(folder, { limit, offset, sortBy: { column: 'name', order: 'asc' } })
      if (error) throw new Error(`list: ${error.message}`)
      return (data ?? []).map((e) => ({ name: e.name, folder: e.id === null }))
    },

    async remove(bucket, paths) {
      const { error } = await admin.storage.from(bucket).remove(paths)
      if (error) throw new Error(`remove: ${error.message}`)
    },

    async deleteUser(uid) {
      const { error } = await admin.auth.admin.deleteUser(uid)
      if (error) throw new Error(`deleteUser: ${error.status ?? ''} ${error.code ?? ''}`)
    },

    log: (code, detail) => console.warn('delete-account:', code, detail ?? ''),
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get('origin'), allowedOrigins(Deno.env.get('ALLOWED_ORIGINS')))
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json(FAILURES.unauthorized.status, errorBody('unauthorized'))

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json(FAILURES.not_configured.status, errorBody('not_configured'))

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  let body: unknown = null
  if (req.method === 'POST') {
    try {
      body = await req.json()
    } catch {
      body = null
    }
  }

  const result = await handleDeleteAccount(req.method, body, deps(admin, token))
  return json(result.status, result.body)
})

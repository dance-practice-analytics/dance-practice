// Links from account emails (password reset, FR-3.1.3) land on the app with the result in
// the URL fragment: `#access_token=…&type=recovery` or `#error=…&error_code=otp_expired`.
// The app asks for `<origin><base>#/reset-password`, so depending on how the auth server
// joins the two the fragment may also start with the hash route. These helpers are pure.

export interface AuthLink {
  /** 'tokens': a session in the fragment; 'error': the server refused the link. */
  kind: 'tokens' | 'error' | 'none'
  /** `type` of the link, e.g. 'recovery' or 'signup'. */
  type: string | null
  errorCode: string | null
}

const isAuthParams = (p: URLSearchParams) =>
  p.has('access_token') || p.has('error') || p.has('error_code') || p.has('error_description')

/**
 * `#/reset-password#access_token=…` or `#/reset-password&access_token=…` → `#access_token=…`,
 * so supabase-js reads it. Null when the hash is not an auth result behind a route.
 */
export function normalizeAuthHash(hash: string): string | null {
  const m = /^#\/[^#&?]*[#&?](.*)$/.exec(hash)
  if (!m) return null
  return isAuthParams(new URLSearchParams(m[1])) ? `#${m[1]}` : null
}

export function readAuthLink(hash: string): AuthLink {
  const raw = normalizeAuthHash(hash) ?? hash
  const p = new URLSearchParams(raw.replace(/^#/, ''))
  if (!isAuthParams(p)) return { kind: 'none', type: null, errorCode: null }
  const type = p.get('type')
  if (p.has('access_token')) return { kind: 'tokens', type, errorCode: null }
  return { kind: 'error', type, errorCode: p.get('error_code') ?? p.get('error') }
}

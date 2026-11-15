// CORS for the web app (dev server, GitHub Pages) and the Capacitor WebView.

export const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173', // npm run dev
  'http://localhost:4173', // npm run preview
  'https://dance-practice-analytics.github.io', // GitHub Pages
  'capacitor://localhost', // Capacitor iOS
  'https://localhost', // Capacitor Android (default androidScheme)
  'http://localhost', // Capacitor Android with androidScheme http
] as const

/** `extra` is the ALLOWED_ORIGINS secret: comma-separated origins added to the defaults. */
export function allowedOrigins(extra: string | undefined): string[] {
  const more = (extra ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o.length > 0)
  return [...DEFAULT_ALLOWED_ORIGINS, ...more]
}

/**
 * Headers for a request from `origin`. An origin that is not on the list gets no
 * Access-Control-Allow-Origin, so the browser blocks the response.
 */
export function corsHeaders(origin: string | null, allowed: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

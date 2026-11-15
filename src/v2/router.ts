// Hash router of the v2 app. Routes are plain objects; `href` and `parseRoute` are
// inverses for every route `href` can produce (see router.test.ts).

import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'signin' }
  | { name: 'consent' }
  | { name: 'dashboard' }
  /** `sessionId` narrows the library to one session (`#/library?session=..`). */
  | { name: 'library'; sessionId?: string }
  | { name: 'import' }
  | { name: 'processing' }
  /** Without an id the page picks the latest processed attempt or shows its empty state. */
  | { name: 'review'; attemptId?: string }
  | { name: 'compare'; a?: string; b?: string }
  | { name: 'progress' }
  | { name: 'notes'; attemptId?: string }
  | { name: 'chat'; attemptId?: string }
  /** Researcher only; App sends a dancer back to the dashboard. */
  | { name: 'dataset' }
  | { name: 'settings' }

export type RouteName = Route['name']

export const ROUTE_NAMES: readonly RouteName[] = [
  'signin',
  'consent',
  'dashboard',
  'library',
  'import',
  'processing',
  'review',
  'compare',
  'progress',
  'notes',
  'chat',
  'dataset',
  'settings',
]

export const DEFAULT_ROUTE: Route = { name: 'dashboard' }

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : undefined)

/** Unknown or empty hashes land on the dashboard. */
export function parseRoute(hash: string): Route {
  const [path, search = ''] = hash.replace(/^#\/?/, '').split('?')
  const parts = path.split('/').filter(Boolean).map(safeDecode)
  const query = new URLSearchParams(search)
  const [head, id] = parts
  if (!head || parts.length > 2) return DEFAULT_ROUTE
  switch (head) {
    case 'review':
    case 'notes':
    case 'chat': {
      const attemptId = clean(id)
      return attemptId ? { name: head, attemptId } : { name: head }
    }
    case 'compare': {
      if (id) return DEFAULT_ROUTE
      const route: Route = { name: 'compare' }
      const a = clean(query.get('a'))
      const b = clean(query.get('b'))
      if (a) route.a = a
      if (b) route.b = b
      return route
    }
    case 'library': {
      if (id) return DEFAULT_ROUTE
      const sessionId = clean(query.get('session'))
      return sessionId ? { name: 'library', sessionId } : { name: 'library' }
    }
    case 'signin':
    case 'consent':
    case 'dashboard':
    case 'import':
    case 'processing':
    case 'progress':
    case 'dataset':
    case 'settings':
      return id ? DEFAULT_ROUTE : { name: head }
  }
  return DEFAULT_ROUTE
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/** The `#/...` link for a route; use it for every `<a href>` in v2. */
export function href(route: Route): string {
  const seg = encodeURIComponent
  switch (route.name) {
    case 'review':
    case 'notes':
    case 'chat':
      return route.attemptId ? `#/${route.name}/${seg(route.attemptId)}` : `#/${route.name}`
    case 'compare': {
      const q = new URLSearchParams()
      if (route.a) q.set('a', route.a)
      if (route.b) q.set('b', route.b)
      const s = q.toString()
      return s ? `#/compare?${s}` : '#/compare'
    }
    case 'library':
      return route.sessionId ? `#/library?session=${seg(route.sessionId)}` : '#/library'
    default:
      return `#/${route.name}`
  }
}

/** Goes to a route. `replace` swaps the current history entry (redirects, filters). */
export function navigate(route: Route, opts: { replace?: boolean } = {}): void {
  const target = href(route)
  if (location.hash === target) return
  if (opts.replace) {
    history.replaceState(null, '', target)
    // replaceState doesn't fire hashchange.
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    location.hash = target
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

// The parsed route is cached per hash so the snapshot is referentially stable.
let cachedHash: string | null = null
let cachedRoute: Route = DEFAULT_ROUTE
function current(): Route {
  if (location.hash !== cachedHash) {
    cachedHash = location.hash
    cachedRoute = parseRoute(cachedHash)
  }
  return cachedRoute
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, current)
}

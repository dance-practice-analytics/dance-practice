// Tiny hash router: the app is a handful of screens, so no dependency is needed.

import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'signin' }
  | { name: 'journal' }
  | { name: 'new' }
  | { name: 'progress' }
  | { name: 'processing'; id: string }
  | { name: 'confirm'; id: string }
  | { name: 'workspace'; id: string }
  | { name: 'notFound' }

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent)
  if (parts.length === 0) return { name: 'journal' }
  const [head, id, tail] = parts
  if (head === 'signin' && !id) return { name: 'signin' }
  if (head === 'new' && !id) return { name: 'new' }
  if (head === 'progress' && !id) return { name: 'progress' }
  if (head === 'sessions' && id) {
    if (!tail) return { name: 'workspace', id }
    if (tail === 'processing') return { name: 'processing', id }
    if (tail === 'confirm') return { name: 'confirm', id }
  }
  return { name: 'notFound' }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'signin':
      return '#/signin'
    case 'journal':
    case 'notFound':
      return '#/'
    case 'new':
      return '#/new'
    case 'progress':
      return '#/progress'
    case 'processing':
      return `#/sessions/${encodeURIComponent(route.id)}/processing`
    case 'confirm':
      return `#/sessions/${encodeURIComponent(route.id)}/confirm`
    case 'workspace':
      return `#/sessions/${encodeURIComponent(route.id)}`
  }
}

export function navigate(route: Route, { replace = false } = {}) {
  const next = href(route)
  if (replace) history.replaceState(null, '', next)
  else history.pushState(null, '', next)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  window.addEventListener('popstate', cb)
  return () => {
    window.removeEventListener('hashchange', cb)
    window.removeEventListener('popstate', cb)
  }
}

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => location.hash)
}

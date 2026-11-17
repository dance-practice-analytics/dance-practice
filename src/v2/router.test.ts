import { describe, expect, it } from 'vitest'
import { DEFAULT_ROUTE, href, parseRoute, ROUTE_NAMES, type Route } from './router'

describe('v2 router', () => {
  const routes: Route[] = [
    ...ROUTE_NAMES.map((name) => ({ name }) as Route),
    { name: 'library', sessionId: '3f0c-1' },
    { name: 'review', attemptId: 'a1b2-c3' },
    { name: 'notes', attemptId: 'a1b2-c3' },
    { name: 'chat', attemptId: 'a1b2-c3' },
    { name: 'compare', a: 'id-a', b: 'id-b' },
    { name: 'compare', a: 'only-a' },
    { name: 'review', attemptId: 'needs/escaping ?&#' },
    { name: 'signin', mode: 'signup' },
  ]

  it('round-trips every route through href and parseRoute', () => {
    for (const route of routes) expect(parseRoute(href(route))).toEqual(route)
  })

  it('formats the documented shapes', () => {
    expect(href({ name: 'dashboard' })).toBe('#/dashboard')
    expect(href({ name: 'review' })).toBe('#/review')
    expect(href({ name: 'review', attemptId: 'x1' })).toBe('#/review/x1')
    expect(href({ name: 'compare', a: 'x1', b: 'x2' })).toBe('#/compare?a=x1&b=x2')
    expect(href({ name: 'notes' })).toBe('#/notes')
    expect(href({ name: 'library', sessionId: 's1' })).toBe('#/library?session=s1')
    expect(href({ name: 'signin', mode: 'signup' })).toBe('#/signin?mode=signup')
    expect(parseRoute('#/signin?mode=other')).toEqual({ name: 'signin' })
  })

  it('lands on the dashboard for empty, unknown or malformed hashes', () => {
    for (const hash of ['', '#', '#/', '#/nope', '#/settings/extra', '#/review/a/b', '#/compare/x']) {
      expect(parseRoute(hash)).toEqual(DEFAULT_ROUTE)
    }
  })

  it('ignores empty parameters and tolerates a bad escape', () => {
    expect(parseRoute('#/compare?a=&b=x2')).toEqual({ name: 'compare', b: 'x2' })
    expect(parseRoute('#/review/%E0%A4%A')).toEqual({ name: 'review', attemptId: '%E0%A4%A' })
    expect(parseRoute('#review/x1')).toEqual({ name: 'review', attemptId: 'x1' })
  })
})

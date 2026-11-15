import { describe, expect, it } from 'vitest'
import { authError, MIN_PASSWORD } from './authErrors'

describe('authError (FR-3.1.1, FR-3.1.2)', () => {
  it('wrong email or password points to both fields, without saying which one', () => {
    const e = authError({ status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' })
    expect(e.status).toBe(401)
    expect(e.message).toBe('That email and password don’t match.')
    expect(e.recovery).toContain('create an account')
  })

  it('an existing email sends the user to Sign in', () => {
    for (const code of ['user_already_exists', 'email_exists']) {
      const e = authError({ status: 422, code })
      expect(e.code).toBe('user_already_exists')
      expect(e.recovery).toBe('Switch to Sign in.')
    }
  })

  it('a weak password names the minimum length', () => {
    expect(authError({ status: 422, code: 'weak_password' }).recovery).toContain(String(MIN_PASSWORD))
  })

  it('rate limits ask to wait, by code or by status', () => {
    expect(authError({ status: 429, code: 'over_request_rate_limit' }).code).toBe('rate_limited')
    expect(authError({ status: 429 }).code).toBe('rate_limited')
  })

  it('no response or a server failure reads as a connection problem', () => {
    expect(authError({ status: 0, message: 'Failed to fetch' }).code).toBe('network')
    expect(authError({}).code).toBe('network')
    expect(authError({ status: 503 }).code).toBe('network')
  })

  it('never shows the raw server message', () => {
    const e = authError({ status: 400, code: 'something_new', message: 'internal: pq relation "x"' })
    expect(e.message + (e.recovery ?? '')).not.toContain('internal')
  })
})

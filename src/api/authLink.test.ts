import { describe, expect, it } from 'vitest'
import { authError, authLinkError } from './authErrors'
import { normalizeAuthHash, readAuthLink } from './authLink'

describe('reset links (FR-3.1.3)', () => {
  const tokens = 'access_token=a.b.c&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery'

  it('moves the auth result in front of the hash route, however it was joined', () => {
    expect(normalizeAuthHash(`#/reset-password#${tokens}`)).toBe(`#${tokens}`)
    expect(normalizeAuthHash(`#/reset-password&${tokens}`)).toBe(`#${tokens}`)
    expect(normalizeAuthHash(`#${tokens}`)).toBeNull()
  })

  it('leaves app routes alone', () => {
    expect(normalizeAuthHash('#/compare?a=1&b=2')).toBeNull()
    expect(normalizeAuthHash('#/review/abc')).toBeNull()
    expect(readAuthLink('#/settings').kind).toBe('none')
  })

  it('tells a recovery session from a refused link', () => {
    expect(readAuthLink(`#/reset-password#${tokens}`)).toEqual({ kind: 'tokens', type: 'recovery', errorCode: null })
    expect(readAuthLink('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid')).toEqual({
      kind: 'error',
      type: null,
      errorCode: 'otp_expired',
    })
  })

  it('explains a refused link and points to a new one', () => {
    expect(authLinkError('otp_expired').code).toBe('link_expired')
    expect(authLinkError(null).recovery).toMatch(/new reset link/)
  })

  it('maps the reset and new-password errors to safe copy', () => {
    expect(authError({ status: 400, code: 'email_address_not_authorized' }, 'reset').message).toMatch(/can’t send email/)
    expect(authError({ status: 422, code: 'same_password' }, 'password').code).toBe('same_password')
    expect(authError({ status: 400, code: 'invalid_credentials' }, 'password').message).toBe('Your current password isn’t right.')
    expect(authError({ status: 403, code: 'session_not_found' }, 'password').code).toBe('session_expired')
    expect(authError({ status: 400, code: 'new_thing' }, 'reset').message).toBe('The reset email couldn’t be sent.')
    expect(authError({ status: 400, code: 'new_thing' }, 'password').message).toBe('The password wasn’t changed.')
  })
})

// Supabase Auth failures → dancer-safe messages with a recovery hint.

import { ApiError } from './errors'

export const MIN_PASSWORD = 10

interface AuthFailure {
  status?: number
  code?: string
  message?: string
}

export function authError(e: AuthFailure): ApiError {
  const status = e.status ?? 0
  switch (e.code) {
    case 'invalid_credentials':
      return new ApiError(401, e.code, 'That email and password don’t match.', 'Check both and try again, or create an account.')
    case 'email_not_confirmed':
      return new ApiError(401, e.code, 'This email isn’t confirmed yet.', 'Open the link in the confirmation email, then sign in.')
    case 'user_already_exists':
    case 'email_exists':
      return new ApiError(409, 'user_already_exists', 'There is already an account with this email.', 'Switch to Sign in.')
    case 'weak_password':
      return new ApiError(422, e.code, `That password is too short.`, `Use at least ${MIN_PASSWORD} characters.`)
    case 'email_address_invalid':
    case 'validation_failed':
      return new ApiError(422, 'email_address_invalid', 'That email address doesn’t look right.', 'Check it and try again.')
    case 'signup_disabled':
      return new ApiError(403, e.code, 'New accounts are closed right now.', 'Ask your researcher for an invitation.')
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return new ApiError(429, 'rate_limited', 'Too many attempts.', 'Wait a minute and try again.')
  }
  if (status === 429) return new ApiError(429, 'rate_limited', 'Too many attempts.', 'Wait a minute and try again.')
  if (status === 0 || status >= 500) return new ApiError(status, 'network', 'Can’t reach the server right now.', 'Check your connection and try again.')
  return new ApiError(status, e.code ?? 'auth_error', 'Sign-in didn’t work.', 'Try again in a moment.')
}

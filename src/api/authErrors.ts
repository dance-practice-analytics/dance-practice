// Supabase Auth failures → dancer-safe messages with a recovery hint.

import { ApiError } from './errors'

export const MIN_PASSWORD = 10

interface AuthFailure {
  status?: number
  code?: string
  message?: string
}

/**
 * What the user was doing, so the same server code reads right:
 * - 'signin': sign in or create an account (default)
 * - 'reset': asking for a password-reset email (FR-3.1.3)
 * - 'password': setting a new password, from a reset link or in Settings
 */
export type AuthContext = 'signin' | 'reset' | 'password'

const RATE_LIMITED = () => new ApiError(429, 'rate_limited', 'Too many attempts.', 'Wait a minute and try again.')

export function authError(e: AuthFailure, context: AuthContext = 'signin'): ApiError {
  const status = e.status ?? 0
  switch (e.code) {
    case 'invalid_credentials':
      // In 'password' it is the check of the current password in Settings.
      return context === 'password'
        ? new ApiError(401, e.code, 'Your current password isn’t right.', 'Check it and try again. Nothing was changed.')
        : new ApiError(401, e.code, 'That email and password don’t match.', 'Check both and try again, or create an account.')
    case 'email_not_confirmed':
      return new ApiError(401, e.code, 'This email isn’t confirmed yet.', 'Open the link in the confirmation email, then sign in.')
    case 'user_already_exists':
    case 'email_exists':
      return new ApiError(409, 'user_already_exists', 'There is already an account with this email.', 'Switch to Sign in.')
    case 'weak_password':
      return new ApiError(422, e.code, `That password is too short.`, `Use at least ${MIN_PASSWORD} characters.`)
    case 'same_password':
      return new ApiError(422, e.code, 'That is already your password.', 'Choose a different one.')
    case 'email_address_invalid':
    case 'validation_failed':
      // On a reset the server also says this when the address's domain can't receive mail.
      return context === 'reset'
        ? new ApiError(422, 'email_address_invalid', 'We can’t send email to that address.', 'Check it, or ask the project team to reset your password.')
        : new ApiError(422, 'email_address_invalid', 'That email address doesn’t look right.', 'Check it and try again.')
    case 'email_address_not_authorized':
      // The built-in mail service only delivers to the project's team addresses.
      return new ApiError(
        403,
        e.code,
        'This project can’t send email to that address yet.',
        'Ask the project team to reset your password for you.',
      )
    case 'signup_disabled':
      return new ApiError(403, e.code, 'New accounts are closed right now.', 'Ask your researcher for an invitation.')
    case 'session_not_found':
    case 'session_expired':
    case 'refresh_token_not_found':
    case 'bad_jwt':
      return context === 'password'
        ? new ApiError(401, 'session_expired', 'This page has been open too long, so the password wasn’t changed.', 'Ask for a new reset link, or sign in again.')
        : new ApiError(401, 'session_expired', 'Your sign-in has expired.', 'Sign in again.')
    case 'reauthentication_needed':
    case 'reauthentication_not_valid':
      return new ApiError(401, e.code, 'The server asked to confirm it’s you first.', 'Sign out, sign in again, then change the password.')
    case 'over_email_send_rate_limit':
      return new ApiError(429, 'rate_limited', 'Too many emails were sent from this project just now.', 'Wait a while and try again.')
    case 'over_request_rate_limit':
      return RATE_LIMITED()
  }
  if (status === 429) return RATE_LIMITED()
  if (status === 0 || status >= 500) return new ApiError(status, 'network', 'Can’t reach the server right now.', 'Check your connection and try again.')
  if (context === 'reset') return new ApiError(status, e.code ?? 'auth_error', 'The reset email couldn’t be sent.', 'Try again in a moment.')
  if (context === 'password') return new ApiError(status, e.code ?? 'auth_error', 'The password wasn’t changed.', 'Try again in a moment.')
  return new ApiError(status, e.code ?? 'auth_error', 'Sign-in didn’t work.', 'Try again in a moment.')
}

/** Errors a reset or sign-in link can bring back in the URL (`#error_code=…`). */
export function authLinkError(errorCode: string | null): ApiError {
  if (errorCode === 'otp_expired') {
    return new ApiError(401, 'link_expired', 'That link has expired or was already used.', 'Ask for a new reset link below.')
  }
  return new ApiError(400, 'link_invalid', 'That link didn’t work.', 'Ask for a new reset link below.')
}

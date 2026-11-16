// New password + repeat, shared by the reset screen and Settings' "Change password".

import { MIN_PASSWORD } from '../../api/authErrors'
import { ApiError } from '../../api/errors'

/** The first thing wrong with a new password, checked before anything is sent. */
export function passwordProblem(password: string, again: string): ApiError | null {
  if (password.length < MIN_PASSWORD) {
    return new ApiError(422, 'weak_password', 'That password is too short.', `Use at least ${MIN_PASSWORD} characters.`)
  }
  if (password !== again) return new ApiError(422, 'password_mismatch', 'The two passwords don’t match.', 'Type the same password twice.')
  return null
}

export function PasswordFields(props: {
  idPrefix: string
  password: string
  again: string
  onPassword(v: string): void
  onAgain(v: string): void
  disabled?: boolean
}) {
  const { idPrefix: id, password, again } = props
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD
  const mismatch = again.length > 0 && again !== password
  return (
    <>
      <div className={tooShort ? 'field has-error' : 'field'}>
        <label className="field-label" htmlFor={`${id}-new`}>
          New password
        </label>
        <input
          className="input"
          id={`${id}-new`}
          type="password"
          autoComplete="new-password"
          aria-describedby={`${id}-new-hint`}
          required
          value={password}
          disabled={props.disabled}
          onChange={(e) => props.onPassword(e.target.value)}
        />
        <span className="hint" id={`${id}-new-hint`}>
          At least {MIN_PASSWORD} characters.
        </span>
      </div>
      <div className={mismatch ? 'field has-error' : 'field'}>
        <label className="field-label" htmlFor={`${id}-again`}>
          Repeat new password
        </label>
        <input
          className="input"
          id={`${id}-again`}
          type="password"
          autoComplete="new-password"
          required
          value={again}
          disabled={props.disabled}
          onChange={(e) => props.onAgain(e.target.value)}
        />
      </div>
    </>
  )
}

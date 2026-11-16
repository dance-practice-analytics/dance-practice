// "Set a new password" (FR-3.1.3). App shows this instead of everything else while the
// user is signed in through a password-reset link (`useAuth().recovery`): the link's
// session is only for this step. No design screen exists for it; it follows SignIn's form.

import { useState, type FormEvent } from 'react'
import { MIN_PASSWORD } from '../../api/authErrors'
import { ApiError } from '../../api/errors'
import { signOut, updatePassword, useAuth } from '../auth'
import { Icon, Logo, Spinner } from '../components'
import { PasswordFields, passwordProblem } from './PasswordFields'

export function ResetPassword() {
  const { user } = useAuth()
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const problem = passwordProblem(password, again)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      // On success the auth store leaves recovery and App opens the app as usual.
      await updatePassword(password)
    } catch (err) {
      setError(err as ApiError)
      setBusy(false)
    }
  }

  return (
    <main className="v2-center" style={{ minHeight: '100dvh', padding: '32px 20px' }}>
      <form
        onSubmit={submit}
        noValidate
        style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 20 }}
        aria-labelledby="rp-h"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo />
          <span className="t-h3">Dance Practice Analytics</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 className="t-h1" id="rp-h">
            Set a new password
          </h1>
          <p className="muted">
            For <span className="v2-clip">{user?.email}</span>. Use at least {MIN_PASSWORD} characters.
          </p>
        </div>
        <PasswordFields idPrefix="rp" password={password} again={again} onPassword={setPassword} onAgain={setAgain} disabled={busy} />
        {error && (
          <p className="err-msg" role="alert" style={{ alignItems: 'flex-start' }}>
            <Icon name="warning" style={{ marginTop: 1 }} />
            <span>
              {error.message} {error.recovery && <span style={{ fontWeight: 400 }}>{error.recovery}</span>}
            </span>
          </p>
        )}
        <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy || !password || !again} aria-busy={busy}>
          {busy && <Spinner />}
          Save new password
        </button>
        <button className="btn btn-ghost btn-block" type="button" onClick={() => void signOut()} disabled={busy}>
          Cancel and sign out
        </button>
      </form>
    </main>
  )
}

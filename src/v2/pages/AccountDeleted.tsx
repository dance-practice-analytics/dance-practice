// Shown once after Settings → Delete account succeeded (FR-3.9.x): the session is already
// signed out, so App shows this in place of SignIn until the user moves on.

import type { DeleteAccountReport } from '../../data/deleteData'
import { createStore, useStore } from '../../state/store'
import { Icon, Logo } from '../components'
import './settings/settings.css'

const store = createStore<DeleteAccountReport | null>(null)

export function showAccountDeleted(report: DeleteAccountReport): void {
  store.set(report)
}

export function useAccountDeleted(): DeleteAccountReport | null {
  return useStore(store)
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The report in words; only kinds that had something in them. Pure, for tests. */
export function deletedLines(r: DeleteAccountReport): string[] {
  const lines: string[] = []
  if (r.rows.sessions > 0) lines.push(count(r.rows.sessions, 'session'))
  if (r.rows.attempts > 0) lines.push(count(r.rows.attempts, 'attempt'))
  const files = r.objects.keypoints + r.objects.videos
  if (files > 0) lines.push(count(files, 'stored file'))
  if (r.rows.attempt_metrics > 0) lines.push(count(r.rows.attempt_metrics, 'metrics record'))
  if (r.rows.feedback > 0) lines.push(count(r.rows.feedback, 'set of practice notes', 'sets of practice notes'))
  if (r.rows.subjects > 0) lines.push(count(r.rows.subjects, 'subject code'))
  if (r.rows.consents > 0) lines.push(count(r.rows.consents, 'consent record'))
  lines.push('Your sign-in account and profile')
  return lines
}

export function AccountDeleted() {
  const report = useAccountDeleted()
  if (!report) return null
  return (
    <main className="v2-center" style={{ minHeight: '100dvh', padding: '32px 20px' }}>
      <section
        className="card"
        style={{ width: '100%', maxWidth: 460, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}
        aria-labelledby="ad-h"
        role="status"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo />
          <span className="t-h3">Dance Practice Analytics</span>
        </div>
        <h1 className="t-h2" id="ad-h" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Icon name="check" size={20} />
          Your account was deleted
        </h1>
        <div className="t-small muted" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p>Removed from the server:</p>
          <ul className="v2-set-ul">
            {deletedLines(report).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {report.rows_left !== null && report.rows_left > 0 && (
            <p style={{ color: 'var(--text)' }}>
              {count(report.rows_left, 'record')} still showed up right after the delete. Ask the project team to check.
            </p>
          )}
          <p>Video files on this device were never uploaded and aren’t touched. Files you exported are yours to keep or delete.</p>
        </div>
        <button className="btn btn-primary btn-block" type="button" onClick={() => store.set(null)} data-autofocus>
          Done
        </button>
      </section>
    </main>
  )
}

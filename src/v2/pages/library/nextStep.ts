// "Next step": what the Next focus card shows when no practice notes exist yet.
// Derived only from the dancer's own sessions and attempts, never a judgement of technique.

import type { SessionSummary } from '../../../data/repo'
import type { AttemptView } from '../../data'
import type { Route } from '../../router'
import { subjectKey } from './model'

export interface NextStep {
  kind: 'processing' | 'compare' | 'another_attempt' | 'failed' | 'import'
  title: string
  body: string
  action: { label: string; route: Route }
}

const IMPORT: Route = { name: 'import' }

/**
 * One concrete next step, in priority order: clips still processing → compare the two
 * newest measured attempts of the latest session → record another attempt → say why the
 * latest session has nothing measured; with no clips at all, import some. `subject` is the Library filter ('all', a code or
 * 'personal'). There is no record of past comparisons, so "compare" is offered whenever
 * the latest session has two measured attempts.
 */
export function nextStep(sessions: readonly SessionSummary[], attempts: readonly AttemptView[], subject = 'all'): NextStep {
  const own = subject === 'all' ? attempts : attempts.filter((a) => subjectKey(a.session) === subject)

  const pending = own.filter((a) => a.status === 'queued' || a.status === 'processing').length
  if (pending > 0) {
    return {
      kind: 'processing',
      title: 'Your clips are processing',
      body: `${pending === 1 ? '1 clip is' : `${pending} clips are`} still being measured on this device. Measurements appear here when ${pending === 1 ? 'it finishes' : 'they finish'}.`,
      action: { label: 'Open queue', route: { name: 'processing' } },
    }
  }

  const ids = new Set(own.map((a) => a.session_id))
  const withClips = sessions.filter((s) => ids.has(s.id)).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const latest = withClips[0]
  if (!latest) {
    return {
      kind: 'import',
      title: 'Import clips of one movement',
      body: 'Import two or more attempts of the same movement to see their measurements side by side.',
      action: { label: 'Import clips', route: IMPORT },
    }
  }

  const done = own.filter((a) => a.session_id === latest.id && a.status === 'done').sort((a, b) => a.number - b.number)
  if (done.length >= 2) {
    const [earlier, later] = done.slice(-2)
    return {
      kind: 'compare',
      title: `Compare attempt ${later.number} with attempt ${earlier.number}`,
      body: 'Watch two of your own attempts from the latest session side by side, lined up phase by phase.',
      action: { label: 'Compare attempts', route: { name: 'compare', a: earlier.id, b: later.id } },
    }
  }
  if (done.length === 1) {
    return {
      kind: 'another_attempt',
      title: 'Record another attempt of the same movement to compare',
      body: 'With two attempts in one session you can watch them side by side and see what changed.',
      action: { label: 'Import clips', route: IMPORT },
    }
  }
  // Nothing queued, processing or done is left: every clip of the latest session failed.
  return {
    kind: 'failed',
    title: 'Clips in your latest session couldn’t be measured',
    body: 'Each clip says why. Clips that start with you standing still and hold one attempt each measure most reliably.',
    action: { label: 'Open the session', route: { name: 'library', sessionId: latest.id } },
  }
}

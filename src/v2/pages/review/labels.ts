// Names for attempts and sessions on Review and Compare, and which attempt of the same
// session an attempt is set against by default. Pure.

import type { AttemptView } from '../../data'
import { formatDate, MOVEMENT_LABELS } from '../../format'

type Named = Pick<AttemptView, 'number' | 'session'>

export const attemptName = (a: Pick<AttemptView, 'number'>) => `Attempt ${a.number}`

/** 'Session · Nov 4' (the session's own title when it has one). */
export function sessionName(session: AttemptView['session'], now?: Date): string {
  return `${session.title?.trim() || 'Session'} · ${formatDate(session.recorded_on ?? session.created_at, now)}`
}

/** 'Attempt 2 (S01 · Relevé balance · Nov 4)'. */
export function describeAttempt(a: Named, now?: Date): string {
  const parts = [a.session.subject_code, MOVEMENT_LABELS[a.session.movement_type], formatDate(a.session.recorded_on ?? a.session.created_at, now)]
  return `${attemptName(a)} (${parts.filter(Boolean).join(' · ')})`
}

export interface InSession {
  id: string
  session_id: string
  number: number
  status: string
}

/**
 * The attempt of the same session to set `attempt` against: the nearest processed one
 * before it, otherwise the nearest processed one after it. Null when it is alone.
 */
export function neighbourInSession<T extends InSession>(attempt: InSession, attempts: readonly T[]): T | null {
  const others = attempts.filter((a) => a.session_id === attempt.session_id && a.id !== attempt.id && a.status === 'done')
  const before = others.filter((a) => a.number < attempt.number).sort((x, y) => y.number - x.number)[0]
  const after = others.filter((a) => a.number > attempt.number).sort((x, y) => x.number - y.number)[0]
  return before ?? after ?? null
}

/** An attempt in the shape `compareAttempts` (src/insights) takes. */
export function comparisonInput(a: AttemptView) {
  return { attempt: a, metrics: a.metrics, session: a.session }
}

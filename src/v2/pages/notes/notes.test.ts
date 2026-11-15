import { describe, expect, it } from 'vitest'
import { FAILURES, type FailureCode } from '../../../../supabase/functions/generate-feedback/contract'
import { feedbackError, type FeedbackNote } from '../../../feedback/client'
import { attempt, session } from './fixtures'
import {
  earlierAttempts,
  formatClock,
  hasMeasurements,
  historyMeta,
  isNotSetUp,
  noteAlert,
  noteText,
  payloadFor,
  payloadLines,
  pickerGroups,
  processedAttempts,
  sentCount,
} from './model'

const NOW = new Date('2026-11-15T12:00:00')
const s1 = session('s1', '2026-11-04', { title: 'Session 2' })
const s2 = session('s2', '2026-11-11', { view: 'front' })

const a1 = attempt('a1', s1, 1, { trunk_inclination_deg: 6.34, balance_duration_s: 2.6 })
const a2 = attempt('a2', s1, 2)
const a3 = attempt('a3', s1, 3, {
  trunk_inclination_deg: 4.21,
  pelvis_ankle_offset_norm: { value: 0.0612, level: 'medium' },
  balance_duration_s: 3.4,
  knee_tracking_dev_deg: { value: null, reason: 'knee_not_bent' },
})
const empty = attempt('e1', s2, 1, {
  trunk_inclination_deg: { value: null, reason: 'no_pose' },
  pelvis_ankle_offset_norm: { value: null, reason: 'no_pose' },
  balance_duration_s: { value: null, reason: 'no_pose' },
  knee_tracking_dev_deg: { value: null, reason: 'no_pose' },
})
const all = [empty, a1, a2, a3]

describe('attempt picker', () => {
  it('offers processed attempts only, newest session first, in import order', () => {
    expect(processedAttempts(all).map((a) => a.id)).toEqual(['e1', 'a3', 'a1'])
    expect(pickerGroups(all, NOW)).toEqual([
      { sessionId: 's2', label: 'Nov 11 · Relevé balance · Front view · S01', options: [{ id: 'e1', label: 'Attempt 1' }] },
      {
        sessionId: 's1',
        label: 'Nov 4 · Relevé balance · Side view · S01 · Session 2',
        options: [
          { id: 'a1', label: 'Attempt 1' },
          { id: 'a3', label: 'Attempt 3' },
        ],
      },
    ])
  })
})

describe('what is sent', () => {
  it('builds the same metrics-only payload as the function', () => {
    const payload = payloadFor(a3, all)!
    expect(payload.movement).toBe('releve_balance')
    expect(payload.metrics.map((m) => m.metric)).toEqual([
      'trunk_inclination_deg',
      'pelvis_ankle_offset_norm',
      'balance_duration_s',
      'knee_tracking_dev_deg',
    ])
    expect(hasMeasurements(payload)).toBe(true)
    expect(sentCount(payload)).toBe(3)
    // The unprocessed attempt 2 is among the three before it but has nothing to send.
    expect(earlierAttempts(a3, all).map((a) => a.id)).toEqual(['a1'])
    expect(payload.earlier_attempts).toHaveLength(1)
  })

  it('shows name, value, unit, phase and confidence — and nothing that identifies the dancer', () => {
    const lines = payloadLines(payloadFor(a3, all)!)
    expect(lines).toEqual([
      'movement: releve_balance',
      'trunk_inclination_deg: 4.2 degrees · hold · high',
      'pelvis_ankle_offset_norm: 0.061 ratio of leg length · hold · medium',
      'balance_duration_s: 3.4 seconds · hold · high',
      'knee_tracking_dev_deg: not measured (knee_not_bent) · hold · low',
      'phases: rise 0.8 s, hold 3.4 s',
      'earlier_attempts: the same values for 1 earlier attempt of this session',
    ])
    expect(lines.join('\n')).not.toMatch(/S01|Session 2|a3|u1/)
  })

  it('finds nothing to send when every metric is a gap, or when the attempt is not processed', () => {
    const payload = payloadFor(empty, all)!
    expect(hasMeasurements(payload)).toBe(false)
    expect(sentCount(payload)).toBe(0)
    expect(payloadLines(payload)[1]).toBe('trunk_inclination_deg: not measured (no_pose) · hold · low')
    expect(payloadFor(a2, all)).toBeNull()
    expect(sentCount(null)).toBe(0)
  })
})

describe('noteAlert', () => {
  const AT = new Date('2026-11-15T15:00:00').getTime()
  const fail = (code: string, status = 500, retryAfterS?: number) => ({ code, status, message: 'm', recovery: 'r', retryAfterS })

  it('rate limit: clock icon, the retry time, and nothing to press', () => {
    const a = noteAlert(fail('rate_limited', 429, 40 * 60), AT, true)
    expect(a).toMatchObject({ icon: 'clock', title: 'Notes limit reached.', action: 'wait', retryAt: AT + 2_400_000 })
    expect(a.body).toBe(`You can generate 20 sets of notes per hour. Try again at ${formatClock(AT + 2_400_000)}. The notes below are from your last request.`)
    expect(formatClock(AT + 2_400_000)).toBe('3:40 PM')
    expect(noteAlert(fail('rate_limited', 429), AT).body).toBe('You can generate 20 sets of notes per hour. Try again later. Your metrics are not affected.')
  })

  it('offline: the quiet note with what keeps working', () => {
    expect(noteAlert(fail('offline', 0), AT)).toMatchObject({
      tone: 'note',
      title: 'You’re offline.',
      body: 'Processing and review keep working — they run on this device. Practice notes need a connection.',
      action: 'retry',
    })
  })

  it('not set up: a missing key and an undeployed function read the same', () => {
    const key = noteAlert(feedbackError(500, { error: { code: 'not_configured' } }), AT)
    // The platform's 404 for a function that doesn't exist has no body of ours.
    const missing = feedbackError(404, { code: 'NOT_FOUND', message: 'Requested function was not found' })
    expect(missing.code).toBe('upstream_error')
    expect(isNotSetUp(missing)).toBe(true)
    expect(noteAlert(missing, AT)).toEqual(key)
    expect(key).toMatchObject({ code: 'not_configured', title: 'Practice notes aren’t set up yet.', action: 'open_review', retryAt: null })
    expect(key.body).toContain('no notes were written')
    // A real 502 from the service is not mistaken for it.
    expect(isNotSetUp(feedbackError(502, null))).toBe(false)
  })

  it('consent, nothing measured, no measurements, session ended, refusal', () => {
    expect(noteAlert(feedbackError(403, { error: { code: 'consent_required' } }), AT)).toMatchObject({ action: 'allow_consent', icon: 'lock' })
    expect(noteAlert(feedbackError(422, { error: { code: 'nothing_measured' } }), AT)).toMatchObject({
      action: 'open_review',
      title: FAILURES.nothing_measured.message,
    })
    expect(noteAlert(feedbackError(404, { error: { code: 'attempt_not_found' } }), AT).action).toBe('open_processing')
    expect(noteAlert(feedbackError(401, { error: { code: 'unauthorized' } }), AT).action).toBe('sign_in')
    expect(noteAlert(feedbackError(422, { error: { code: 'model_refused' } }), AT)).toMatchObject({
      action: 'open_review',
      title: 'The notes couldn’t be written for this attempt.',
    })
  })

  it('every other failure keeps its own message and offers a retry', () => {
    for (const code of ['model_truncated', 'model_invalid_output', 'upstream_timeout', 'upstream_busy', 'upstream_error', 'storage_failed', 'internal'] as FailureCode[]) {
      const a = noteAlert(feedbackError(FAILURES[code].status, { error: { code } }), AT)
      expect(a).toMatchObject({ tone: 'alert', title: FAILURES[code].message, body: FAILURES[code].recovery, action: 'retry' })
    }
  })

  it('never leaves a failure without a title, a body and a next step', () => {
    for (const code of Object.keys(FAILURES) as FailureCode[]) {
      const a = noteAlert(feedbackError(FAILURES[code].status, { error: { code, retry_after_s: 120 } }), AT)
      expect(a.title.length).toBeGreaterThan(0)
      expect(a.body.length).toBeGreaterThan(0)
      expect(a.action).toBeTruthy()
    }
    expect(noteAlert({ code: 'something_new', status: 418, message: '' }, AT)).toMatchObject({ title: 'Couldn’t generate notes.', action: 'retry' })
  })
})

describe('a note as text', () => {
  const note: FeedbackNote = {
    id: 'n1',
    attemptId: 'a3',
    model: 'test-model',
    promptVersion: 'v1',
    createdAt: '2026-11-04T21:20:00.000Z',
    response: {
      summary: 'Synthetic summary.',
      observations: [{ metric: 'balance_duration_s', observation: 'Obs.', suggestion: 'Sug.', confidence: 'high' }],
      cautions: ['Caution.'],
      disclaimer: 'Disclaimer.',
    },
  }

  it('labels history entries and copies the whole note', () => {
    expect(historyMeta(note, 0)).toBe('Latest · 1 observation')
    expect(historyMeta(note, 1)).toBe('Earlier version · 1 observation')
    const text = noteText(a3, note, NOW)
    expect(text).toContain('Practice notes — Attempt 3 · Relevé balance · Nov 4')
    expect(text).toContain('1. Balance duration (confidence: high)')
    expect(text).toContain('- Caution.')
    expect(text.trim().endsWith('Disclaimer.')).toBe(true)
  })
})

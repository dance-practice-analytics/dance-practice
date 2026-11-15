import { describe, expect, it } from 'vitest'
import { attempt, session } from '../notes/fixtures'
import { chatContext, previousAttempt, suggestedQuestions } from './model'

const s = session('s1', '2026-11-04')
const a1 = attempt('a1', s, 1, { trunk_inclination_deg: 6.3, pelvis_ankle_offset_norm: 0.1, balance_duration_s: 2.6, knee_tracking_dev_deg: 8.1 })
const a2 = attempt('a2', s, 2, {
  trunk_inclination_deg: 4.2,
  pelvis_ankle_offset_norm: { value: 0.06, level: 'medium' },
  balance_duration_s: 3.4,
  knee_tracking_dev_deg: { value: 8.7, level: 'low' },
})
const a3 = attempt('a3', s, 3)
const gaps = attempt('a4', s, 4, { trunk_inclination_deg: { value: null, reason: 'no_pose' } })
const all = [a1, a2, a3, gaps]

describe('chatContext', () => {
  it('this attempt: each value next to the previous attempt’s, with its confidence', () => {
    const c = chatContext(a2, all, 'attempt')
    expect(previousAttempt(a2, all)?.id).toBe('a1')
    expect(c.rows.map((r) => [r.name, r.value, r.confidence])).toEqual([
      ['Trunk inclination · Hold', '4.2° · attempt 1: 6.3°', 'high'],
      ['Pelvis–ankle offset · Hold', '0.06 · attempt 1: 0.10', 'medium'],
      ['Balance duration · Hold', '3.4 s · attempt 1: 2.6 s', 'high'],
      ['Knee tracking deviation · Hold', '8.7° · attempt 1: 8.1° · flagged low', 'low'],
    ])
    expect(c.rows[3].subdued).toBe(true)
    expect(c.valueCount).toBe(4)
    expect(c.note).toBe('Would include attempt 1’s values so change can be described.')
  })

  it('a gap is "Not measured", never 0', () => {
    const c = chatContext(gaps, all, 'attempt')
    expect(c.rows[0]).toMatchObject({ value: 'Not measured · attempt 2: 4.2°', confidence: 'none', subdued: true })
    expect(c.valueCount).toBe(0)
    expect(chatContext(a1, all, 'attempt').note).toBe('No earlier analyzed attempt in this session to compare with.')
  })

  it('this session: medians over the analyzed attempts and the weakest confidence', () => {
    const c = chatContext(a2, all, 'session')
    expect(c.rows.map((r) => [r.value, r.confidence])).toEqual([
      ['3 attempts · median 5.3° · 1 not measured', 'high'],
      ['3 attempts · median 0.08 · 1 not measured', 'medium'],
      ['3 attempts · median 3.0 s · 1 not measured', 'high'],
      ['3 attempts · median 8.4° · 1 flagged low · 1 not measured', 'low'],
    ])
    expect(c.note).toBe('Values for all 3 analyzed attempts in this session, with their confidence.')
  })
})

describe('suggestedQuestions', () => {
  it('only asks about what the attempt has', () => {
    expect(suggestedQuestions(a2, all)).toEqual([
      'What changed since attempt 1?',
      'Which phase varied most?',
      'What could I practise next?',
      'Why is knee tracking deviation low confidence?',
    ])
    expect(suggestedQuestions(a1, all)).toEqual(['Which phase varied most?', 'What could I practise next?'])
    expect(suggestedQuestions(gaps, all)[3]).toBe('Why is trunk inclination not measured?')
  })
})

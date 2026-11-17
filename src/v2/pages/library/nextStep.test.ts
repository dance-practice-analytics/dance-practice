import { describe, expect, it } from 'vitest'
import { attempt, session } from './fixtures'
import { nextStep } from './nextStep'

const older = session('older', { created_at: '2026-11-01T10:00:00Z', subject_code: 'S01' })
const latest = session('latest', { created_at: '2026-11-10T10:00:00Z', subject_code: 'S02' })

describe('nextStep', () => {
  it('points to the queue while anything is processing', () => {
    const a = [attempt('l1', latest, 1), attempt('l2', latest, 2), attempt('l3', latest, 3, { status: 'queued' })]
    const s = nextStep([latest], a)
    expect(s.kind).toBe('processing')
    expect(s.title).toBe('Your clips are processing')
    expect(s.body).toMatch(/^1 clip is/)
    expect(s.action).toEqual({ label: 'Open queue', route: { name: 'processing' } })
  })

  it('offers to compare the two newest measured attempts of the latest session', () => {
    const a = [attempt('l1', latest, 1), attempt('l2', latest, 2), attempt('l3', latest, 3), attempt('o1', older, 1), attempt('o2', older, 2)]
    const s = nextStep([latest, older], a)
    expect(s.kind).toBe('compare')
    expect(s.title).toBe('Compare attempt 3 with attempt 2')
    expect(s.action.route).toEqual({ name: 'compare', a: 'l2', b: 'l3' })
  })

  it('skips attempts that were not measured when picking the pair', () => {
    const a = [attempt('l1', latest, 1), attempt('l2', latest, 2, { status: 'failed' }), attempt('l3', latest, 3)]
    expect(nextStep([latest], a).title).toBe('Compare attempt 3 with attempt 1')
  })

  it('asks for another attempt when the latest session has one measured attempt', () => {
    const s = nextStep([latest, older], [attempt('l1', latest, 1), attempt('o1', older, 1), attempt('o2', older, 2)])
    expect(s.kind).toBe('another_attempt')
    expect(s.action.route).toEqual({ name: 'import' })
  })

  it('says why when nothing in the latest session was measured', () => {
    const s = nextStep([latest], [attempt('l1', latest, 1, { status: 'failed' })])
    expect(s.kind).toBe('failed')
    expect(s.action.route).toEqual({ name: 'library', sessionId: 'latest' })
  })

  it('follows the subject filter', () => {
    const a = [attempt('l1', latest, 1), attempt('l2', latest, 2, { status: 'processing' }), attempt('o1', older, 1), attempt('o2', older, 2)]
    expect(nextStep([latest, older], a).kind).toBe('processing')
    const s = nextStep([latest, older], a, 'S01')
    expect(s.kind).toBe('compare')
    expect(s.action.route).toEqual({ name: 'compare', a: 'o1', b: 'o2' })
  })

  it('suggests importing when there are no clips', () => {
    expect(nextStep([], []).kind).toBe('import')
    expect(nextStep([latest], [attempt('l1', latest, 1)], 'S09').kind).toBe('import')
  })

  it('never uses grading words', () => {
    const cases = [
      nextStep([latest], [attempt('l1', latest, 1), attempt('l2', latest, 2)]),
      nextStep([latest], [attempt('l1', latest, 1)]),
      nextStep([latest], [attempt('l1', latest, 1, { status: 'queued' })]),
      nextStep([latest], [attempt('l1', latest, 1, { status: 'failed' })]),
      nextStep([], []),
    ]
    for (const s of cases) expect(`${s.title} ${s.body}`).not.toMatch(/better|worse|score|good|bad|improve/i)
  })
})

import { describe, expect, it } from 'vitest'
import {
  checkRows,
  countChecks,
  findSession,
  formatLength,
  groupIntoSessions,
  localDate,
  parseTags,
  summaryDetail,
  type ClipDraft,
  type KnownClip,
} from './model'

let n = 0
const draft = (over: Partial<ClipDraft> = {}): ClipDraft => {
  n++
  return {
    id: `r${n}`,
    name: `clip_${n}.mp4`,
    sizeBytes: 1000,
    probe: 'ok',
    problem: null,
    durationS: 8.2,
    sha: `sha-${n}`,
    subject: 'S02',
    movement: 'releve_balance',
    view: 'front',
    recordedOn: '2026-11-15',
    reprocess: false,
    failure: null,
    ...over,
  }
}

const knownClip = (over: Partial<KnownClip> = {}): KnownClip => ({
  attemptId: 'a1',
  importedAt: '2026-11-04T10:00:00Z',
  subjectCode: 'S03',
  movement: 'releve_balance',
  status: 'done',
  ...over,
})

describe('parseTags', () => {
  it('reads subject, movement and view from a study file name', () => {
    expect(parseTags('S05_releve_side_01.mp4')).toEqual({ subject: 'S05', movement: 'releve_balance', view: 'side' })
    expect(parseTags('S05_pir_front_01.mp4')).toEqual({ subject: 'S05', movement: 'pirouette', view: 'front' })
    expect(parseTags('s11-pirouette-diag-07.mov')).toEqual({ subject: 'S11', movement: 'pirouette', view: 'diagonal' })
  })

  it('leaves a field empty when the name does not state it once', () => {
    expect(parseTags('IMG_4471.MOV')).toEqual({ subject: null, movement: null, view: null })
    expect(parseTags('1014-1.mp4')).toEqual({ subject: null, movement: null, view: null })
    expect(parseTags('S01_front_side.mp4').view).toBeNull()
  })

  it('ignores any folder part', () => {
    expect(parseTags('C:\\study\\S03\\S03_releve_front_02.mp4').subject).toBe('S03')
  })
})

describe('formatLength / localDate', () => {
  it('formats tenths of a second', () => {
    expect(formatLength(8.24)).toBe('00:08.2')
    expect(formatLength(39.96)).toBe('00:40.0')
    expect(formatLength(75)).toBe('01:15.0')
    expect(formatLength(null)).toBe('—')
  })

  it('gives the local calendar day', () => {
    expect(localDate(new Date(2026, 10, 4, 23, 30).getTime())).toBe('2026-11-04')
  })
})

describe('checkRows', () => {
  const none = new Map<string, KnownClip>()

  it('marks a tagged, readable study clip as ready', () => {
    const row = draft()
    expect(checkRows([row], none, 'study').get(row.id)).toEqual({ kind: 'ready', tooLong: false })
  })

  it('asks for a subject code on study clips only', () => {
    const row = draft({ subject: null })
    expect(checkRows([row], none, 'study').get(row.id)).toEqual({ kind: 'needs_subject' })
    expect(checkRows([row], none, 'own').get(row.id)).toEqual({ kind: 'ready', tooLong: false })
  })

  it('warns about a clip over 60 s without blocking it', () => {
    const row = draft({ durationS: 61 })
    expect(checkRows([row], none, 'study').get(row.id)).toEqual({ kind: 'ready', tooLong: true })
    const edge = draft({ durationS: 60 })
    expect(checkRows([edge], none, 'study').get(edge.id)).toEqual({ kind: 'ready', tooLong: false })
  })

  it('flags empty, unreadable and still-reading files before anything else', () => {
    const empty = draft({ sizeBytes: 0, probe: 'reading', sha: null })
    const text = draft({ probe: 'unreadable', sha: null, problem: 'Not a video.' })
    const reading = draft({ probe: 'reading', sha: null, subject: null })
    const zeroLength = draft({ durationS: 0 })
    const checks = checkRows([empty, text, reading, zeroLength], none, 'study')
    expect(checks.get(empty.id)).toEqual({ kind: 'empty' })
    expect(checks.get(text.id)).toEqual({ kind: 'unreadable', message: 'Not a video.' })
    expect(checks.get(reading.id)).toEqual({ kind: 'reading' })
    expect(checks.get(zeroLength.id)).toEqual({ kind: 'empty' })
  })

  it('reports a clip that is already in the library, even without a subject code', () => {
    const row = draft({ sha: 'abc', subject: null })
    const known = new Map([['abc', knownClip()]])
    expect(checkRows([row], known, 'study').get(row.id)).toEqual({ kind: 'duplicate', known: knownClip(), reprocess: false })
    const again = { ...row, reprocess: true }
    expect(checkRows([again], known, 'study').get(row.id)).toMatchObject({ kind: 'duplicate', reprocess: true })
  })

  it('imports only the first copy of a file listed twice', () => {
    const first = draft({ sha: 'same', name: 'a.mp4' })
    const second = draft({ sha: 'same', name: 'b.mp4' })
    const checks = checkRows([first, second], none, 'study')
    expect(checks.get(first.id)?.kind).toBe('ready')
    expect(checks.get(second.id)).toEqual({ kind: 'duplicate_in_list', of: 'a.mp4' })
  })

  it('keeps the reason of a row the server refused', () => {
    const row = draft({ failure: 'Can’t reach the server right now.' })
    expect(checkRows([row], none, 'study').get(row.id)).toEqual({ kind: 'failed', message: 'Can’t reach the server right now.' })
  })
})

describe('countChecks / summaryDetail', () => {
  it('counts what the main button will queue', () => {
    const rows = [
      draft(),
      draft(),
      draft({ subject: null }),
      draft({ sha: 'dup' }),
      draft({ sha: 'dup2', reprocess: true }),
      draft({ probe: 'unreadable', sha: null }),
    ]
    const known = new Map([
      ['dup', knownClip()],
      ['dup2', knownClip({ attemptId: 'a2' })],
    ])
    const counts = countChecks(checkRows(rows, known, 'study').values())
    expect(counts).toEqual({ ready: 2, reprocess: 1, duplicates: 1, needsSubject: 1, unusable: 1, reading: 0, toQueue: 3 })
    expect(summaryDetail(counts)).toBe('1 to process again · 1 already imported · 1 needs a subject code · 1 file can’t be used')
  })

  it('says nothing extra when every clip is ready', () => {
    expect(summaryDetail(countChecks(checkRows([draft()], new Map(), 'study').values()))).toBe('')
  })
})

describe('groupIntoSessions', () => {
  it('groups by subject, movement, camera view and date, in first-seen order', () => {
    const a1 = draft({ subject: 'S02' })
    const b1 = draft({ subject: 'S03' })
    const a2 = draft({ subject: 'S02' })
    const a3 = draft({ subject: 'S02', movement: 'pirouette' })
    const a4 = draft({ subject: 'S02', view: 'side' })
    const a5 = draft({ subject: 'S02', recordedOn: '2026-11-14' })
    const groups = groupIntoSessions([a1, b1, a2, a3, a4, a5])
    expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([[a1.id, a2.id], [b1.id], [a3.id], [a4.id], [a5.id]])
    expect(groups[0]).toMatchObject({ subject: 'S02', movement: 'releve_balance', view: 'front', recordedOn: '2026-11-15' })
  })

  it('keeps personal videos without a code together', () => {
    const groups = groupIntoSessions([draft({ subject: null }), draft({ subject: null })])
    expect(groups).toHaveLength(1)
    expect(groups[0].subject).toBeNull()
  })
})

describe('findSession', () => {
  const sessions = [
    { id: 's1', subject_code: 'S02', movement_type: 'releve_balance' as const, camera_view: 'front' as const, recorded_on: '2026-11-15' },
    { id: 's2', subject_code: null, movement_type: 'pirouette' as const, camera_view: 'side' as const, recorded_on: '2026-11-15' },
  ]

  it('joins a session with the same four fields', () => {
    const [group] = groupIntoSessions([draft()])
    expect(findSession(sessions, group)?.id).toBe('s1')
    const [own] = groupIntoSessions([draft({ subject: null, movement: 'pirouette', view: 'side' })])
    expect(findSession(sessions, own)?.id).toBe('s2')
  })

  it('finds none when any field differs', () => {
    const [otherDay] = groupIntoSessions([draft({ recordedOn: '2026-11-16' })])
    const [otherSubject] = groupIntoSessions([draft({ subject: 'S04' })])
    expect(findSession(sessions, otherDay)).toBeNull()
    expect(findSession(sessions, otherSubject)).toBeNull()
  })
})

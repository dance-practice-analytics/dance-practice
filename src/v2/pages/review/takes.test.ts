// Linking the cameras of one take (synthetic names and rows only).
import { describe, expect, it } from 'vitest'
import type { CameraView, MovementType } from '../../../data/schema'
import { alignTakeDates, datasetTakeStem, linkedTakes, parseTags } from '../import/model'
import { cameraCount, clampTime, handOff, sharedViews, takeHandoff, takeKey, viewsOfTake, type TakeMember } from './takes'

let seq = 0
function attempt(view: CameraView | null, take: number | null, over: Partial<TakeMember['session']> & { status?: string; created_at?: string } = {}): TakeMember {
  seq++
  return {
    id: `a${seq}`,
    clip_number: take,
    status: over.status ?? 'done',
    created_at: over.created_at ?? `2026-11-17T10:00:${String(seq).padStart(2, '0')}Z`,
    session: {
      subject_id: over.subject_id === undefined ? 'subj-1' : over.subject_id,
      movement_type: (over.movement_type ?? 'phrase') as MovementType,
      recorded_on: over.recorded_on === undefined ? '2026-11-10' : over.recorded_on,
      camera_view: view,
    },
  }
}

describe('takeKey / viewsOfTake', () => {
  it('links the three cameras of one take and nothing else', () => {
    const f = attempt('front', 3)
    const s = attempt('side', 3)
    const d = attempt('diagonal', 3)
    const otherTake = attempt('side', 4)
    const otherDay = attempt('diagonal', 3, { recorded_on: '2026-11-11' })
    const otherSubject = attempt('diagonal', 3, { subject_id: 'subj-2' })
    const otherMovement = attempt('diagonal', 3, { movement_type: 'pirouette' })
    const all = [f, s, d, otherTake, otherDay, otherSubject, otherMovement]
    const views = viewsOfTake(f, all)
    expect(views).toEqual({ front: f, side: s, diagonal: d })
    expect(cameraCount(views)).toBe(3)
    expect(viewsOfTake(s, all).front).toBe(f)
  })

  it('links the cameras of take 0 (att0) and keeps it apart from take 1', () => {
    const f = attempt('front', 0)
    const s = attempt('side', 0)
    const d = attempt('diagonal', 0)
    const one = attempt('front', 1)
    expect(takeKey(f)).not.toBeNull()
    expect(viewsOfTake(s, [f, s, d, one])).toEqual({ front: f, side: s, diagonal: d })
  })

  it('needs a take number, a date and a camera', () => {
    expect(takeKey(attempt('front', null))).toBeNull()
    expect(takeKey(attempt('front', 1, { recorded_on: null }))).toBeNull()
    expect(takeKey(attempt(null, 1))).toBeNull()
    const lone = attempt('front', null)
    const views = viewsOfTake(lone, [lone, attempt('side', null)])
    expect(views).toEqual({ front: lone, side: null, diagonal: null })
    expect(cameraCount(views)).toBe(1)
  })

  it('an attempt without a camera shows nothing', () => {
    const x = attempt(null, 2)
    expect(cameraCount(viewsOfTake(x, [x, attempt('side', 2)]))).toBe(0)
  })

  it('links clips without a subject (own videos) by the other fields', () => {
    const f = attempt('front', 1, { subject_id: null })
    const d = attempt('diagonal', 1, { subject_id: null })
    expect(viewsOfTake(f, [f, d, attempt('diagonal', 1)]).diagonal).toBe(d)
  })

  it('prefers a processed clip, then the newest, for another camera; keeps itself for its own', () => {
    const f = attempt('front', 5)
    const queued = attempt('side', 5, { status: 'queued', created_at: '2026-11-17T12:00:00Z' })
    const oldDone = attempt('side', 5, { created_at: '2026-11-17T09:00:00Z' })
    const newDone = attempt('side', 5, { created_at: '2026-11-17T11:00:00Z' })
    const front2 = attempt('front', 5, { created_at: '2026-11-17T23:00:00Z' })
    const views = viewsOfTake(f, [f, queued, oldDone, newDone, front2])
    expect(views.side).toBe(newDone)
    expect(views.front).toBe(f)
  })
})

describe('sharedViews (Compare)', () => {
  it('offers a camera only when both takes have it', () => {
    const a = attempt('front', 1)
    const aD = attempt('diagonal', 1)
    const b = attempt('front', 2)
    const bD = attempt('diagonal', 2)
    const bS = attempt('side', 2)
    const shared = sharedViews(a, b, [a, aD, b, bD, bS])
    expect(shared.front).toEqual({ a, b })
    expect(shared.diagonal).toEqual({ a: aD, b: bD })
    expect(shared.side).toBeNull()
  })

  it('never pairs a clip with itself (A and B from one take)', () => {
    const f = attempt('front', 1)
    const s = attempt('side', 1)
    const shared = sharedViews(f, s, [f, s])
    expect(shared.front).toBeNull()
    expect(shared.side).toBeNull()
  })
})

describe('handoff', () => {
  it('is read once, and only by its target', () => {
    handOff({ time: 2.5, playing: true, rate: 0.5, target: 'x' })
    expect(takeHandoff('y')).toBeNull()
    expect(takeHandoff('x')).toBeNull()
    handOff({ time: 2.5, playing: false, rate: 1, target: 'x' })
    expect(takeHandoff('x')).toMatchObject({ time: 2.5, playing: false })
    expect(takeHandoff('x')).toBeNull()
  })

  it('clamps the time to the clip', () => {
    expect(clampTime(12, 10)).toBe(10)
    expect(clampTime(-1, 10)).toBe(0)
    expect(clampTime(Number.NaN, 10)).toBe(0)
    expect(clampTime(3, 0)).toBe(3)
  })
})

describe('Import: dataset takes', () => {
  it('reads the take from D##_attN_x names', () => {
    expect(datasetTakeStem('D01_att3_f.mp4')).toBe('d01_att3')
    expect(datasetTakeStem('D01_att3_d.MOV')).toBe('d01_att3')
    expect(datasetTakeStem('S05_releve_side_01.mp4')).toBeNull()
    expect(parseTags('D02_att12_s.mp4')).toMatchObject({ view: 'side', clipNumber: 12, movement: 'phrase' })
  })

  const row = (id: string, name: string, over: Partial<{ subject: string | null; recordedOn: string; view: CameraView; clipNumber: number | null; movement: MovementType }> = {}) => {
    const tags = parseTags(name)
    return {
      id,
      name,
      subject: over.subject === undefined ? 'S01' : over.subject,
      movement: over.movement ?? tags.movement ?? 'phrase',
      view: over.view ?? tags.view ?? 'front',
      recordedOn: over.recordedOn ?? '2026-11-10',
      clipNumber: over.clipNumber === undefined ? tags.clipNumber : over.clipNumber,
    }
  }

  it('gives the cameras of one dataset take the earliest date', () => {
    const rows = [
      row('1', 'D01_att3_f.mp4', { recordedOn: '2026-11-11' }),
      row('2', 'D01_att3_s.mp4', { recordedOn: '2026-11-10' }),
      row('3', 'D01_att4_f.mp4', { recordedOn: '2026-11-12' }),
      row('4', 'my_clip.mp4', { recordedOn: '2026-11-13' }),
    ]
    expect(alignTakeDates(rows).map((r) => r.recordedOn)).toEqual(['2026-11-10', '2026-11-10', '2026-11-12', '2026-11-13'])
  })

  it('lists takes filmed from several cameras, and a camera given twice', () => {
    const rows = [
      row('1', 'D01_att3_s.mp4'),
      row('2', 'D01_att3_f.mp4'),
      row('3', 'D01_att3_d.mp4', { recordedOn: '2026-11-11' }),
      row('4', 'D01_att4_f.mp4'),
      // Own videos linked by typing the same take number.
      row('5', 'phone_a.mp4', { subject: null, clipNumber: 2, view: 'front' }),
      row('6', 'phone_b.mp4', { subject: null, clipNumber: 2, view: 'diagonal' }),
      // Same camera twice in one take.
      row('7', 'x.mp4', { subject: 'S02', clipNumber: 1, view: 'side' }),
      row('8', 'y.mp4', { subject: 'S02', clipNumber: 1, view: 'side' }),
    ]
    const links = linkedTakes(rows)
    expect(links.map((l) => [l.subject, l.take, l.views, l.repeated])).toEqual([
      [null, 2, ['front', 'diagonal'], []],
      ['S01', 3, ['front', 'diagonal', 'side'], []],
      ['S02', 1, ['side'], ['side']],
    ])
    expect(links[1].rowIds.sort()).toEqual(['1', '2', '3'])
  })

  it('links the three cameras of an att0 take', () => {
    const rows = [row('1', 'D01_att0_f.mp4'), row('2', 'D01_att0_s.mp4'), row('3', 'D01_att0_d.mp4'), row('4', 'D01_att1_f.mp4')]
    const links = linkedTakes(rows)
    expect(links.map((l) => [l.take, l.views])).toEqual([[0, ['front', 'diagonal', 'side']]])
    expect(links[0].rowIds.sort()).toEqual(['1', '2', '3'])
  })

  it('does not link rows without a take number', () => {
    expect(linkedTakes([row('1', 'a.mp4', { clipNumber: null }), row('2', 'b.mp4', { clipNumber: null, view: 'side' })])).toEqual([])
  })
})

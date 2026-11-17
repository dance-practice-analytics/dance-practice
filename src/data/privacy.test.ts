// FR-3.2.5 / NFR-2: a stored clip name never carries the local file name, and the
// dancer's notes (FR-3.2.2, FR-3.5.7) are saved as typed, within the column limit.
// All names here are invented.

import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { deidentifiedClipName, isDeidentifiedClipName, safeStoredClipName } from './clipFile'
import { createSession, normaliseNote, storedClipFields, updateAttemptNote, updateSession } from './repo'
import { NOTE_MAX_CHARS } from './schema'

describe('deidentifiedClipName', () => {
  it.each([
    ['S03_releve_take7.mp4', 'S03_att07.mp4'],
    ['Maria_S03_releve_07.MOV', 'S03_att07.mov'],
    ['C:\\Users\\maria\\Videos\\S11-pirouette-12.webm', 'S11_att12.webm'],
    ['/home/jo/study/S01_releve_front_01.mp4', 'S01_att01.mp4'],
  ])('keeps only the subject code and attempt number of %s', (name, expected) => {
    expect(deidentifiedClipName(name)).toBe(expected)
  })

  it.each([
    ['Maria rehearsal.mp4', null, 'clip.mp4'],
    ['Maria rehearsal take 3.mov', null, 'clip 3.mov'],
    ['IMG_4471.MOV', null, 'clip.mov'],
    ['Maria rehearsal.mp4', 5, 'clip 5.mp4'],
    ['S04 Maria.mp4', null, 'clip.mp4'],
    ['Sample attempt 1 (synthetic)', null, 'clip 1'],
    ['', null, 'clip'],
  ])('falls back to a neutral name for %s', (name, number, expected) => {
    expect(deidentifiedClipName(name, number)).toBe(expected)
  })

  it('uses the given clip number when the name has a subject code but no number', () => {
    expect(deidentifiedClipName('S04_Maria.mp4', 9)).toBe('S04_att09.mp4')
    // A number read from the name wins over a typed one only when it is there.
    expect(deidentifiedClipName('S04_take2.mp4', 9)).toBe('S04_att02.mp4')
  })

  it('never keeps an extension that could be text', () => {
    expect(deidentifiedClipName('S02_releve_03.anna')).toBe('S02_att03')
  })

  it('never returns any word of the original name', () => {
    for (const name of ['Quillfeather_S05_releve_02.mp4', 'quillfeather.mp4', 'C:\\Quillfeather\\clip.mp4', 'take 4 quillfeather.mkv']) {
      expect(deidentifiedClipName(name).toLowerCase()).not.toContain('quill')
    }
  })

  it('recognises its own output, and rebuilds anything else on the way out', () => {
    for (const n of ['S03_att07.mp4', 'clip 7.mp4', 'clip.mp4', 'clip', 'S12_att100.mov']) expect(isDeidentifiedClipName(n)).toBe(true)
    for (const n of ['Maria.mp4', 'S03_releve_take7.mp4', 'clip Maria.mp4']) expect(isDeidentifiedClipName(n)).toBe(false)
    expect(safeStoredClipName('C:\\clips\\Maria\\S01_releve_take1.mp4')).toBe('S01_att01.mp4')
    expect(safeStoredClipName('S01_att01.mp4')).toBe('S01_att01.mp4')
    expect(safeStoredClipName(null)).toBeNull()
  })

  it('storedClipFields records the clip number with the label', () => {
    expect(storedClipFields({ clip_name: 'S02_pir_front_11.mp4' })).toEqual({ clip_name: 'S02_att11.mp4', clip_number: 11 })
    expect(storedClipFields({ clip_name: 'Maria.mp4', clip_number: 4 })).toEqual({ clip_name: 'clip 4.mp4', clip_number: 4 })
    expect(storedClipFields({ clip_name: 'Maria.mp4', clip_number: 0 })).toEqual({ clip_name: 'clip.mp4', clip_number: null })
  })
})

// ---------- notes ----------

type Row = Record<string, unknown>

/** Just enough of the client for insert / update … select … single / maybeSingle. */
function fakeClient(rows: Record<string, Row[]>) {
  const sent: { table: string; op: string; payload: Row }[] = []
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }) },
    from(table: string) {
      let op = 'select'
      let payload: Row = {}
      let id: unknown
      const q = {
        insert(p: Row) {
          op = 'insert'
          payload = p
          return q
        },
        update(p: Row) {
          op = 'update'
          payload = p
          return q
        },
        eq(_col: string, v: unknown) {
          id = v
          return q
        },
        select: () => q,
        single: () => q,
        maybeSingle: () => q,
        then(ok: (r: unknown) => unknown) {
          sent.push({ table, op, payload })
          const list = (rows[table] ??= [])
          if (op === 'insert') {
            const row = { id: `new-${list.length}`, ...payload }
            list.push(row)
            return Promise.resolve({ data: row, error: null, status: 201 }).then(ok)
          }
          const row = list.find((r) => r.id === id)
          if (row) Object.assign(row, payload)
          return Promise.resolve({ data: row ? { ...row } : null, error: null, status: 200 }).then(ok)
        },
      }
      return q
    },
  }
  return { client: client as unknown as SupabaseClient, sent }
}

describe('notes', () => {
  it('normaliseNote trims, keeps line breaks and turns an empty note into null', () => {
    expect(normaliseNote('  felt steady \r\n second line  ')).toBe('felt steady \n second line')
    expect(normaliseNote('   ')).toBeNull()
    expect(normaliseNote(null)).toBeNull()
    expect(normaliseNote('x'.repeat(NOTE_MAX_CHARS))).toHaveLength(NOTE_MAX_CHARS)
    expect(() => normaliseNote('x'.repeat(NOTE_MAX_CHARS + 1))).toThrow(/up to 2000/)
  })

  it('createSession saves the optional note and a valid date', async () => {
    const { client, sent } = fakeClient({})
    const s = await createSession(client, { movement_type: 'releve_balance', recorded_on: '2026-11-14', note: '  new shoes ' })
    expect(s).toMatchObject({ note: 'new shoes', recorded_on: '2026-11-14' })
    expect(sent[0].payload).not.toHaveProperty('owner_id')
    await expect(createSession(client, { movement_type: 'releve_balance', recorded_on: '2026-02-30' })).rejects.toMatchObject({
      code: 'invalid_date',
    })
  })

  it('updateSession sends only the fields that changed', async () => {
    const { client, sent } = fakeClient({ sessions: [{ id: 's1', note: null, recorded_on: '2026-11-10' }] })
    await updateSession(client, 's1', { recorded_on: '2026-11-11' })
    expect(sent.at(-1)?.payload).toEqual({ recorded_on: '2026-11-11' })
    const saved = await updateSession(client, 's1', { note: 'tired after class' })
    expect(sent.at(-1)?.payload).toEqual({ note: 'tired after class' })
    expect(saved).toMatchObject({ note: 'tired after class', recorded_on: '2026-11-11' })
    await expect(updateSession(client, 'gone', { note: 'x' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('updateAttemptNote saves, clears and refuses a note that is too long without sending it', async () => {
    const { client, sent } = fakeClient({ attempts: [{ id: 'a1', note: null }] })
    expect((await updateAttemptNote(client, 'a1', ' heel came down early ')).note).toBe('heel came down early')
    expect((await updateAttemptNote(client, 'a1', '')).note).toBeNull()
    const before = sent.length
    await expect(updateAttemptNote(client, 'a1', 'x'.repeat(NOTE_MAX_CHARS + 1))).rejects.toMatchObject({ code: 'note_too_long' })
    expect(sent).toHaveLength(before)
  })
})

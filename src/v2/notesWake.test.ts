// Attempt-note autosave (FR-3.5.7), the processing wake lock (FR-3.8.5) and the
// folder import filter (FR-3.2.4). Synthetic file names only.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { videoFilesOfFolder } from './pages/import/model'
import { createNoteAutosave, type NoteSaveState } from './pages/review/noteAutosave'
import { createScreenWakeLock, type WakeLockEnv } from './wakeLock'

describe('note autosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(save = vi.fn(async (t: string) => t.trim())) {
    const states: NoteSaveState[] = []
    const saver = createNoteAutosave({ initial: '', save, onState: (s) => states.push(s), delayMs: 500 })
    return { saver, save, states, last: () => states.at(-1) }
  }

  it('waits for a pause in typing, then saves once and says Saved', async () => {
    const { saver, save, last } = setup()
    saver.change('h')
    saver.change('he')
    saver.change('heel')
    expect(last()?.status).toBe('dirty')
    await vi.advanceTimersByTimeAsync(499)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('heel')
    expect(last()).toEqual({ status: 'saved', text: 'heel' })
  })

  it('flush saves at once (blur, leaving the attempt)', async () => {
    const { saver, save, last } = setup()
    saver.change('steady')
    await saver.flush()
    expect(save).toHaveBeenCalledWith('steady')
    expect(last()?.status).toBe('saved')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('typing back to the stored text needs no save', async () => {
    const { saver, save, last } = setup()
    saver.change('x')
    saver.change('')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
    expect(last()?.status).toBe('saved')
  })

  it('saves edits made during a save right after it', async () => {
    let release!: () => void
    const save = vi.fn((t: string) => new Promise<string>((r) => (release = () => r(t))))
    const { saver, last } = setup(save)
    saver.change('one')
    await vi.advanceTimersByTimeAsync(500)
    expect(last()?.status).toBe('saving')
    saver.change('one two')
    release()
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenLastCalledWith('one two')
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(last()).toEqual({ status: 'saved', text: 'one two' })
  })

  it('reports a failed save with its message and can try again', async () => {
    const save = vi.fn().mockRejectedValueOnce({ message: 'Can’t reach the server right now.', recovery: 'Check your connection.' })
    save.mockImplementation(async (t: string) => t)
    const { saver, last } = setup(save)
    saver.change('note')
    await vi.advanceTimersByTimeAsync(500)
    expect(last()).toMatchObject({ status: 'error', message: 'Can’t reach the server right now.', recovery: 'Check your connection.' })
    await saver.flush()
    expect(last()?.status).toBe('saved')
  })
})

describe('processing wake lock', () => {
  function env(overrides: Partial<WakeLockEnv> = {}) {
    let visible = true
    let listener: (() => void) | null = null
    const released: number[] = []
    let n = 0
    const e: WakeLockEnv = {
      request: async () => {
        const id = ++n
        const handlers: (() => void)[] = []
        return {
          release: async () => {
            released.push(id)
            handlers.forEach((h) => h())
          },
          addEventListener: (_: 'release', cb: () => void) => handlers.push(cb),
        }
      },
      isVisible: () => visible,
      onVisibilityChange: (cb) => {
        listener = cb
        return () => (listener = null)
      },
      ...overrides,
    }
    return {
      e,
      released,
      requests: () => n,
      setVisible(v: boolean) {
        visible = v
        listener?.()
      },
      listening: () => listener !== null,
    }
  }
  const tick = () => new Promise((r) => setTimeout(r, 0))

  it('holds the lock while active and releases it when the queue empties', async () => {
    const t = env()
    const lock = createScreenWakeLock(t.e)
    lock.setActive(true)
    await tick()
    expect(lock.held()).toBe(true)
    lock.setActive(true)
    await tick()
    expect(t.requests()).toBe(1)
    lock.setActive(false)
    expect(lock.held()).toBe(false)
    expect(t.released).toEqual([1])
    expect(t.listening()).toBe(false)
  })

  it('lets go when the page hides and asks again when it is visible', async () => {
    const t = env()
    const lock = createScreenWakeLock(t.e)
    lock.setActive(true)
    await tick()
    t.setVisible(false)
    expect(lock.held()).toBe(false)
    t.setVisible(true)
    await tick()
    expect(lock.held()).toBe(true)
    expect(t.requests()).toBe(2)
  })

  it('does not ask while hidden, and does nothing where the API is missing or refuses', async () => {
    const hidden = env()
    hidden.setVisible(false)
    const a = createScreenWakeLock(hidden.e)
    a.setActive(true)
    await tick()
    expect(hidden.requests()).toBe(0)

    const none = createScreenWakeLock(env({ request: null }).e)
    expect(() => none.setActive(true)).not.toThrow()
    expect(none.held()).toBe(false)

    const refused = createScreenWakeLock(env({ request: () => Promise.reject(new DOMException('no', 'NotAllowedError')) }).e)
    refused.setActive(true)
    await tick()
    expect(refused.held()).toBe(false)
  })

  it('releases a lock that arrives after the queue already ended', async () => {
    const t = env()
    const lock = createScreenWakeLock(t.e)
    lock.setActive(true)
    lock.setActive(false)
    await tick()
    expect(lock.held()).toBe(false)
    expect(t.released).toEqual([1])
  })
})

describe('folder import', () => {
  it('keeps video files in name order and counts the rest', () => {
    const files = [
      { name: 'S01_releve_10.mp4', type: 'video/mp4' },
      { name: 'notes.txt', type: 'text/plain' },
      { name: 'S01_releve_2.mov', type: '' },
      { name: '._S01_releve_1.mp4', type: 'video/mp4' },
      { name: 'S01_releve_1.MP4', type: '' },
      { name: 'thumb.jpg', type: 'image/jpeg' },
    ]
    const { videos, skipped } = videoFilesOfFolder(files)
    expect(videos.map((f) => f.name)).toEqual(['S01_releve_1.MP4', 'S01_releve_2.mov', 'S01_releve_10.mp4'])
    expect(skipped).toBe(3)
  })
})

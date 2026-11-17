// Keeps the screen on while clips are processing (FR-3.8.5). Screen Wake Lock API:
// held from the first clip until the queue is empty. The browser drops the lock when
// the page is hidden; it is asked for again when the page is visible and the queue is
// still running. Where the API is missing (or refuses) this does nothing.

interface Sentinel {
  release(): Promise<void>
  addEventListener(type: 'release', cb: () => void): void
}

export interface WakeLockEnv {
  request: (() => Promise<Sentinel>) | null
  isVisible(): boolean
  onVisibilityChange(cb: () => void): () => void
}

function browserEnv(): WakeLockEnv {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }) : null
  const doc = typeof document !== 'undefined' ? document : null
  return {
    request: nav?.wakeLock ? () => nav.wakeLock!.request('screen') : null,
    isVisible: () => doc?.visibilityState === 'visible',
    onVisibilityChange: (cb) => {
      doc?.addEventListener('visibilitychange', cb)
      return () => doc?.removeEventListener('visibilitychange', cb)
    },
  }
}

export interface ScreenWakeLock {
  /** true while work is running; false releases the lock. */
  setActive(on: boolean): void
  /** For tests and the Processing screen: is a lock held right now? */
  held(): boolean
}

export function createScreenWakeLock(env: WakeLockEnv = browserEnv()): ScreenWakeLock {
  let wanted = false
  let sentinel: Sentinel | null = null
  let pending = false
  let unlisten: (() => void) | null = null

  async function acquire() {
    if (!env.request || !wanted || sentinel || pending || !env.isVisible()) return
    pending = true
    try {
      const s = await env.request()
      if (!wanted) {
        // The queue ended while the request was in flight.
        await s.release().catch(() => undefined)
        return
      }
      sentinel = s
      s.addEventListener('release', () => {
        if (sentinel === s) sentinel = null
      })
    } catch {
      // Refused (battery saver, no user activation, policy): processing goes on anyway.
    } finally {
      pending = false
    }
  }

  function release() {
    const s = sentinel
    sentinel = null
    if (s) void s.release().catch(() => undefined)
  }

  const onVisibility = () => {
    if (env.isVisible()) void acquire()
    else release()
  }

  return {
    setActive(on) {
      if (!env.request || on === wanted) return
      wanted = on
      if (on) {
        unlisten = env.onVisibilityChange(onVisibility)
        void acquire()
      } else {
        unlisten?.()
        unlisten = null
        release()
      }
    },
    held: () => sentinel !== null,
  }
}

/** The one lock of this tab, used by the processing queue. */
export const processingWakeLock = createScreenWakeLock()

// Debounced autosave of the attempt note (FR-3.5.7). Pure timing and state, no DOM and
// no network: `save` is given, so the rules are unit-tested with fake timers.
// One save at a time; edits made while a save runs are saved right after it.

export type NoteSaveState =
  | { status: 'saved'; text: string }
  | { status: 'dirty'; text: string }
  | { status: 'saving'; text: string }
  | { status: 'error'; text: string; message: string; recovery: string | null }

export interface NoteAutosaveOptions {
  /** The note as stored now. */
  initial: string
  /** Saves the text; resolves with the text as stored (trimmed), rejects with an ApiError-like error. */
  save(text: string): Promise<string>
  onState(state: NoteSaveState): void
  delayMs?: number
}

export interface NoteAutosave {
  change(text: string): void
  /** Saves now if there is something unsaved (blur, leaving the page). */
  flush(): Promise<void>
  dispose(): void
}

const same = (a: string, b: string) => a.trim() === b.trim()

export function createNoteAutosave({ initial, save, onState, delayMs = 800 }: NoteAutosaveOptions): NoteAutosave {
  let stored = initial
  let text = initial
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  let disposed = false

  const emit = (s: NoteSaveState) => {
    if (!disposed) onState(s)
  }
  const clear = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  async function run(): Promise<void> {
    clear()
    if (running) {
      await running
      // The save that just ended may already cover the latest text.
      if (!same(text, stored)) return run()
      return
    }
    if (same(text, stored)) {
      emit({ status: 'saved', text })
      return
    }
    const sending = text
    emit({ status: 'saving', text: sending })
    running = save(sending).then(
      (result) => {
        stored = result
        running = null
        if (same(text, stored)) emit({ status: 'saved', text })
        else {
          emit({ status: 'dirty', text })
          schedule()
        }
      },
      (e: unknown) => {
        running = null
        const err = (e && typeof e === 'object' ? e : {}) as { message?: unknown; recovery?: unknown }
        emit({
          status: 'error',
          text,
          message: typeof err.message === 'string' ? err.message : 'That didn’t save.',
          recovery: typeof err.recovery === 'string' ? err.recovery : null,
        })
      },
    )
    return running
  }

  function schedule() {
    clear()
    if (disposed) return
    timer = setTimeout(() => void run(), delayMs)
  }

  return {
    change(next) {
      text = next
      if (same(text, stored) && !running) {
        clear()
        emit({ status: 'saved', text })
        return
      }
      emit({ status: 'dirty', text })
      schedule()
    },
    flush() {
      if (same(text, stored) && !running) return Promise.resolve()
      return run()
    },
    dispose() {
      clear()
      disposed = true
    },
  }
}

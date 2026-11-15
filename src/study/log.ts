// Usability-study instrumentation (behind a toggle, off by default).
// Records what the participant did and when, by participant code only. It never
// records free text (notes, goals, reflections, companion questions), only their
// length. Kept separate from measurement-accuracy evaluation.
// Enable with #/...?study=on or Ctrl+Shift+S. Requires IRB approval before use.

import { createStore } from '../state/store'

export interface StudyEvent {
  /** Milliseconds since the log was started. */
  ms: number
  at: string
  participant: string | null
  task: string | null
  type: string
  detail?: Record<string, string | number | boolean | null>
}

export type TaskOutcome = 'completed' | 'assisted' | 'abandoned'

export interface StudyTask {
  id: string
  title: string
  prompt: string
}

/** Default task script. Facilitators can read the prompt aloud. */
export const TASKS: StudyTask[] = [
  { id: 'T1', title: 'Start a session', prompt: 'Sign in and start a new practice session with a goal of your own, using the sample clip.' },
  { id: 'T2', title: 'Confirm attempts', prompt: 'Check where each attempt and phase starts. Fix anything that looks off, then confirm.' },
  { id: 'T3', title: 'Find a moment', prompt: 'Find the moment in attempt 1 where your knees are furthest from the line over your toes.' },
  { id: 'T4', title: 'Compare two attempts', prompt: 'Compare attempt 1 and attempt 3 during the hold. What changed?' },
  { id: 'T5', title: 'Read a gap', prompt: 'Find a place where tracking was missing or unreliable and explain what it means.' },
  { id: 'T6', title: 'Reflect', prompt: 'Mark a moment, write a short note, and finish the session with a goal for next time.' },
]

interface StudyState {
  enabled: boolean
  panelOpen: boolean
  startedAt: number | null
  participant: string | null
  task: string | null
  taskStartedAt: number | null
  events: StudyEvent[]
  /** Event count at the last export, so the panel can say whether anything is unsaved. */
  exportedCount: number | null
}

const KEY = 'dad-study-log-v1'

function load(): StudyState {
  const fresh: StudyState = { enabled: false, panelOpen: false, startedAt: null, participant: null, task: null, taskStartedAt: null, events: [], exportedCount: null }
  try {
    return { ...fresh, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<StudyState>) }
  } catch {
    return fresh
  }
}

export const study = createStore<StudyState>(load())

study.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(study.get()))
  } catch {
    // not persisted; the log still lives in this tab
  }
})

export function track(type: string, detail?: StudyEvent['detail']) {
  const s = study.get()
  if (!s.enabled || s.startedAt === null) return
  const now = Date.now()
  study.set({ ...s, events: [...s.events, { ms: now - s.startedAt, at: new Date(now).toISOString(), participant: s.participant, task: s.task, type, detail }] })
}

export function setStudyEnabled(enabled: boolean) {
  study.set((s) => ({ ...s, enabled, panelOpen: enabled, startedAt: s.startedAt ?? (enabled ? Date.now() : null) }))
}

export function toggleStudyPanel() {
  study.set((s) => (s.enabled ? { ...s, panelOpen: !s.panelOpen } : { ...s, enabled: true, panelOpen: true, startedAt: s.startedAt ?? Date.now() }))
}

export function setStudyParticipant(participant: string | null) {
  if (study.get().participant === participant) return
  study.set((s) => ({ ...s, participant }))
}

export function startTask(id: string) {
  if (study.get().task) endTask('abandoned')
  study.set((s) => ({ ...s, task: id, taskStartedAt: Date.now() }))
  track('task_start', { task: id })
}

export function endTask(outcome: TaskOutcome) {
  const s = study.get()
  if (!s.task) return
  track('task_end', { task: s.task, outcome, seconds: s.taskStartedAt ? Math.round((Date.now() - s.taskStartedAt) / 100) / 10 : null })
  study.set((x) => ({ ...x, task: null, taskStartedAt: null }))
}

export function clearStudyLog() {
  study.set((s) => ({ ...s, events: [], task: null, taskStartedAt: null, startedAt: Date.now(), exportedCount: null }))
}

export function markStudyLogExported() {
  study.set((s) => ({ ...s, exportedCount: s.events.length }))
}

export function studyLogJson(): string {
  const { participant, startedAt, events } = study.get()
  return JSON.stringify({ kind: 'dad-usability-log', version: 1, participant, startedAt: startedAt && new Date(startedAt).toISOString(), events }, null, 1)
}

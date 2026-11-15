import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type Dispatch, type ReactNode } from 'react'
import type { Attempt, AttemptContext, Marker, MetricDefinition, MetricId, PhaseId, PhaseSummary, SessionResults } from '../types'
import type { UIAction } from '../companion/actions'
import { withBoundary } from '../lib/attempts'
import { summarize, timeOnReleve } from '../lib/series'
import { api, ApiError } from '../api/client'
import { track } from '../study/log'
import { clock } from './clock'
import { saveStatus } from './app'

export type Mode = 'review' | 'compare'
export type CompareView = 'side' | 'overlay'

export interface StudioState {
  attempts: Attempt[]
  revision: number
  /** Bumped by every edit that must be saved with PUT /attempts. */
  attemptEdits: number
  focusMetric: MetricId
  mode: Mode
  compare: { a: string; b: string; phase: PhaseId }
  compareView: CompareView
  ghost: boolean
  guides: boolean
  trails: boolean
  /** Show the clip under the skeleton, and the skeleton over the clip. */
  footage: boolean
  skeleton: boolean
  markers: Marker[]
  goal: string
  reflection: string
  nextGoal: string
  companionOpen: boolean
  reflectOpen: boolean
  /** Bumped when the companion points at a metric, to replay the highlight. */
  pulse: { metricId: MetricId; key: number } | null
}

export type StudioAction =
  | { type: 'focusMetric'; metricId: MetricId; pulse?: boolean }
  | { type: 'setMode'; mode: Mode }
  | { type: 'setCompare'; a?: string; b?: string; phase?: PhaseId }
  | { type: 'setCompareView'; view: CompareView }
  | { type: 'toggleGhost' }
  | { type: 'toggleGuides' }
  | { type: 'toggleTrails' }
  | { type: 'toggleFootage' }
  | { type: 'toggleSkeleton' }
  | { type: 'addMarker'; t: number; text: string; author: Marker['author'] }
  | { type: 'updateMarker'; id: string; text: string }
  | { type: 'removeMarker'; id: string }
  | { type: 'setGoal'; text: string }
  | { type: 'setReflection'; text: string }
  | { type: 'setNextGoal'; text: string }
  | { type: 'toggleCompanion' }
  | { type: 'setReflectOpen'; open: boolean }
  | { type: 'setBoundary'; attemptId: string; index: number; t: number }
  | { type: 'commitBoundaries' }
  | { type: 'setRevision'; revision: number }
  | { type: 'cycleContext'; attemptId: string; key: keyof AttemptContext }

const CYCLE: { [K in keyof AttemptContext]: AttemptContext[K][] } = {
  view: ['front', 'side', 'mirror'],
  music: [false, true],
  fatigue: ['fresh', 'some', 'tired'],
}

function next<T>(list: T[], v: T): T {
  return list[(list.indexOf(v) + 1) % list.length]
}

let markerSeq = Date.now() % 100000

function makeReducer(results: SessionResults) {
  const { duration, fps } = results.session
  return function reducer(s: StudioState, action: StudioAction): StudioState {
    switch (action.type) {
      case 'focusMetric':
        return { ...s, focusMetric: action.metricId, pulse: action.pulse ? { metricId: action.metricId, key: (s.pulse?.key ?? 0) + 1 } : s.pulse }
      case 'setMode':
        return { ...s, mode: action.mode }
      case 'setCompare': {
        let { a = s.compare.a, b = s.compare.b } = action
        if (a === b) [a, b] = action.a ? [a, s.compare.a] : [s.compare.b, b]
        return { ...s, compare: { a, b, phase: action.phase ?? s.compare.phase } }
      }
      case 'setCompareView':
        return { ...s, compareView: action.view }
      case 'toggleGhost':
        return { ...s, ghost: !s.ghost }
      case 'toggleGuides':
        return { ...s, guides: !s.guides }
      case 'toggleTrails':
        return { ...s, trails: !s.trails }
      case 'toggleFootage':
        return { ...s, footage: !s.footage, skeleton: s.footage ? true : s.skeleton }
      case 'toggleSkeleton':
        return { ...s, skeleton: !s.skeleton }
      case 'addMarker': {
        const marker: Marker = { id: `m${++markerSeq}`, t: action.t, text: action.text, author: action.author }
        return { ...s, markers: [...s.markers, marker].sort((x, y) => x.t - y.t) }
      }
      case 'updateMarker':
        return { ...s, markers: s.markers.map((m) => (m.id === action.id ? { ...m, text: action.text } : m)) }
      case 'removeMarker':
        return { ...s, markers: s.markers.filter((m) => m.id !== action.id) }
      case 'setGoal':
        return { ...s, goal: action.text }
      case 'setReflection':
        return { ...s, reflection: action.text }
      case 'setNextGoal':
        return { ...s, nextGoal: action.text }
      case 'toggleCompanion':
        return { ...s, companionOpen: !s.companionOpen }
      case 'setReflectOpen':
        return { ...s, reflectOpen: action.open }
      case 'setBoundary': {
        const i = s.attempts.findIndex((a) => a.id === action.attemptId)
        if (i < 0) return s
        const lo = i > 0 ? s.attempts[i - 1].end + 0.1 : 0
        const hi = i < s.attempts.length - 1 ? s.attempts[i + 1].start - 0.1 : duration
        const attempts = s.attempts.slice()
        attempts[i] = withBoundary(s.attempts[i], action.index, action.t, lo, hi, fps)
        return { ...s, attempts }
      }
      case 'commitBoundaries':
        return { ...s, attemptEdits: s.attemptEdits + 1 }
      case 'setRevision':
        return { ...s, revision: action.revision }
      case 'cycleContext':
        return {
          ...s,
          attemptEdits: s.attemptEdits + 1,
          attempts: s.attempts.map((a) => {
            if (a.id !== action.attemptId) return a
            const list = CYCLE[action.key] as AttemptContext[typeof action.key][]
            return { ...a, context: { ...a.context, [action.key]: next(list, a.context[action.key]) } }
          }),
        }
    }
  }
}

function initialState(results: SessionResults): StudioState {
  const [first, second, third] = results.attempts
  return {
    attempts: results.attempts,
    revision: results.session.boundaryRevision,
    attemptEdits: 0,
    focusMetric: 'kneeToe',
    mode: 'review',
    compare: { a: first.id, b: (third ?? second ?? first).id, phase: 'hold' },
    compareView: 'side',
    ghost: true,
    guides: true,
    trails: false,
    footage: true,
    skeleton: true,
    markers: results.notes.moments,
    goal: results.session.goal,
    reflection: results.notes.reflection,
    nextGoal: results.notes.nextGoal,
    companionOpen: false,
    reflectOpen: false,
    pulse: null,
  }
}

const TEXT_EDITS = new Set<StudioAction['type']>(['setGoal', 'setReflection', 'setNextGoal', 'updateMarker'])

function studyDetail(action: StudioAction): Record<string, string | number | boolean | null> | undefined {
  const detail: Record<string, string | number | boolean | null> = {}
  for (const [k, v] of Object.entries(action)) {
    if (k === 'type') continue
    if (k === 'text') detail.textLength = (v as string).length
    else if (typeof v === 'number') detail[k] = Math.round(v * 100) / 100
    else if (typeof v === 'string' || typeof v === 'boolean') detail[k] = v
  }
  return Object.keys(detail).length ? detail : undefined
}

/** Debounced saves: notes and goal with PATCH, attempts and context with PUT. */
function useAutosave(sessionId: string, state: StudioState, dispatch: Dispatch<StudioAction>) {
  const latest = useRef(state)
  latest.current = state
  const notesKey = JSON.stringify([state.goal, state.markers, state.reflection, state.nextGoal])
  const firstNotes = useRef(notesKey)

  const run = useCallback(async (work: () => Promise<void>) => {
    saveStatus.set({ state: 'saving' })
    try {
      await work()
      saveStatus.set({ state: 'saved', at: Date.now() })
    } catch (e) {
      saveStatus.set({ state: 'error', message: e instanceof ApiError ? e.message : 'Couldn’t save. Your changes are still here; try again shortly.' })
    }
  }, [])

  const saveNotes = useCallback(() => {
    pendingNotes.current = false
    const s = latest.current
    return run(async () => {
      await api.patchSession(sessionId, { goal: s.goal, notes: { moments: s.markers, reflection: s.reflection, nextGoal: s.nextGoal } })
      track('notes.saved', { moments: s.markers.length, reflectionLength: s.reflection.length, goalLength: s.goal.length })
    })
  }, [sessionId, run])

  // PUTs run one at a time, each carrying the revision the previous one returned.
  const serverRevision = useRef(state.revision)
  const queue = useRef(Promise.resolve())
  const saveAttempts = useCallback(() => {
    pendingAttempts.current = false
    queue.current = queue.current.then(() =>
      run(async () => {
        const res = await api.putAttempts(sessionId, { boundaryRevision: serverRevision.current, attempts: latest.current.attempts })
        serverRevision.current = res.boundaryRevision
        dispatch({ type: 'setRevision', revision: res.boundaryRevision })
      }),
    )
  }, [sessionId, run, dispatch])

  const pendingNotes = useRef(false)
  useEffect(() => {
    if (notesKey === firstNotes.current) return
    pendingNotes.current = true
    const id = window.setTimeout(saveNotes, 700)
    return () => window.clearTimeout(id)
  }, [notesKey, saveNotes])

  const pendingAttempts = useRef(false)
  useEffect(() => {
    if (state.attemptEdits === 0) return
    pendingAttempts.current = true
    const id = window.setTimeout(saveAttempts, 400)
    return () => window.clearTimeout(id)
  }, [state.attemptEdits, saveAttempts])

  // Leaving the workspace before a debounce fires still saves the last edit.
  const flush = useRef(() => {})
  flush.current = () => {
    if (pendingNotes.current) saveNotes()
    if (pendingAttempts.current) saveAttempts()
  }
  useEffect(() => {
    const onHide = () => flush.current()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      flush.current()
    }
  }, [])

  useEffect(() => () => saveStatus.set({ state: 'idle' }), [])
}

interface StudioValue {
  results: SessionResults
  state: StudioState
  dispatch: Dispatch<StudioAction>
  metric: (id: MetricId) => MetricDefinition
  /** Metrics with the focus metric first. */
  orderedMetrics: MetricDefinition[]
  summary: (attemptId: string, phase: PhaseId, metricId: MetricId) => PhaseSummary
  releve: Record<string, number | null>
  attemptById: (id: string) => Attempt
  apply: (action: UIAction) => void
}

const StudioContext = createContext<StudioValue | null>(null)

export function StudioProvider({ results, children }: { results: SessionResults; children: ReactNode }) {
  const reducer = useMemo(() => makeReducer(results), [results])
  const [state, rawDispatch] = useReducer(reducer, results, initialState)
  const { fps } = results.session
  const sessionId = results.session.id

  // Log what the dancer does for the usability study. Text edits are left out on purpose.
  const dispatch = useCallback<Dispatch<StudioAction>>((action) => {
    if (!TEXT_EDITS.has(action.type) && action.type !== 'setBoundary') track(`ui.${action.type}`, studyDetail(action))
    rawDispatch(action)
  }, [])

  useAutosave(sessionId, state, dispatch)

  useEffect(() => {
    clock.setDuration(results.session.duration)
    // Open on the first hold so the skeleton and guides have something to show.
    const hold = results.attempts[0]?.phases.find((p) => p.id === 'hold')
    if (hold) clock.seek(hold.start + 0.3)
  }, [results])

  const attemptById = useCallback((id: string) => state.attempts.find((a) => a.id === id) ?? state.attempts[0], [state.attempts])

  // While comparing, playback stays inside attempt A.
  const a = attemptById(state.compare.a)
  useEffect(() => {
    clock.setLoop(state.mode === 'compare' ? { start: a.start, end: a.end } : null)
  }, [state.mode, a.start, a.end])

  const metricMap = useMemo(() => new Map(results.metrics.map((m) => [m.id, m])), [results])
  const metric = useCallback((id: MetricId) => metricMap.get(id)!, [metricMap])

  const orderedMetrics = useMemo(
    () => [metric(state.focusMetric), ...results.metrics.filter((m) => m.id !== state.focusMetric)],
    [metric, results, state.focusMetric],
  )

  const summaries = useMemo(() => {
    const map = new Map<string, PhaseSummary>()
    for (const att of state.attempts)
      for (const phase of att.phases)
        for (const m of results.metrics) map.set(`${att.id}:${phase.id}:${m.id}`, summarize(results.series[m.id], phase, m, fps))
    return map
  }, [state.attempts, results, fps])

  const summary = useCallback(
    (attemptId: string, phase: PhaseId, metricId: MetricId) => summaries.get(`${attemptId}:${phase}:${metricId}`)!,
    [summaries],
  )

  const releve = useMemo(
    () => Object.fromEntries(state.attempts.map((att) => [att.id, timeOnReleve(results.series.heelLift, att, fps)])),
    [state.attempts, results, fps],
  )

  const apply = useCallback((action: UIAction) => {
    track('companion.action', { action: action.type })
    switch (action.type) {
      case 'seek_video':
        clock.pause()
        clock.setLoop(null)
        clock.seek(action.t)
        dispatch({ type: 'setMode', mode: 'review' })
        return
      case 'focus_metric':
        dispatch({ type: 'focusMetric', metricId: action.metricId, pulse: true })
        return
      case 'open_comparison':
        dispatch({ type: 'setCompare', a: action.a, b: action.b, phase: action.phase })
        dispatch({ type: 'setMode', mode: 'compare' })
        return
      case 'add_moment_marker':
        dispatch({ type: 'addMarker', t: action.t, text: action.text, author: 'companion' })
    }
  }, [])

  const value = useMemo<StudioValue>(
    () => ({ results, state, dispatch, metric, orderedMetrics, summary, releve, attemptById, apply }),
    [results, state, metric, orderedMetrics, summary, releve, attemptById, apply],
  )
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
}

export function useStudio(): StudioValue {
  const v = useContext(StudioContext)
  if (!v) throw new Error('useStudio must be used inside StudioProvider')
  return v
}

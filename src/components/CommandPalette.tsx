// Ctrl+K: every workspace action in one searchable list, with its shortcut.

import { useEffect, useMemo, useState } from 'react'
import { useStudio } from '../state/studio'
import { clock } from '../state/clock'
import { toggleTheme } from '../state/theme'
import { navigate } from '../router'
import { track } from '../study/log'

export interface Command {
  id: string
  label: string
  group: string
  keys?: string
  run: () => void
}

export function useCommands(extra: Command[]): Command[] {
  const { results, state, dispatch } = useStudio()
  return useMemo(() => {
    const id = results.session.id
    const list: Command[] = [
      { id: 'play', group: 'Playback', label: 'Play or pause', keys: 'Space', run: clock.toggle },
      { id: 'mark', group: 'Playback', label: 'Mark this moment', keys: 'M', run: () => dispatch({ type: 'addMarker', t: clock.get().time, text: '', author: 'dancer' }) },
      ...state.attempts.map((a) => ({ id: `go-${a.id}`, group: 'Go to', label: `Attempt ${a.index}`, run: () => clock.seek(a.start) })),
      ...results.metrics.map((m) => ({ id: `focus-${m.id}`, group: 'Focus', label: `Focus on ${m.name.toLowerCase()}`, run: () => dispatch({ type: 'focusMetric', metricId: m.id, pulse: true }) })),
      { id: 'compare', group: 'View', label: state.mode === 'compare' ? 'Back to review' : 'Watch A and B side by side', run: () => dispatch({ type: 'setMode', mode: state.mode === 'compare' ? 'review' : 'compare' }) },
      { id: 'ghost', group: 'View', label: state.ghost ? 'Hide the ghost' : 'Show the ghost', run: () => dispatch({ type: 'toggleGhost' }) },
      { id: 'footage', group: 'View', label: state.footage ? 'Hide the video' : 'Show the video', run: () => dispatch({ type: 'toggleFootage' }) },
      { id: 'skeleton', group: 'View', label: state.skeleton ? 'Hide the skeleton' : 'Show the skeleton', run: () => dispatch({ type: 'toggleSkeleton' }) },
      { id: 'trails', group: 'View', label: state.trails ? 'Hide motion trails' : 'Show motion trails', run: () => dispatch({ type: 'toggleTrails' }) },
      { id: 'guides', group: 'View', label: state.guides ? 'Hide guides' : 'Show guides', run: () => dispatch({ type: 'toggleGuides' }) },
      { id: 'theme', group: 'View', label: 'Switch light / dark', run: toggleTheme },
      { id: 'companion', group: 'Session', label: state.companionOpen ? 'Close the companion' : 'Open the practice companion', run: () => dispatch({ type: 'toggleCompanion' }) },
      { id: 'reflect', group: 'Session', label: 'Finish and reflect', run: () => dispatch({ type: 'setReflectOpen', open: true }) },
      { id: 'edit', group: 'Session', label: 'Edit attempts and phases', run: () => navigate({ name: 'confirm', id }) },
      { id: 'journal', group: 'Session', label: 'Back to the journal', run: () => navigate({ name: 'journal' }) },
      ...extra,
    ]
    return list
  }, [results, state.attempts, state.mode, state.ghost, state.trails, state.footage, state.skeleton, state.guides, state.companionOpen, dispatch, extra])
}

export function CommandPalette({ commands }: { commands: Command[] }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
        setQuery('')
        setIndex(0)
        track('palette.opened')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return commands.filter((c) => words.every((w) => `${c.group} ${c.label}`.toLowerCase().includes(w)))
  }, [commands, query])

  if (!open) return null
  const run = (c: Command) => {
    setOpen(false)
    track('palette.ran', { command: c.id })
    c.run()
  }

  return (
    <div className="palette-backdrop" onPointerDown={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Command palette" onPointerDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder="Type a command… (attempt 3, compare, trails)"
          aria-label="Search commands"
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            else if (e.key === 'ArrowDown') setIndex((i) => Math.min(matches.length - 1, i + 1))
            else if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1))
            else if (e.key === 'Enter' && matches[index]) run(matches[index])
            else return
            e.preventDefault()
          }}
        />
        <ul role="listbox">
          {matches.length === 0 && <li className="palette-empty">No matching command</li>}
          {matches.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === index}>
              <button className={i === index ? 'on' : ''} onPointerEnter={() => setIndex(i)} onClick={() => run(c)}>
                <small>{c.group}</small>
                <span>{c.label}</span>
                {c.keys && <kbd>{c.keys}</kbd>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

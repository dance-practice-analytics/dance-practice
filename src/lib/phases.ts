import type { PhaseId } from '../types'

export const PHASES: { id: PhaseId; label: string; starts: string }[] = [
  { id: 'prep', label: 'Plié', starts: 'Plié begins' },
  { id: 'rise', label: 'Rise', starts: 'Heels leave the floor' },
  { id: 'hold', label: 'Hold', starts: 'Full relevé' },
  { id: 'release', label: 'Lower', starts: 'Heels start down' },
]

export const PHASE_LABEL = Object.fromEntries(PHASES.map((p) => [p.id, p.label])) as Record<PhaseId, string>

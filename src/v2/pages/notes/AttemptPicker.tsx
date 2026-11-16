// Picks the attempt a screen is about (Practice notes, Mika): processed attempts
// grouped by session. Presentational; the page navigates.

import type { AttemptView } from '../../data'
import { pickerGroups } from './model'

export interface AttemptPickerProps {
  id: string
  attempts: readonly AttemptView[]
  value: string | null
  onChange(attemptId: string): void
  label?: string
}

export function AttemptPicker({ id, attempts, value, onChange, label = 'Attempt' }: AttemptPickerProps) {
  const groups = pickerGroups(attempts)
  const known = value !== null && groups.some((g) => g.options.some((o) => o.id === value))
  return (
    <div className="field" style={{ width: '100%', maxWidth: 420 }}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="input input-sm" value={known ? value! : ''} onChange={(e) => e.target.value && onChange(e.target.value)}>
        {/* A deep link to an attempt that isn't processed has no option of its own. */}
        {!known && <option value="">Choose an attempt…</option>}
        {groups.map((g) => (
          <optgroup key={g.sessionId} label={g.label}>
            {g.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}

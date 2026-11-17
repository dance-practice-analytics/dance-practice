// "What does this mean?" on a metric or theme card: a pill that opens a short plain
// explanation in place. One component so Review, Compare and the phrase theme cards
// look and behave the same (help icon, 44 px tap target on phones, focus ring).
// Explains what is measured only; never says what a "good" value is.

import type { ReactNode } from 'react'
import { Icon } from './Icon'

export interface InfoDisclosureProps {
  /** The explanation (drawing, sentence, links). */
  children: ReactNode
  /** Pill text. */
  label?: string
  /** Names what the help is about for screen readers, e.g. 'Torso lean'. */
  about?: string
}

export function InfoDisclosure({ children, label = 'What does this mean?', about }: InfoDisclosureProps) {
  return (
    <details className="v2-metric-info">
      <summary aria-label={about ? `${label} ${about}` : undefined}>
        <Icon name="help" size={18} />
        <span>{label}</span>
        <Icon name="chevron-down" size={14} className="v2-metric-info-chev" />
      </summary>
      <div className="v2-metric-info-body">{children}</div>
    </details>
  )
}

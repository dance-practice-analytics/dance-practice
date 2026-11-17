// The unit after a big `.metric-value` number. A degree sign joins the number
// ('20.3°', same size, no space) so it reads as degrees; any other unit, or the
// words after the degree sign ('from upright'), stay the small `.metric-unit` label.

import type { CSSProperties } from 'react'
import { splitUnit } from '../format'

export function ValueUnit({ unit, style }: { unit: string | null | undefined; style?: CSSProperties }) {
  const { glyph, label } = splitUnit(unit)
  return (
    <>
      {glyph}
      {label && (
        <span className="metric-unit" style={style}>
          {label}
        </span>
      )}
    </>
  )
}

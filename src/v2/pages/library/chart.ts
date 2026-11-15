// Geometry of the small session-median charts. A missing value is a gap: no dot, and
// the line is broken on both sides of it — never bridged, never drawn at 0.

export interface ChartBox {
  left: number
  right: number
  top: number
  bottom: number
}

export interface ChartDot {
  index: number
  x: number
  /** Null = no value at this position. */
  y: number | null
}

export interface ChartLayout {
  dots: ChartDot[]
  /** `points` strings of the runs of two or more neighbouring values. */
  lines: string[]
}

const r1 = (n: number) => Number(n.toFixed(1))

export function layoutSeries(values: readonly (number | null)[], max: number | null, box: ChartBox): ChartLayout {
  const n = values.length
  const span = box.right - box.left
  const dots = values.map((v, index): ChartDot => {
    const x = n === 1 ? box.left + span / 2 : box.left + (index * span) / (n - 1)
    const y = v === null || max === null || !(max > 0) ? null : box.bottom - Math.min(1, Math.max(0, v / max)) * (box.bottom - box.top)
    return { index, x: r1(x), y: y === null ? null : r1(y) }
  })
  const lines: string[] = []
  let run: ChartDot[] = []
  const flush = () => {
    if (run.length > 1) lines.push(run.map((d) => `${d.x},${d.y}`).join(' '))
    run = []
  }
  for (const d of dots) {
    if (d.y === null) flush()
    else run.push(d)
  }
  flush()
  return { dots, lines }
}

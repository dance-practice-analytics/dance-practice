// Counts the first number in a formatted value up from zero when it first
// appears (or from the old value when it changes). Text stays the final value
// for assistive tech; only the visible digits move.

import { useEffect, useRef, useState } from 'react'

const NUM = /-?\d+(?:\.\d+)?/

export function CountUp({ value, ms = 800 }: { value: string; ms?: number }) {
  const match = value.match(NUM)
  const target = match ? Number(match[0]) : null
  const decimals = match?.[0].split('.')[1]?.length ?? 0
  const from = useRef(0)
  const [shown, setShown] = useState<number | null>(() => (target === null || matchMedia('(prefers-reduced-motion: reduce)').matches ? target : 0))

  useEffect(() => {
    if (target === null) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(target)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms)
      const eased = 1 - (1 - k) ** 3
      setShown(a + (target - a) * eased)
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])

  if (!match || shown === null) return <>{value}</>
  const i = match.index!
  return (
    <>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true">{value.slice(0, i)}{shown.toFixed(decimals)}{value.slice(i + match[0].length)}</span>
    </>
  )
}

// Decorative synthetic pose for screens that have no session yet (sign-in,
// processing). It is never presented as the dancer's data.

import { useEffect, useState } from 'react'
import type { PoseTrack } from '../mock/syntheticSession'

let cached: Promise<{ track: PoseTrack; hold: [number, number]; attempt: [number, number] }> | null = null

function load() {
  cached ??= import('../mock/syntheticSession').then(({ buildPoseTrack, plannedAttempts, DEMO_SPEC }) => {
    const a = plannedAttempts(DEMO_SPEC)[2]
    const hold = a.phases.find((p) => p.id === 'hold')!
    return { track: buildPoseTrack(DEMO_SPEC), hold: [hold.start, hold.end] as [number, number], attempt: [a.start, a.end] as [number, number] }
  })
  return cached
}

export function useDemoTrack() {
  const [value, setValue] = useState<Awaited<ReturnType<typeof load>> | null>(null)
  useEffect(() => {
    let live = true
    load().then((v) => live && setValue(v))
    return () => {
      live = false
    }
  }, [])
  return value
}

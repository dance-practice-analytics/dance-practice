// Small hooks the Library and the Dashboard share.

import { useMemo } from 'react'
import { useAuth } from '../../auth'
import { usePipeline } from '../../pipeline'
import type { LiveStatus } from './model'

/** Status of the clips in this tab's queue; the map only changes when a status does. */
export function useLiveStatus(): LiveStatus {
  const { items } = usePipeline()
  const key = items
    .filter((i) => i.status === 'queued' || i.status === 'processing')
    .map((i) => `${i.attemptId}:${i.status}`)
    .join(',')
  return useMemo(
    () => new Map(key ? key.split(',').map((e) => e.split(':') as [string, 'queued' | 'processing']) : []),
    [key],
  )
}

/** How the signed-in person is named in a header: their display name, else their role. */
export function useWho(): string {
  const { profile, role } = useAuth()
  return profile?.display_name?.trim() || role
}

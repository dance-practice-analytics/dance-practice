// One breakpoint for the whole app: under 900px the shell switches from the sidebar
// to the phone header and bottom navigation, and pages use their *Mobile design.

import { useSyncExternalStore } from 'react'

export const NARROW_QUERY = '(max-width: 899.98px)'

const media = typeof matchMedia === 'function' ? matchMedia(NARROW_QUERY) : null

const subscribe = (cb: () => void) => {
  media?.addEventListener('change', cb)
  return () => media?.removeEventListener('change', cb)
}

/** True on phone-width screens (< 900px). */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => media?.matches ?? false)
}

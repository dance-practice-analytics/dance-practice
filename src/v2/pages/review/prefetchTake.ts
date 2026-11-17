// The other cameras of the take on screen are fetched in the background (keypoints only,
// the same file Review would load), so the camera switch shows the next view at once
// instead of a loading screen. Uses the series cache that `useAttempt` reads first.

import { useEffect } from 'react'
import { downloadKeypoints } from '../../../data/repo'
import { decodeSeries } from '../../../pose/codec'
import { client } from '../../auth'
import { cacheSeries, getCachedSeries } from '../../pipeline'

const inFlight = new Set<string>()

export function usePrefetchSeries(ids: readonly string[]): void {
  const key = ids.join(',')
  useEffect(() => {
    if (!key) return
    // After the page itself has loaded what it needs.
    const timer = window.setTimeout(() => {
      for (const id of key.split(',')) {
        if (inFlight.has(id) || getCachedSeries(id)) continue
        inFlight.add(id)
        downloadKeypoints(client(), id)
          .then(decodeSeries)
          .then((series) => cacheSeries(id, series))
          .catch(() => undefined) // Review loads it again (and explains a failure) if it is opened.
          .finally(() => inFlight.delete(id))
      }
    }, 800)
    return () => window.clearTimeout(timer)
  }, [key])
}

// Retires the service worker the app registered at the site root before it moved to /app/
// (Vercel deploys of 2026-11-16). Browsers that still have that registration fetch /sw.js
// on their next visit, install this file, and it removes itself. It drops cached copies of
// files outside /app/ and leaves the app's own worker (scope /app/) and its files alone.
// Nothing registers this file; it only exists for those old registrations.
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const appPrefix = new URL('/app/', self.location.origin).href
      try {
        for (const name of await caches.keys()) {
          if (!name.startsWith('dpa-')) continue
          const cache = await caches.open(name)
          for (const request of await cache.keys()) {
            if (!request.url.startsWith(appPrefix)) await cache.delete(request)
          }
        }
      } catch {
        // no cache storage: nothing to clean
      }
      await self.registration.unregister()
    })(),
  )
})

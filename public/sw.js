// Service worker for the installable web app (FR-3.8.2, FR-3.8.6). Hand-written, no build step.
//
// What it caches (same origin, inside its scope, GET only):
//   shell   index.html, manifest, icons          precached on install, navigations are network-first
//   assets  hashed build files in assets/        precached on install (found by following the
//                                                references from index.html) and cache-first after
//   pose    MediaPipe WASM runtime + .task model cache-first, stored the first time they are used
//
// What it never touches: Supabase (or any other origin), requests with an Authorization
// header, anything that is not a GET, and video/audio. Study clips are blob: URLs of local
// files and never reach a service worker at all (NFR-1).
//
// Updating: a new worker waits until every tab is closed, or until the page sends
// { type: 'SKIP_WAITING' }. It never takes over on its own, so an update cannot swap
// files under a session that is processing clips.

// Bump VERSION to throw away the shell and the hashed assets (the deploy workflow appends
// the commit to it, so every deploy is a new version). Bump POSE_VERSION only when
// @mediapipe/tasks-vision or the model file changes: it forces a ~25 MB download.
const VERSION = 'v1'
const POSE_VERSION = 'v1'

const PREFIX = 'dpa-'
const SHELL = `${PREFIX}shell-${VERSION}`
const ASSETS = `${PREFIX}assets-${VERSION}`
const POSE = `${PREFIX}pose-${POSE_VERSION}`

/** The folder this file is served from, e.g. https://host/dance-practice/ */
const SCOPE = new URL('./', self.location.href).href
const SHELL_FILES = [
  'manifest.webmanifest',
  'favicon.svg',
  'register-sw.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
]
const NAVIGATION_TIMEOUT_MS = 5000
const MEDIA = /\.(mp4|m4v|mov|webm|mkv|avi|mp3|wav|ogg)$/i
const CRAWLABLE = /\.(js|css)$/
const REFERENCE = /["'`(]([\w@.\/-]+\.(?:js|css|woff2))["'`)]/g

const isSupabase = (url) => /(^|\.)supabase\.(co|in|net)$/.test(url.hostname)

const isMedia = (request, url) =>
  ['video', 'audio', 'track'].includes(request.destination) || MEDIA.test(url.pathname) || url.href.startsWith(`${SCOPE}clips/`)

/** Which cache a URL belongs to, or null when it must not be cached. */
function cacheNameFor(url) {
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE) || url.search) return null
  const path = url.href.slice(SCOPE.length)
  if (path.startsWith('mediapipe/')) return POSE
  if (path.startsWith('assets/')) return /\.wasm$|vision_wasm_internal/.test(path) ? POSE : ASSETS
  if (SHELL_FILES.includes(path)) return SHELL
  return null
}

/** Full, same-origin, successful responses only. A missing file answered with the SPA page is not an asset. */
const storable = (response) =>
  response.status === 200 && response.type === 'basic' && !(response.headers.get('content-type') ?? '').includes('text/html')

async function store(cacheName, url, response) {
  try {
    const cache = await caches.open(cacheName)
    await cache.put(url, response)
  } catch {
    // Quota exceeded, storage disabled, or the download was cut short: stay uncached.
  }
}

// ---- install: precache the shell and the build's JS/CSS/fonts ----

function references(text, from) {
  const found = []
  for (const [, ref] of text.matchAll(REFERENCE)) {
    try {
      // Vite lists lazy chunks as "assets/name-hash.js" (relative to the base) and
      // imports between chunks as "./name-hash.js" (relative to the importing file).
      const url = new URL(ref, ref.startsWith('assets/') ? SCOPE : from).href
      if (url.startsWith(`${SCOPE}assets/`)) found.push(url)
    } catch {
      // not a URL
    }
  }
  return found
}

async function precache() {
  const response = await fetch(SCOPE, { cache: 'reload' })
  if (!response.ok) throw new Error(`Shell request failed: HTTP ${response.status}`)
  const html = await response.clone().text()
  const shell = await caches.open(SHELL)
  await shell.put(SCOPE, response)

  await Promise.all(
    SHELL_FILES.map(async (file) => {
      try {
        const res = await fetch(SCOPE + file, { cache: 'reload' })
        if (storable(res)) await shell.put(SCOPE + file, res)
      } catch {
        // optional: fetched again on first use
      }
    }),
  )

  const seen = new Set()
  let level = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(([, ref]) => new URL(ref, SCOPE).href)
    .filter((url) => url.startsWith(`${SCOPE}assets/`))
  while (level.length) {
    const next = await Promise.all(
      level
        .filter((url) => !seen.has(url) && seen.add(url))
        .map(async (url) => {
          const cacheName = cacheNameFor(new URL(url))
          if (!cacheName) return []
          try {
            // Hashed names never change, so a copy from the previous version is reused.
            const res = (await caches.match(url)) ?? (await fetch(url))
            if (!storable(res)) return []
            const text = CRAWLABLE.test(url) && cacheName === ASSETS ? await res.clone().text() : ''
            await store(cacheName, url, res)
            return references(text, url)
          } catch {
            return [] // offline halfway, or a string that only looked like a file name
          }
        }),
    )
    level = next.flat()
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS, POSE])
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name.startsWith(PREFIX) && !keep.has(name)).map((name) => caches.delete(name)))
      // Only matters on the first install: an update gets here after SKIP_WAITING or
      // once no tab is open.
      await self.clients.claim()
    })(),
  )
})

// ---- fetch ----

/** Answers a Range request from a complete cached copy; null when the header is unusable. */
async function slice(cached, header) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (!match[1] && !match[2])) return null
  const blob = await cached.blob()
  const size = blob.size
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': cached.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  })
}

async function cacheFirst(event, cacheName) {
  const { request } = event
  const range = request.headers.get('range')
  let cached
  try {
    cached = await (await caches.open(cacheName)).match(request.url)
  } catch {
    // no cache storage: behave like the network
  }
  if (range) return (cached && (await slice(cached, range))) || fetch(request) // partial responses are never stored
  if (cached) return cached
  const response = await fetch(request)
  // The copy is written while the page reads its own, so large files are not held in memory.
  if (storable(response)) event.waitUntil(store(cacheName, request.url, response.clone()))
  return response
}

async function navigate(event) {
  const { request } = event
  const url = new URL(request.url)
  const isShell = !url.search && (url.href.split('#')[0] === SCOPE || url.href.split('#')[0] === `${SCOPE}index.html`)
  let cached
  try {
    cached = await (await caches.open(SHELL)).match(SCOPE)
  } catch {
    // no cache storage
  }
  try {
    const network = fetch(request)
    // With a copy to fall back on, a connection that hangs does not block the app.
    const response = cached
      ? await Promise.race([
          network,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAVIGATION_TIMEOUT_MS)),
        ])
      : await network
    if (response.ok && isShell && !response.redirected && response.type === 'basic') {
      event.waitUntil(store(SHELL, SCOPE, response.clone()))
    }
    if (!response.ok && response.status >= 500 && cached) return cached
    return response
  } catch (error) {
    if (cached) return cached
    throw error
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return
  if (isSupabase(url) || url.origin !== self.location.origin) return
  if (request.headers.has('authorization')) return
  if (!url.href.startsWith(SCOPE) || isMedia(request, url)) return

  if (request.mode === 'navigate') {
    event.respondWith(navigate(event))
    return
  }
  const cacheName = cacheNameFor(url)
  if (cacheName) event.respondWith(cacheFirst(event, cacheName))
  // Everything else goes to the network untouched.
})

// ---- messages from the page (public/register-sw.js) ----

/** Stores files the page loaded before this worker controlled it (first visit). */
async function warm(urls) {
  for (const href of urls.slice(0, 400)) {
    try {
      const url = new URL(href)
      const cacheName = cacheNameFor(url)
      if (!cacheName || MEDIA.test(url.pathname) || (await caches.match(url.href))) continue
      const response = await fetch(url.href)
      if (storable(response)) await store(cacheName, url.href, response)
    } catch {
      // skip
    }
  }
}

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.type === 'SKIP_WAITING') self.skipWaiting()
  if (data.type === 'WARM' && Array.isArray(data.urls)) event.waitUntil(warm(data.urls.filter((u) => typeof u === 'string')))
})

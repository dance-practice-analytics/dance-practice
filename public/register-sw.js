// Registers public/sw.js for the deployed web app. Loaded by a plain <script> in index.html.
//
// It does nothing on localhost, on the Vite dev server or inside the Capacitor shell, so
// development and the Playwright tests never get a service worker. To try it against a
// local production build (vite preview), run this in the console and reload:
//   localStorage.setItem('dpa:sw', 'on')
//
// When a new version has been downloaded and is waiting, the window gets a
// 'dpa:update-ready' event (also kept in window.dpaUpdate for listeners added later):
//   window.addEventListener('dpa:update-ready', (e) => showToast('Update ready', e.detail.apply))
// detail.apply() activates the new version and reloads the page. Nothing reloads on its own.
;(() => {
  const script = document.currentScript
  if (!script || !('serviceWorker' in navigator) || !window.isSecureContext) return

  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  let forced = false
  try {
    forced = localStorage.getItem('dpa:sw') === 'on'
  } catch {
    // storage blocked
  }
  const dev = !!document.querySelector('script[src*="/@vite/client"]')
  if (dev || window.Capacitor || (local && !forced)) return

  // Both URLs are relative to this file, so the app works from any sub-path.
  const swUrl = new URL('./sw.js', script.src)
  const scope = new URL('./', script.src).pathname
  const firstVisit = !navigator.serviceWorker.controller

  const announce = (registration, worker) => {
    const detail = {
      registration,
      apply() {
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
        worker.postMessage({ type: 'SKIP_WAITING' })
      },
    }
    window.dpaUpdate = detail
    window.dispatchEvent(new CustomEvent('dpa:update-ready', { detail }))
  }

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register(swUrl, { scope })
      // An update is only "ready" when an older version is controlling this page.
      if (registration.waiting && navigator.serviceWorker.controller) announce(registration, registration.waiting)
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing
        if (!worker) return
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) announce(registration, worker)
        })
      })
      if (firstVisit) {
        // This page loaded its files before the worker existed; hand it the list so a
        // reload works offline straight away.
        const { active } = await navigator.serviceWorker.ready
        const urls = performance.getEntriesByType('resource').map((entry) => entry.name)
        if (active) active.postMessage({ type: 'WARM', urls })
      }
    } catch (error) {
      console.warn('Service worker registration failed', error)
    }
  }

  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
})()

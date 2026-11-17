import type { CapacitorConfig } from '@capacitor/cli'

// Android shell for the v2 app (FR-3.8.x). The WebView serves the built web app from
// https://localhost, an origin the Edge Functions' CORS list already allows.
// Build with `npm run android:build` (debug APK only; no release key in this repo).
const config: CapacitorConfig = {
  appId: 'edu.kennesaw.dancepractice',
  appName: 'Dance Practice',
  webDir: 'dist',
  // Debug builds can be inspected from chrome://inspect (Capacitor's default).
  server: { androidScheme: 'https' },
}

export default config

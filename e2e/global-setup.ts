// The test clips are generated, not committed (*.mp4 is git-ignored as an NDA guard).
// Make them once if they're missing, so the video tests have something to play.

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'

export default function globalSetup() {
  if (!existsSync('public/clips/7310-1.mp4')) {
    console.log('Generating synthetic test clips (npm run clips)…')
    execSync('npm run clips', { stdio: 'inherit' })
  }
}

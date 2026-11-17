// Builds the Android debug APK (FR-3.8.x): web build with base '/', drop the synthetic
// test clips, `cap sync android`, `gradlew assembleDebug`, then stop the Gradle daemon so
// it doesn't keep ~2 GB of memory. Needs JDK 21 (JAVA_HOME) and the Android SDK
// (ANDROID_HOME or android/local.properties). Never signs with a release key.
//   node scripts/android-build.mjs            build + sync + APK
//   node scripts/android-build.mjs --sync     build + sync only (no Gradle)
import { spawnSync } from 'node:child_process'
import { rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const win = process.platform === 'win32'
const syncOnly = process.argv.includes('--sync')

function run(cmd, args, cwd = root) {
  console.log(`> ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: win })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// '--base /' wins over a BASE_PATH left in the shell (the Vercel build uses /app/).
run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'])
run('npx', ['vite', 'build', '--base', '/'])
// public/clips holds generated synthetic test clips (git-ignored); they don't belong in the APK.
rmSync(join(root, 'dist', 'clips'), { recursive: true, force: true })
run('npx', ['cap', 'sync', 'android'])
if (syncOnly) process.exit(0)

const android = join(root, 'android')
// Absolute path: cmd may not search the current folder (NoDefaultCurrentDirectoryInExePath).
const gradlew = `"${join(android, win ? 'gradlew.bat' : 'gradlew')}"`
console.log('> gradlew assembleDebug')
const build = spawnSync(gradlew, ['assembleDebug'], { cwd: android, stdio: 'inherit', shell: win })
spawnSync(gradlew, ['--stop'], { cwd: android, stdio: 'inherit', shell: win })
const failed = build.status === 0 ? 0 : 1
const apk = join(android, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
const size = statSync(apk, { throwIfNoEntry: false })?.size
if (size) console.log(`APK: ${apk} (${(size / 1048576).toFixed(1)} MB)`)
process.exit(failed)

// Builds and publishes the project site and the web app on one Vercel domain:
//   https://dance-practice-teal.vercel.app/      landing page (site/)
//   https://dance-practice-teal.vercel.app/app/  the app (dist/, built with BASE_PATH=/app/)
//
//   node scripts/deploy-vercel.mjs              build, assemble, scan, deploy to production
//   node scripts/deploy-vercel.mjs --dry-run    build, assemble and scan only
//   node scripts/deploy-vercel.mjs --skip-build reuse dist/ (must have been built with /app/)
//   node scripts/deploy-vercel.mjs --out <dir>  deploy folder (default: <tmp>/dance-practice-deploy/dance-practice)
//
// The Vercel project is not connected to GitHub. The project link (.vercel/project.json)
// is taken from the deploy folder if it already has one, else from .vercel/ in the repo
// (git-ignored), else from --link <dir>. Run `npx vercel link` once to create it.
// The deploy folder is outside the repo; dist/clips (synthetic e2e clips) is left out.

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const BASE = '/app/'
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const OUT = resolve(option('--out') ?? join(tmpdir(), 'dance-practice-deploy', 'dance-practice'))
const DIST = join(ROOT, 'dist')
const SITE = join(ROOT, 'site')

function run(command, extraEnv = {}) {
  console.log(`> ${command}`)
  const result = spawnSync(command, { cwd: ROOT, stdio: 'inherit', shell: true, env: { ...process.env, ...extraEnv } })
  if (result.status !== 0) throw new Error(`Failed (${result.status}): ${command}`)
}

function git(command) {
  const result = spawnSync(`git ${command}`, { cwd: ROOT, shell: true, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}

if (relative(ROOT, OUT) === '' || !relative(ROOT, OUT).startsWith('..')) {
  throw new Error(`The deploy folder must be outside the repository: ${OUT}`)
}

// 1. Build the app under /app/.
if (!flag('--skip-build')) run('npm run build', { BASE_PATH: BASE })
const html = readFileSync(join(DIST, 'index.html'), 'utf8')
if (!html.includes(`src="${BASE}assets/`)) throw new Error(`dist/ was not built with BASE_PATH=${BASE}`)
const bundle = files(join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8')).join('\n')
if (!/https:\/\/[a-z0-9]+\.supabase\.co/.test(bundle)) {
  throw new Error('The build has no Supabase URL (it would start the mock prototype). Check VITE_SUPABASE_URL in .env.local.')
}

// 2. Assemble: site/ at the root, dist/ under app/, keeping an existing project link.
const linkSources = [join(OUT, '.vercel'), join(ROOT, '.vercel'), option('--link') && join(resolve(option('--link')), '.vercel')].filter(Boolean)
const link = linkSources.find((dir) => existsSync(join(dir, 'project.json')))
const linkJson = link ? readFileSync(join(link, 'project.json'), 'utf8') : null
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
cpSync(SITE, OUT, { recursive: true })
cpSync(DIST, join(OUT, 'app'), { recursive: true, filter: (src) => relative(DIST, src).split(/[\\/]/)[0] !== 'clips' })
if (linkJson) {
  mkdirSync(join(OUT, '.vercel'), { recursive: true })
  writeFileSync(join(OUT, '.vercel', 'project.json'), linkJson)
}

// Every deploy is a new service worker version, so clients drop the previous shell.
const stamp = `${git('rev-parse --short HEAD') || 'local'}${git('status --porcelain') ? '-dirty' : ''}-${Date.now().toString(36)}`
const swPath = join(OUT, 'app', 'sw.js')
const sw = readFileSync(swPath, 'utf8')
const stamped = sw.replace(/^const VERSION = '([^']*)'/m, `const VERSION = '$1-${stamp}'`)
if (stamped === sw) throw new Error('Could not stamp VERSION in app/sw.js')
writeFileSync(swPath, stamped)

// 3. Scan everything that will be published for secrets.
const env = existsSync(join(ROOT, '.env.local')) ? readFileSync(join(ROOT, '.env.local'), 'utf8') : ''
const privateValues = [...env.matchAll(/^\s*(?!VITE_)([A-Z0-9_]+)\s*=\s*(.+?)\s*$/gm)]
  .map(([, , value]) => value.replace(/^["']|["']$/g, ''))
  .filter((value) => value.length >= 8)
const PATTERNS = [/sk-[A-Za-z0-9_-]{20,}/, /sb_secret_[A-Za-z0-9_-]{10,}/, /service_role/, /TEST_ACCOUNT/, /LLM_API_KEY\s*[=:]\s*\S/]
const findings = []
for (const file of files(OUT)) {
  const rel = relative(OUT, file)
  if (rel.startsWith('.vercel') || /\.(png|task|wasm|svg|ico|webp|jpg)$/i.test(file)) continue
  const text = readFileSync(file, 'utf8')
  for (const pattern of PATTERNS) if (pattern.test(text)) findings.push(`${rel}: ${pattern}`)
  for (const value of privateValues) if (text.includes(value)) findings.push(`${rel}: a non-VITE value from .env.local`)
}
if (findings.length) {
  console.error('Secret scan failed:\n  ' + findings.join('\n  '))
  process.exit(1)
}
const size = files(OUT).reduce((sum, f) => sum + statSync(f).size, 0)
console.log(`Assembled ${OUT} (${(size / 1048576).toFixed(1)} MB, sw ${stamp}); secret scan clean.`)

// 4. Deploy.
if (flag('--dry-run')) {
  console.log('Dry run: not deployed.')
} else {
  if (!linkJson) throw new Error('No Vercel project link found. Run `npx vercel link` in the repo or pass --link <dir>.')
  run(`npx --yes vercel@latest deploy "${OUT}" --prod --yes`)
}

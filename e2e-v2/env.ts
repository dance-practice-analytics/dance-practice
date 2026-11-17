// Reads .env.local (and the process env) for the v2 smoke tests. The test account's
// credentials stay in memory: never log them, never put them in a test title.

import { loadEnv } from 'vite'

export type LocalEnv = Record<string, string>

export function readLocalEnv(): LocalEnv {
  // '' prefix: also the non-VITE_ keys (TEST_ACCOUNT_*). The process env wins.
  return loadEnv('production', process.cwd(), '')
}

export function hasTestAccount(env: LocalEnv = readLocalEnv()): boolean {
  return Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY && env.TEST_ACCOUNT_EMAIL && env.TEST_ACCOUNT_PASSWORD)
}

export function testAccount(env: LocalEnv = readLocalEnv()): { email: string; password: string } {
  return { email: env.TEST_ACCOUNT_EMAIL ?? '', password: env.TEST_ACCOUNT_PASSWORD ?? '' }
}

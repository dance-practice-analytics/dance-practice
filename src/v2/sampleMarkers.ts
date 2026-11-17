// How the first-run sample session (sample.ts) is recognised in the library. The schema
// has no sample flag, so the session title and the attempt label carry it. Kept apart
// from sample.ts so screens can check it without loading the synthetic generator.

export const SAMPLE_SESSION_TITLE = 'Sample session (synthetic)'
export const SAMPLE_ATTEMPT_LABEL = 'Sample (synthetic)'
export const SAMPLE_MODEL = 'synthetic-sample'

/** True for attempts created by the sample button. */
export function isSampleAttempt(a: { label?: string | null }): boolean {
  return a.label === SAMPLE_ATTEMPT_LABEL
}

/** True for the sample session. */
export function isSampleSession(s: { title?: string | null }): boolean {
  return s.title === SAMPLE_SESSION_TITLE
}

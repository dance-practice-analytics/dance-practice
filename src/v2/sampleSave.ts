// Saves the first-run sample session (sample.ts) for the signed-in account through the
// normal repo layer, the same rows a processed clip gets: session → attempts (source
// study_dataset, so the study_no_video CHECK holds; no subject) → keypoints → metrics
// → status done. It can be deleted with the normal delete flow. No video exists.

import { createSession, createStudyAttempts, deleteSession, saveMetrics, setAttemptStatus, uploadKeypoints } from '../data/repo'
import { encodeSeries } from '../pose/codec'
import { client } from './auth'
import { invalidate } from './data'
import { cacheSeries } from './pipeline'
import { buildSampleAttempts } from './sample'
import { SAMPLE_SESSION_TITLE } from './sampleMarkers'

/** Each attempt row needs a unique 64-hex video_sha256; no file exists, so it is random. */
function randomSha(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Creates the sample session; returns the first attempt id. Throws a dancer-safe ApiError. */
export async function createSampleSession(): Promise<string> {
  const db = client()
  const samples = buildSampleAttempts()
  const session = await createSession(db, {
    movement_type: 'releve_balance',
    subject_id: null,
    title: SAMPLE_SESSION_TITLE,
    recorded_on: today(),
    camera_view: 'front',
  })
  try {
    const results = await createStudyAttempts(
      db,
      session.id,
      samples.map((s) => ({
        clip_name: s.clipName,
        label: s.label,
        video_sha256: randomSha(),
        duration_s: s.series.durationS,
        fps: s.series.fps,
      })),
    )
    const ids: string[] = []
    for (let i = 0; i < samples.length; i++) {
      const r = results[i]
      if (r.outcome !== 'created') throw r.error
      const { series, metrics } = samples[i]
      const id = r.attempt.id
      await uploadKeypoints(db, id, await encodeSeries(series), series.frames.length, series.model)
      cacheSeries(id, series)
      const { movement, algorithm_version, phases, confidence, ...values } = metrics
      await saveMetrics(db, id, { movement, algorithm_version, phases, confidence, ...values })
      await setAttemptStatus(db, id, 'done')
      ids.push(id)
    }
    return ids[0]
  } catch (e) {
    // Half a sample is worse than none: remove what was saved.
    await deleteSession(db, session.id).catch(() => undefined)
    throw e
  } finally {
    invalidate()
  }
}

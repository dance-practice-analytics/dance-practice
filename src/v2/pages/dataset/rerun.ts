// "Re-run metrics": computes an attempt's metrics again from the keypoints that are
// already saved (no video needed) and replaces its metrics row. Same steps as the end
// of the pipeline in ../../pipeline.ts.

import { downloadKeypoints, saveMetrics } from '../../../data/repo'
import { computeMetrics } from '../../../metrics/engine'
import { decodeSeries } from '../../../pose/codec'
import { client } from '../../auth'
import type { AttemptView } from '../../data'
import { getCachedSeries } from '../../pipeline'

export async function rerunMetrics(attempt: AttemptView): Promise<void> {
  const db = client()
  const series = getCachedSeries(attempt.id) ?? (await decodeSeries(await downloadKeypoints(db, attempt.id)))
  const { movement, algorithm_version, phases, confidence, ...values } = computeMetrics(series, attempt.session.movement_type)
  await saveMetrics(db, attempt.id, { movement, algorithm_version, phases, confidence, ...values })
}

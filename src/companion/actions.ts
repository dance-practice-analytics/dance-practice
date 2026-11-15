// UI actions the practice companion may ask the dashboard to perform.
// In the real build these are Claude tool calls relayed by the DAD server;
// the names match the tools the backend will declare.

import type { MetricId, PhaseId, Seconds } from '../types'

export type UIAction =
  | { type: 'seek_video'; t: Seconds }
  | { type: 'focus_metric'; metricId: MetricId }
  | { type: 'open_comparison'; a: string; b: string; phase?: PhaseId }
  | { type: 'add_moment_marker'; t: Seconds; text: string }

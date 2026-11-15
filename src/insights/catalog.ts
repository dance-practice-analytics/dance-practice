// Metric catalogue for the derived numbers (NFR-12). Self-contained on purpose;
// `src/v2/format.ts` holds a similar catalogue and the two should be merged.
// Nothing here grades: labels, units and what is measured, never what is desirable.

import type { MovementType } from '../data/schema'
import type { MetricKey } from '../metrics/types'

export interface MetricInfo {
  /** Column of `attempt_metrics`. */
  key: MetricKey
  label: string
  /** Long unit for a card, e.g. '° from vertical'. */
  unit: string
  /** Compact unit appended to a number, e.g. '°', ' s', '' (ratio). */
  unitShort: string
  decimals: number
  /** Movements the metric applies to. */
  movements: readonly MovementType[]
  /** One neutral sentence: what is measured. */
  description: string
  /** Direction words for a smaller / larger number. */
  lessWord: string
  moreWord: string
}

export const MOVEMENTS: readonly MovementType[] = ['releve_balance', 'pirouette']

export const METRIC_CATALOG: Record<MetricKey, MetricInfo> = {
  trunk_inclination_deg: {
    key: 'trunk_inclination_deg',
    label: 'Trunk inclination',
    unit: '° from vertical',
    unitShort: '°',
    decimals: 1,
    movements: MOVEMENTS,
    description: 'Angle between the hip-to-shoulder line and vertical, averaged over the phase.',
    lessWord: 'lower',
    moreWord: 'higher',
  },
  pelvis_ankle_offset_norm: {
    key: 'pelvis_ankle_offset_norm',
    label: 'Pelvis–ankle offset',
    unit: '× leg length',
    unitShort: '',
    decimals: 2,
    movements: MOVEMENTS,
    description: 'Horizontal distance from the pelvis to the supporting ankle, as a share of leg length. 0 = pelvis over ankle.',
    lessWord: 'smaller',
    moreWord: 'larger',
  },
  balance_duration_s: {
    key: 'balance_duration_s',
    label: 'Balance duration',
    unit: 's',
    unitShort: ' s',
    decimals: 1,
    movements: MOVEMENTS,
    description: 'Time on relevé with the pelvis steady over the supporting foot.',
    lessWord: 'shorter',
    moreWord: 'longer',
  },
  knee_tracking_dev_deg: {
    key: 'knee_tracking_dev_deg',
    label: 'Knee tracking deviation',
    unit: '°',
    unitShort: '°',
    decimals: 1,
    movements: MOVEMENTS,
    description: 'Angle between the direction the knee bends and the direction the foot points, in plié.',
    lessWord: 'lower',
    moreWord: 'higher',
  },
  turn_count: {
    key: 'turn_count',
    label: 'Turn count',
    unit: 'turns',
    unitShort: ' turns',
    decimals: 2,
    movements: ['pirouette'],
    description: 'Rotation of the shoulders during the turn, in quarter-turn steps.',
    lessWord: 'lower',
    moreWord: 'higher',
  },
}

export const METRIC_KEYS = Object.keys(METRIC_CATALOG) as MetricKey[]

/** Metric keys that apply to a movement, in display order. */
export function metricsForMovement(movement: MovementType): MetricKey[] {
  return METRIC_KEYS.filter((k) => METRIC_CATALOG[k].movements.includes(movement))
}

/** The dash for a value that is not available. Never 0. */
export const NO_VALUE = '—'

/** Value rounded to the metric's decimals (the number the screen shows); never -0. */
export function roundValue(key: MetricKey, value: number): number {
  const r = Number(value.toFixed(METRIC_CATALOG[key].decimals))
  return r === 0 ? 0 : r
}

/** '4.2°', '3.4 s', '0.06', '1.25 turns'; null → '—'. */
export function formatValue(key: MetricKey, value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return NO_VALUE
  const info = METRIC_CATALOG[key]
  return `${roundValue(key, value).toFixed(info.decimals)}${info.unitShort}`
}

/** Signed difference for a table cell: '−2.1°', '+0.4 s', '0.0°'; null → '—'. */
export function formatDifference(key: MetricKey, difference: number | null | undefined): string {
  if (typeof difference !== 'number' || !Number.isFinite(difference)) return NO_VALUE
  const r = roundValue(key, difference)
  const sign = r < 0 ? '−' : r > 0 ? '+' : ''
  return `${sign}${formatValue(key, Math.abs(r))}`
}

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
  /** Compact unit appended to a number, e.g. '°', ' s', '%'. */
  unitShort: string
  /** Rounding of the stored value; comparisons use this rounded value. */
  decimals: number
  /**
   * The screen shows `value × scale` with `displayDecimals` (e.g. a ratio of leg length
   * as a percent: 0.16 → '16%'). Exports keep the stored value and its technical unit.
   */
  scale: number
  displayDecimals: number
  /** Movements the metric applies to. */
  movements: readonly MovementType[]
  /** One neutral sentence: what is measured. */
  description: string
  /** Direction words for a smaller / larger number. */
  lessWord: string
  moreWord: string
}

export const MOVEMENTS: readonly MovementType[] = ['releve_balance', 'pirouette']

// Names and units are written for dancers, in the words of a dance class; the technical
// names (SRS, SDD, CSV export) are the keys. Every sentence describes, none judges.
export const METRIC_CATALOG: Record<MetricKey, MetricInfo> = {
  trunk_inclination_deg: {
    key: 'trunk_inclination_deg',
    label: 'Torso lean',
    unit: '° from upright',
    unitShort: '°',
    decimals: 1,
    scale: 1,
    displayDecimals: 1,
    movements: MOVEMENTS,
    description: 'How far your torso tips away from straight up, from the hips to the shoulders. 0° is fully upright.',
    lessWord: 'less lean',
    moreWord: 'more lean',
  },
  pelvis_ankle_offset_norm: {
    key: 'pelvis_ankle_offset_norm',
    label: 'Hips over your foot',
    unit: '% of leg length to the side',
    unitShort: '%',
    decimals: 2,
    scale: 100,
    displayDecimals: 0,
    movements: MOVEMENTS,
    description: 'How far your hips sit to the side of your supporting foot, as a share of your leg length. 0% is hips right over the foot.',
    lessWord: 'closer over the foot',
    moreWord: 'further to the side',
  },
  balance_duration_s: {
    key: 'balance_duration_s',
    label: 'Time on relevé',
    unit: 's holding the balance',
    unitShort: ' s',
    decimals: 1,
    scale: 1,
    displayDecimals: 1,
    movements: MOVEMENTS,
    description: 'How long you stayed up on relevé with your hips steady over the supporting foot.',
    lessWord: 'shorter',
    moreWord: 'longer',
  },
  knee_tracking_dev_deg: {
    key: 'knee_tracking_dev_deg',
    label: 'Knee over toes',
    unit: '° between knee and toes',
    unitShort: '°',
    decimals: 1,
    scale: 1,
    displayDecimals: 1,
    movements: MOVEMENTS,
    description: 'In plié, the angle between where your knee points and where your toes point. 0° is the knee right over the toes.',
    lessWord: 'smaller',
    moreWord: 'larger',
  },
  turn_count: {
    key: 'turn_count',
    label: 'Turns',
    unit: 'turns',
    unitShort: ' turns',
    decimals: 2,
    scale: 1,
    displayDecimals: 2,
    movements: ['pirouette'],
    description: 'How far your shoulders turned around, counted in quarter turns.',
    lessWord: 'fewer',
    moreWord: 'more',
  },
  feet_angle_deg: {
    key: 'feet_angle_deg',
    label: 'Parallel feet',
    unit: '° between the feet',
    unitShort: '°',
    decimals: 1,
    scale: 1,
    displayDecimals: 1,
    movements: ['releve_balance'],
    description:
      'On relevé, the angle between where your two feet point, seen from above. 0° is parallel; a positive value means the toes point apart, a negative value that they point towards each other.',
    lessWord: 'toes more towards each other',
    moreWord: 'toes more apart',
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

/** The number the screen shows: the rounded value in display units (a ratio as a percent). */
export function displayValue(key: MetricKey, value: number): number {
  const info = METRIC_CATALOG[key]
  const r = Number((roundValue(key, value) * info.scale).toFixed(info.displayDecimals))
  return r === 0 ? 0 : r
}

/** '4.2°', '3.4 s', '16%', '1.25 turns'; null → '—'. */
export function formatValue(key: MetricKey, value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return NO_VALUE
  const info = METRIC_CATALOG[key]
  return `${displayValue(key, value).toFixed(info.displayDecimals)}${info.unitShort}`
}

/** Signed difference for a table cell: '−2.1°', '+0.4 s', '0.0°'; null → '—'. */
export function formatDifference(key: MetricKey, difference: number | null | undefined): string {
  if (typeof difference !== 'number' || !Number.isFinite(difference)) return NO_VALUE
  const r = roundValue(key, difference)
  const sign = r < 0 ? '−' : r > 0 ? '+' : ''
  return `${sign}${formatValue(key, Math.abs(r))}`
}

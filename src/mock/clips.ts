// Synthetic test clips in public/clips, one per pose track the mock serves.
// Regenerate with `npm run clips` after changing the synthetic pose or footage.

import { DEMO_SPEC } from './syntheticSession'

/** Every new mock session uses this track, so it plays with the sample clip and a study run is repeatable. */
export const SAMPLE_SEED = 7310

export const CLIP_TRACKS: { seed: number; variation: number }[] = [
  { seed: 1014, variation: 1 },
  { seed: 1017, variation: 1 },
  { seed: 1021, variation: 1 },
  { seed: 1024, variation: 1 },
  { seed: DEMO_SPEC.seed, variation: DEMO_SPEC.variation },
  { seed: SAMPLE_SEED, variation: 1 },
]

export const CLIP_SIZE = { width: 540, height: 960 }

export const clipName = (seed: number, variation: number) => `${seed}-${variation}.mp4`

export function clipUrl(seed: number, variation: number): string | null {
  return CLIP_TRACKS.some((c) => c.seed === seed && c.variation === variation) ? `${import.meta.env.BASE_URL}clips/${clipName(seed, variation)}` : null
}

# Metrics engine calibration (mt2-metrics-1.2.0)

Date: 2026-11-15. Scope: measurement accuracy of the metrics engine (`src/metrics`) and the
pose steps that feed it (`src/pose`), on **synthetic data only**. No real footage, study clip,
participant row or interview content was opened, read or processed.

> **IRB / evaluation note.** This is a measurement-accuracy evaluation. It is kept separate
> from the usability evaluation (study log, `src/study/`) and uses no participant data. The
> accuracy targets of SDD 9.2 (balance duration within 0.2 s, trunk inclination within 5°,
> correct turn count) can only be confirmed on real footage under the approved protocol: one
> clip per dancer checked by hand, frame by frame. Nothing here replaces that check.

## Method

Three layers, each with a known answer:

1. **Exact geometry** (`calibration.test.ts`, "exact geometry"). A 3D synthetic dancer
   (`testing/syntheticDancer.ts`) places the world landmarks with exact geometry: trunk at
   0/5/10/20° in any direction, pelvis 0–0.2 leg lengths from the supporting ankle in any
   direction, legs exactly 0.9 m (2-link IK), plié with the knee 0–20° off the foot, 0.5–3
   turns. No noise, no smoothing. Any error beyond rounding is a formula bug.
2. **Tracker-like noise** (`calibration.test.ts`, "tracker-like noise"). The same dancer
   degraded like MediaPipe output, then run through the app's own `smoothSeries`, 12 seeded
   runs per case in the tests, 20 in the sweep below. The noise model is measured, not
   tuned to pass: on 15 still stretches (3–6 s) of real MediaPipe output of the synthetic
   clips, heel − toe height std 3–5 mm (mostly white), heel height 9 mm (white ~5, drift
   ~8 mm shared by the foot), ankle depth 19 mm (white ~11, drift ~15 mm), shoulder x white
   1–2 mm, foot visibility 0.3–0.7. Dropped frames (1% of frames start a 1–4 frame gap) and
   left/right swaps near edge-on are added on top, deliberately pessimistic.
3. **End to end** (`scripts/calibrate-metrics.mjs`, `testing/clipTruth.ts`,
   `testing/endToEnd.ts`). Headless Chrome runs the app's pose step (MediaPipe Pose
   Landmarker full, GPU) on the six synthetic clips in `public/clips` (`npm run clips`,
   stick figure, front view, four relevés each: 24 attempts). Node then smooths, slices
   each attempt and runs `computeMetrics`. The truth is computed from the exact points
   drawn into each clip, with the SDD definitions in the picture plane (the figure is flat,
   so its real depth motion is 0). Phase truth uses the engine's own state machine on the
   noise-free heel signal, so a phase error measures the tracker and the smoothing, not a
   change of definition.

```
npx vitest run src/metrics src/pose          # layers 1 and 2
node scripts/calibrate-metrics.mjs --seek-check   # layer 3 (caches MediaPipe output in <tmp>/dance-practice-calibration)
node scripts/calibrate-metrics.mjs --clips 1014-1 --write-fixture   # refresh fixtures/mediapipe-releve-front.json
```

## Bugs found and fixed

| # | Where | Bug | Fix |
|---|---|---|---|
| 1 | `phases.ts`, supporting leg | SDD 5.4 says a parallel relevé (both heels equally high) uses the left leg. The code compared raw world heel y with an exact `>=`, so with any noise the side was a coin flip (10 left / 10 right in 20 noisy runs of one relevé), and the pelvis–ankle offset of half the runs measured the other ankle (0.22 leg lengths further in that test). Raw y also ignored each foot's standing offset. | Compare the floor-referenced heel lift of each foot; within `SUPPORT_TIE` (2% of leg length, the lift threshold) it is a tie and goes left. 20/20 left after the fix. |
| 2 | `pose/oneEuro.ts` + new `pose/swaps.ts` | Left/right label swaps were smoothed before the engine could undo them. Smoothing drags each shoulder towards the other over ~4 frames, so a swap became a fake rotation. Swap correction was exact on raw input (20/20), but once smoothed 2–3 turns were wrong in 14–16 of 20 runs. | `unswapLeftRight` runs before the filter: a frame whose torso (shoulders + hips) matches the previous frame better with labels exchanged is relabeled (all pairs, image and world) and marked `relabeled: true`. The flag is kept in the keypoints file (optional `relabeled` index list, version 1 compatible) and counts as a corrected swap for the turn count's note and confidence. |
| 3 | `pose/oneEuro.ts`, world smoothing | One-Euro `beta` 0.007 is the 1€ filter's starting value for pixel coordinates; applied to metres it raised the cutoff by only 0.01–0.03 Hz at pirouette speeds, so the world landmarks went through a fixed 1 Hz low-pass. A single turn at a peak of 4 turns/s counted 0 in 20 of 20 runs. | `ONE_EURO_WORLD.beta = 0.7` Hz per m/s for world landmarks (image landmarks, display only, keep the SDD values). Rationale in the code and below. |
| 4 | `signals.ts`, `SWAP_JUMP_DEG` | 135° missed every swap during steps over 45°/frame (3.75 turns/s): turns at 4–6 turns/s peak right in only 10–19 of 20 runs. | 90°, the value that tells a swap from a real step for any step under 90°/frame. 20/20. |
| 5 | `pose/frames.ts`, `planFrames` | Seeking to mid-frame showed the **next** frame for 38 of 1170 planned frames (every 30th, the same ones on every run); seeking to the frame start showed the previous frame in 31% of seeks. | Seek 2 ms after the frame start (`SEEK_OFFSET_S`). Checked with `requestVideoFrameCallback`: 0 of 1170 off target. Every offset from 0.1 ms to 0.49 frame was clean. |

No bug was found in the per-frame formulas themselves: on exact geometry trunk inclination,
pelvis–ankle offset and turn count are exact to 1e-6, knee tracking deviation to 0.02°,
and balance duration equals the SDD definition to the frame.

## Results

### Layer 2: synthetic dancer, tracker-like noise, after smoothing (20 runs per case)

| case | true | measured (mean) | mean error | worst run |
|---|---|---|---|---|
| trunk 0° (sideways and backwards) | 0.00 | 0.34 | +0.34 | +0.47 |
| trunk 5° | 5.00 | 4.99 | −0.01 | −0.43 |
| trunk 10° | 10.00 | 9.98 | −0.02 | −0.42 |
| trunk 20° | 20.00 | 19.98 | −0.02 | −0.40 |
| pelvis offset 0 | 0.000 | 0.019 | +0.019 | +0.041 |
| pelvis offset 0.05 | 0.050 | 0.055 | +0.005 | +0.017 |
| pelvis offset 0.1 | 0.100 | 0.103 | +0.003 | +0.014 |
| pelvis offset 0.2 | 0.200 | 0.201 | +0.001 | +0.014 |
| hold phase length, 1/2/3 s at the top | 1.43/2.43/3.43 s | +0.07 s | +0.06…+0.07 | +0.17 |
| balance, 1 s at the top, no dropped frames | 1.43 s | 1.41 | −0.03 | −0.63 |
| balance, 2 s at the top, no dropped frames | 2.43 s | 2.25 | −0.18 | −1.03 |
| balance, 3 s at the top, no dropped frames | 3.43 s | 3.09 | −0.34 | −1.77 |
| balance, 3 s at the top, with dropped frames | 3.43 s | 2.43 | −1.00 | −2.63 |
| knee deviation 0° (plié to 50°) | 0.0 | 2.3 | +2.3 | +6.4 |
| knee deviation 5° | 5.0 | 4.8 | −0.2 | +5.6 |
| knee deviation 10° | 10.0 | 9.5 | −0.5 | +6.2 |
| knee deviation 20° | 20.0 | 19.7 | −0.3 | +7.9 |

Balance truth is the SDD definition (end of rise to heel under 1%), which is longer than
the time at the top by part of the rise and the lowering.

| turns | peak turns/s | exact, no dropped frames | exact, with dropped frames | wrong counts flagged low |
|---|---|---|---|---|
| 1 | 2 | 20/20 | 19/20 | 1/1 |
| 1 | 4 | 20/20 | 18/20 | 2/2 |
| 2 | 3 | 20/20 | 18/20 | 2/2 |
| 2 | 4 | 20/20 | 19/20 | 1/1 |
| 3 | 3 | 20/20 | 18/20 | 2/2 |
| 3 | 5 | 20/20 | 17/20 | 3/3 |
| 2 | 6 | 0/20 | 0/20 | 3/20 |

Before fixes 2–4: 1 turn at a peak of 4 turns/s counted right in 0 of 20 runs, and 2 turns at a peak of 3.5 turns/s (with swaps and dropped frames) in 2 of 20.

**Tolerances asserted in `calibration.test.ts`** (every seeded run unless noted): trunk
≥ 5° within 2.5° (mean within 0.5°); trunk 0° between 0 and 2.5°; pelvis ≥ 0.05 within 0.03
leg lengths; pelvis 0 between 0 and 0.05; hold phase within 0.2 s and balance never over the
truth by 0.2 s or more, within 0.2 s in at least 6 of 12 runs; knee within 10° (mean within 3°);
turns exact with no dropped frames, and every wrong count low confidence with
`tracking_lost_in_turn`; lift end −0.1…+0.3 s from the noise-free definition.

### Layer 3: real MediaPipe on the synthetic clips (24 attempts, mt2-metrics-1.2.0)

| metric | truth (range) | measured (range) | mean error | mean abs error | worst |
|---|---|---|---|---|---|
| trunk inclination (°) | 0.40–1.47 | 2.53–4.73 | +2.67 | 2.67 | +4.33 |
| – sideways part, measured − true (°) | | | +2.36 | 2.36 | +2.70 |
| – same while standing still (truth 0) | | | +2.10 | 2.10 | +2.31 |
| – \|depth\| part (truth 0) (°) | | | +1.86 | 1.86 | +3.53 |
| pelvis–ankle offset (leg lengths) | 0.110–0.123 | 0.073–0.159 | −0.018 (−15%) | 0.022 (19%) | −0.051 (−41%) |
| – to the left ankle, x only | | 0.048–0.086 | | | |
| – to the right ankle, x only | | 0.139–0.169 | | | |
| – mean of left and right, x only | 0.117 (mean) | 0.112 (mean) | | | |
| balance duration (s) | 2.03–4.07 | 0.27–1.20 | −2.43 | 2.43 | −3.33 |
| – hold speed, median per attempt (m/s): x+z / x / z | 0 (drawn sway < 0.1) | 0.10–0.21 / 0.02–0.06 / 0.07–0.20 | | | |
| – share of hold frames ≥ 0.15 m/s: x+z / x only | 0 | 27–68% / 0–7% | | | |
| lift onset (s) | | | +0.17 | 0.17 | +0.20 |
| hold start (s) | | | −0.18 | 0.18 | −0.27 |
| lift end (s) | | | +0.00 | 0.05 | −0.30 |
| knee tracking deviation | drawn plié 82° (3D) | null (24/24, `knee_not_bent`; tracker max flexion 11–13°) | | | |
| turn count | no pirouette clip exists | – | | | |
| frame seek, frames shown off target | 0 | planFrames 0 / 1170; mid-frame 38 / 1170 | | | |

Confidence on these attempts: trunk high (24/24), pelvis low or medium (weakly visible
ankle while lifted), balance mostly low. 23 of 24 attempts chose the left leg; in 7310-1
attempt 1 the tracker puts the left heel ~2% of leg length higher than the right while
lifted (drawn: equal), so the SDD rule correctly takes the lower right heel.

## Where each bias comes from

- **Trunk inclination, +2.7° on the clips: not a formula bug.** The formula is exact on
  exact geometry and unbiased (|mean| ≤ 0.02°) on noisy tilts of 5° or more. About +2.4° is
  a sideways lean that MediaPipe gives the flat figure: it is there while the figure stands
  still (+2.1°, truth 0) and is the same in every clip. The rest is depth noise folded into
  an unsigned angle: the SDD reports the median of per-frame unsigned angles, so noise in
  the depth plane only ever adds (+1.9° on the clips, whose depth is the tracker's
  weakest axis on a flat figure; +0.3° at 0° with the measured noise of layer 2). That
  folding is a property of the definition, documented and left as specified. It is
  within the SDD's 5° target.
- **Pelvis–ankle offset: not a formula bug.** Exact on exact geometry, within 0.005 for
  offsets ≥ 0.05 under noise. On the clips the tracker shifts the world hip midpoint
  ~0.04 leg lengths towards the left ankle in every clip (left 0.05–0.09, right 0.14–0.17,
  truth 0.11–0.12; the mean of the two, 0.112, matches the truth, 0.117). With the
  right leg (before fix 1) the result read +22…+56% (mean +43%), the "+20–35%" noted
  before; with the left leg it reads −15%. Both are this tracker artifact, not tuned
  away. Near 0 the distance folds noise (+0.02 at a true 0).
- **Balance duration: not a formula bug, the least reliable metric.** The hold phase is
  found within ±0.2 s (synthetic: +0.07 s mean; clips: start −0.18 s, end +0.00 s), but
  the band breaks on speed: on the clips the hip-over-ankle speed is 0.02–0.06 m/s in x and
  0.07–0.20 m/s in depth for a figure whose drawn depth never moves. The SDD speed counts
  depth (x and z), so the run restarts whenever depth noise passes 0.15 m/s, and the value
  reads short (never long). With layer 2's measured still-figure noise the same mechanism
  costs 0–0.3 s on average and up to 1.8 s in a single run. How much of the clips' depth
  noise a real dancer (with depth cues) would produce is unknown; this needs real footage
  before anyone changes the definition (options to discuss: speed in x only for front
  views, a longer speed base, or letting a run survive one short excursion).
- **Phase timing.** Lift onset is late by ~0.17 s (One-Euro lag plus the 2% threshold).
  Hold start is early by ~0.18 s on the clips because the tracker's heel climbs in two
  steps with a plateau between them; the drawn heel does not.

## Thresholds reviewed

| constant | before | after | evidence |
|---|---|---|---|
| `LIFT_ON` / `LIFT_OFF` (heel hysteresis) | 2% / 1% | **kept** | Sweep of 2/1, 2/1.5, 2.5/1.25, 2.5/1.5, 3/1.5, 3/2 %: no false lift in 40 still 11 s clips and no extra lift in 108 relevés for any of them. With independent per-landmark drift, 1.5% shortened a late tail of the lift end (95th percentile +1.0 → +0.6 s), but on real tracker output 1.5% ended weak relevés early by up to 1.8 s (lift end MAE 0.17 s), while 1% gave MAE 0.05 s. Once the noise model used the measured drift (shared by the foot) the tail went away. 1% stays. |
| `RISE_END_RATE` | 5% leg/s | **kept** | Sweep 3/5/10/20%: 3% lags (+0.17 s median), 10% and 20% fire early more often (5th percentile −0.4…−0.5 s). A velocity over 0.1 or 0.2 s instead of one frame narrowed the synthetic spread (−0.37…+0.30 → −0.03…+0.30 s) but changed nothing on real output (hold start −0.18, −0.20, −0.24 s for 1-, 3- and 6-frame windows): the early start there is the tracker's two-step heel, not noise. Not adopted. |
| `SWAP_JUMP_DEG` | 135° | **90°** | Fix 4. |
| `SUPPORT_TIE` (new) | exact | **2%** | Fix 1. Same as `LIFT_ON`: a difference the engine would not call a lift is not a difference between the feet. |
| One-Euro world `beta` | 0.007 | **0.7** | Fix 3. Tried 0.007, 0.7, 3, 7: 0.7 is the smallest that counts 1–3 turns at peaks of 3–5 turns/s in 19–20 of 20 runs. On real MediaPipe output of the still figure the derivative-filtered speed is 0.02 m/s median, 0.10–0.13 m/s at the 95th percentile, so 0.7 raises the cutoff by under 0.1 Hz there; 3 and 7 let jitter through (worst balance of a still 2.5 s hold: 1.1 s and 0.7 s). Trunk and pelvis errors did not change between 0.007 and 0.7. |
| `planFrames` seek offset | half a frame | **2 ms** | Fix 5. |

Turn counts above a peak of 5 turns/s (mean ~3.3 turns/s, under 0.3 s per turn) are not
reliable: at a peak of 5.5–6 turns/s the smoothing loses half a turn even without noise,
and most of those wrong counts are not flagged. That is beyond typical student
pirouettes, but it is a known limit.

## Still needs real-footage validation (under the approved protocol)

- **Balance duration**: whether real depth noise breaks the speed band as it does on the
  flat figure. This is the biggest open question. SDD target: within 0.2 s.
- **Trunk inclination**: whether the ~2° sideways lean is specific to the flat figure, and
  the size of the depth folding on real bodies. SDD target: within 5°.
- **Pelvis–ankle offset**: whether the world hip midpoint is shifted sideways for real
  bodies too, and in which direction (it decides whether left-leg values read low).
- **Knee tracking deviation**: never measured end to end. MediaPipe does not rebuild the
  plié of a flat figure (11–13° of flexion for a drawn 82°), so every clip gives
  `knee_not_bent`. Synthetic only: noise-limited, ±10° worst run.
- **Turn count**: no pirouette clip exists (the 2D generator cannot draw a turn).
  Synthetic only. The un-swap before smoothing and the 90° rule are untested on real
  MediaPipe swaps. One false relabel was seen on the clips: a one-frame tracker glitch
  (1014-1, frame 190) where the torso collapses and the hip labels cross. Harmless for a
  relevé, but in a turn it would add the swap note.
  Later check on real phrase recordings against a multi-camera reference (numbers only,
  kept outside the repository): the chain sometimes missed the swap back, after which
  every later frame stayed exchanged. Since then a relabeled stretch longer than
  `MAX_SWAP_S` (1 s) is put back as the tracker gave it (`capRelabeled`, also applied to
  stored keypoints by the phrase engine, mt2-phrase-0.2.0); short glitches are still undone.
  A second check with the recording team's chessboard calibration (real focal lengths, lens
  distortion and camera poses instead of values estimated from the dancer) gave the same picture:
  trunk, neck, upper-body curve, knee flexion, leg elevation, arm reach and head timing follow the
  reference from a single camera (best from a diagonal camera, the front close behind, the pure side
  weakest), while knees over toes and circle completion do not follow it from any single view, and
  circle completion is unstable even in the reference. Since mt2-phrase-0.3.0 those two themes are
  still shown but never above low confidence (`DEPTH_LIMITED` in `phrase.ts`). The 1 s relabel cap
  held up against the calibrated reference as well.
- **Rise-end timing**: the two-step heel climb of the tracker may be a stick-figure
  artifact.
- **Frame seek**: checked in desktop Chrome on an H.264 clip at 30 fps. Phone recordings
  (variable frame rate, 60 fps, HEVC) and the Android WebView are not checked.
- Not covered at all: side views, clips that do not start with the dancer standing still,
  more than one person in the frame, and low light.

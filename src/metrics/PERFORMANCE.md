# Pipeline performance (NFR-6, NFR-7, NFR-9, NFR-10)

Measured on 2026-11-17 with `node scripts/measure-pipeline.mjs` (add `--cpu` for the CPU delegate).
Input: the **synthetic** test clips from `npm run clips` (stick figure, no person, no participant data).
The script runs the app's own modules in headless Chrome, the same steps as `src/v2/pipeline.ts`:
`estimatePose` → `smoothSeries` → `encodeSeries` (gzip) → `computeMetrics('releve_balance')`. Nothing is uploaded.

**Machine:** Windows 11 Home laptop (2019), Intel Core i7-9750H (6 cores / 12 threads, 2.6 GHz), 31.8 GB RAM,
NVIDIA GeForce GTX 1660 Ti + Intel UHD 630. Chrome 157.0.8103.52 (installed, headless, launched by Playwright).

## Results

Each clip: 540×960, 39.0 s, 1170 frames sampled at 30 fps, a pose found in every frame. A new page per clip,
so the model load is included (the 9.4 MB model comes from the HTTP cache after the first clip).

| Clip | Delegate | Model load | Pose (whole clip) | ms / frame | Pose, 10 s @ 30 fps (300 frames) | Smoothing | Metrics | gzip encode | Keypoints (gzip) | Per minute of video |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1014-1 | GPU | 0.4 s | 39.1 s | 33.4 | **10.0 s** | 23 ms | **11 ms** | 74 ms | 284 KB | **437 KB** |
| 4850-0 | GPU | 0.4 s | 31.7 s | 27.1 | **8.1 s** | 19 ms | **13 ms** | 71 ms | 281 KB | **432 KB** |
| 7310-1 | GPU | 0.3 s | 36.6 s | 31.3 | **9.4 s** | 21 ms | **10 ms** | 83 ms | 282 KB | **433 KB** |
| 1014-1 (first 10 s) | CPU | 0.4 s | 17.8 s | 59.4 | **17.8 s** | – | – | – | – | – |
| 4850-0 (first 10 s) | CPU | 0.5 s | 17.2 s | 57.2 | **17.2 s** | – | – | – | – | – |

The uncompressed PoseSeries JSON of a 39 s clip is 8.2 MB; the delta-coded gzip file is 1/29 of that.
The 6 keypoint files already in the test account's bucket average 281 KB (same clips), matching the table.

## Against the requirements

| NFR | Target | Measured | Status |
| --- | --- | --- | --- |
| NFR-6 (laptop) | 10 s, 30 fps clip in < 20 s | 8.1–10.0 s on GPU (27–33 ms/frame); 17.2–17.8 s on the CPU fallback | Met (GPU with 2× margin; CPU fallback with ~10% margin) |
| NFR-6 (phone) | same clip in < 60 s on a 2022+ mid-range Android | not measured: needs a device | Open. The CPU path on this laptop is 58 ms/frame; a phone 2–3× slower would land at 35–55 s |
| NFR-7 | metrics < 2 s after pose | 10–13 ms for a 39 s clip (55 ms incl. smoothing; ~130 ms incl. gzip) | Met (≈ 150× margin) |
| NFR-10 | ≤ 1 MB per minute of video | 432–437 KB/min | Met |

Caveats:
- The clips are a synthetic stick figure on a plain background, 540×960. Real phone video (1080p, clutter,
  partial occlusion) decodes slower and seeks slower; inference cost per frame does not depend much on resolution
  because MediaPipe resizes to 256×256. Re-measure on a real practice clip (outside the repo) before C-Day.
- "GPU" is what `currentDelegate()` reported. Headless Chrome was started with `--use-angle=d3d11`; which adapter
  ANGLE picked (NVIDIA or Intel) was not checked.
- Hiding WebGL entirely (`--disable-webgl`) makes the app's CPU fallback fail too
  (`Cannot read properties of undefined (reading 'activeTexture')`): MediaPipe's image input still needs a GL
  context. The `--cpu` row therefore builds a CPU-delegate landmarker with WebGL available. On a device with no
  WebGL at all, pose estimation would fail with a dancer-safe error rather than run on CPU.
- Pose estimation is over 99% of the pipeline's time. Frames are seeked one by one (`src/pose/landmarker.ts`),
  which keeps results repeatable; how much of each frame's 27–33 ms is seeking rather than inference was not split.

## NFR-9: capacity on the Supabase free tier

Free plan limits used (check the current Supabase pricing page before relying on them): **500 MB database,
1 GB file storage, 50 MB per uploaded file, 5 GB egress per month**; a free project is paused after a week without
activity.

Measured sizes: keypoints **437 KB per minute** of video (≈ 73 KB for a 10 s attempt). Database rows (JSON size
read back through the API): `attempts` 0.5 KB, `attempt_metrics` 1.2 KB, `attempt_keypoints` 0.3 KB per attempt;
`sessions` 0.3 KB; a stored practice note is estimated at 2–3 KB. With Postgres row and index overhead, budget
about **8 KB of database per attempt**.

Load: 180 study attempts (12 dancers × 15 clips) + 500 dancer attempts = **680 attempts**.

| Attempt length | Keypoints storage (680 × size) | Share of 1 GB | Database | Share of 500 MB |
| --- | --- | --- | --- | --- |
| 10 s | 50 MB | 5% | ≈ 5.5 MB | ≈ 1% |
| 30 s | 149 MB | 15% | ≈ 5.5 MB | ≈ 1% |
| 60 s (worst case) | 297 MB | 29% | ≈ 5.5 MB | ≈ 1% |

Egress: opening an attempt downloads its keypoints once (73–437 KB), so even 10 000 openings a month stay under
5 GB at 30 s attempts.

**Verdict: NFR-9 is met for keypoints and metrics**, with room for about 3× the target load at 60 s per attempt.
The one thing that does not fit is **video backup** (bucket `videos`, own clips only, disabled today): a 10 s 1080p
phone clip is roughly 15–25 MB, so 500 of them would need 7.5–12.5 GB. If backup is enabled on the free tier it
needs a quota (about 40 clips of 20 MB per project) or the Pro plan. Study clips are never uploaded
(`study_no_video`), so they cost only their keypoints.

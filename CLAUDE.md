# Dance Practice Analytics (MT-2-HCI)

CS 4850-02 (Fall 2026), Kennesaw State University, team **MT-2-HCI** (solo: Andres Turipe Toro). Domain mentor: Dr. Milka Trajkova. Started from the MT-1 "Practice Studio" prototype; the MT-2 scope adds real-video pose estimation on device (MediaPipe), a Supabase backend, AI practice notes and an Android/PWA build. The SRS/SDD in `../docs/mt2` are the source of truth for requirements (FR-3.x.y, NFR-n) and design.

**MT-2 architecture (supersedes the FastAPI/MovAI notes further down):** React app → MediaPipe Pose Landmarker in the browser/WebView → metrics engine in TS → Supabase (Auth, Postgres with owner-only RLS, private buckets `keypoints` and `videos`) → Edge Functions `generate-feedback` and `mika-chat` → an LLM (metrics only). **Provider decision (2026-11-16): not Anthropic; Google Gemini or xAI Grok, still to be chosen.** Both functions are provider-agnostic: `supabase/functions/_shared/llm.ts` calls any OpenAI-compatible Chat Completions endpoint over `fetch`, configured only by the Supabase secrets `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` (values for Gemini and Grok in `src/v2/README.md`, "AI provider"). Schema: `supabase/migrations/`. Env: `.env.local` (see `.env.example`). Study clips (12 dancers × 15) are opened locally and never uploaded; subject codes S01–S12.

The user writes in Spanish. Answer in Spanish; code, UI copy and docs stay in English.

## Product in one paragraph

A dancer uploads a practice video of one movement. MovAI (proprietary markerless pose software, under NDA) extracts the pose. The dancer confirms where each attempt and phase starts. The dashboard shows 3–4 measurements and synced video plus charts to compare two of the dancer's **own** attempts, and the dancer writes a reflection. The current candidate movement is a **relevé balance in parallel**; the teacher interview prioritized alignment (knee over toes, parallel feet, head–spine, shoulders down).

## Hard rules

- **Never grade technique.** Show values and change between the dancer's own attempts, never scores. No radar charts, no red/green "good/bad", no rankings. Copy stays neutral ("B is 2.1 pts lower").
- Out of scope: multiple dancers, live processing, training a pose model.
- **NDA/IRB:** no real footage, MovAI exports, participant data or interview content in this repo. Everything here is synthetic. Participants are identified by codes only. Don't write MovAI's URL anywhere.
- Missing or low-quality tracking is shown as a gap or a hatched band, never filled in or zeroed. Unavailable summaries say why.
- The browser only holds the Supabase publishable key (RLS protects data). The language model (Gemini or Grok, to be chosen; not Anthropic) is called **only from the Supabase Edge Functions `generate-feedback` and `mika-chat`**, with metrics JSON only, never keypoints, frames or video. The provider's API key lives only in Supabase secrets; the user sets it in their own terminal, never in chat.
- Study clips (source `study_dataset`) are opened as local files (blob URLs), processed on device and never uploaded anywhere (DB CHECK `study_no_video` enforces it). Don't paste or read real footage in Claude Code either.
- Keep measurement-accuracy evaluation separate from usability evaluation.

## Stack and commands

React 19 + TypeScript + Vite 8 + Recharts 3 + Vitest. Type: Geist and Geist Mono (timecodes). Styles: `styles.css` (tokens, workspace), `pages.css` (screens), `shell.css` (shell v2, loaded last). No backend yet; the mock API runs in the browser.

```
npm install
npm run dev        # http://localhost:5173 (VS Code runs this on folder open)
npm run build      # typecheck + production build
npm run typecheck
npm test           # Vitest (lib/, router, export)
npm run clips      # generate the synthetic test clips in public/clips (headless Chrome; git-ignored, *.mp4 is an NDA guard)
npm run e2e        # Playwright: full flow, workspace, study panel, phone width (installed Chrome; makes the clips if missing)
```

`VITE_DAD_API_URL` (see `.env.example`) switches from the in-browser mock to the real API. Mock sign-in: any code like `P07`, passcode `practice`. Planned backend: Python 3.11, FastAPI + Pydantic, NumPy/Pandas, SQLite, FFmpeg.

## Flow and code map

Sign in → home → new session (goal, recording conditions, clip, permission) → processing (pose export upload, job polling, import report) → confirm attempts → workspace (review, compare, reflect). Hash routes in `src/router.ts`.

- `src/types.ts`: the API contract (Development Document 2.3.4): results, sessions, jobs, attempts update, notes. Mock and backend must both match it.
- `src/api/client.ts`: typed client for every endpoint; lazy-loads `src/mock/server.ts` when no URL is set. `ApiError` carries a dancer-safe message and recovery hint.
- `src/mock/`: `server.ts` (localStorage-backed sessions, simulated jobs incl. a mismatch failure, same boundary validation as the server), `syntheticSession.ts` (seeded pose tracks; `DEMO_SPEC` is the reference session), `metricsEngine.ts` (TS mirror of the metric definitions and formulas), `footage.ts` + `encodeClip.ts` + `clips.ts` (synthetic test clips rendered from the pose tracks, watermarked with a burned-in timecode; every new mock session uses the sample track `SAMPLE_SEED` so study runs repeat).
- `src/state/clock.ts`: the single playback clock (external store, rAF). While a clip plays, the leading `<video>` is its time source (`setSource`), so pose and picture can't drift. Components that need the playhead subscribe with `useClockTime` and similar hooks; big components must not re-render every frame.
- `src/state/studio.tsx`: workspace reducer, derived data, `apply(UIAction)`, debounced autosave (PATCH notes, serialized PUT attempts, flush on leave) and study logging of actions.
- `src/state/app.ts`: auth, save status, toasts. `src/state/store.ts`: tiny external store.
- `src/lib/`: `attempts.ts` (`mapTime`, `withBoundary`), `series.ts` (`summarize`, `timeOnReleve`), `suggest.ts` (boundary suggestions from heel/hip signals + `validateAttempts`), `exportData.ts` (JSON/CSV export with explicit nulls and quality reasons), `phases.ts`, `format.ts`. Tests in `lib/lib.test.ts`.
- `src/pages/`: `SignIn`, `Journal` (home dashboard: next focus, KPI tiles, across-sessions strip plot, practice calendar, sessions table), `Progress` (small multiples of every measurement across sessions, per phase), `NewSession`, `Processing`, `ConfirmAttempts`, `Workspace` (viewport-fit: goal bar, stage with transport, tabbed inspector, timeline).
- `src/lib/acrossSessions.ts`: per-session columns, medians and neutral change text for home and progress; only front-view sessions are compared.
- `src/components/`: workspace panels (`PoseStage` with ghost/trails, `MetricPanel`, `Timeline`, `AttemptStrip`, `ComparePanel`, `NotesPanel`, `Companion`), plus `StageVideo` (clip under the skeleton: lead clip drives the clock, attempt B is seeked phase-matched), `AppBar` (`SideNav` rail + slim top bar), `SessionStrip` (across-sessions strip plot + table), `PoseLoop` (standalone animated skeleton), `ReflectionSheet`, `CommandPalette` (Ctrl+K), `Onboarding`, `ui.tsx` (Dialog, toasts, save indicator).
- `e2e/`: Playwright specs (`flow`, `workspace`, `app`, `mobile`) against the mock on port 5180; `helpers.ts` has sign-in, demo session and wizard helpers.
- `src/study/`: usability-study log, off by default (`?study=on` in the hash or Ctrl+Shift+S). Participant code only, never free text. "Next participant…" exports/clears the log, resets the mock sessions and onboarding, and signs out with the next code prefilled. Needs IRB approval before use; keep it separate from measurement-accuracy evaluation.
- `src/companion/`: `UIAction` (future tool names: `seek_video`, `focus_metric`, `open_comparison`, `add_moment_marker`) and the scripted mock companion.

## MT-2 status and plan (updated 2026-11-15)

Context: the user moved from team MT-1 to MT-2 on 2026-11-08 and works solo. The Project Plan, Gantt, SRS and SDD are written (generated by Python scripts in `../docs/mt2`: `common.py` config, `build_plan.py`, `build_srs.py`, `build_sdd.py`, `finalize.ps1` updates the Word TOC/PDF/spell check). Still to write: the Development Document (needs real setup steps and the DB connection, so write it once the Supabase wiring works) and the prototype presentation `.pptx` for **Tue 2026-11-17** (12 min, live demo, slides on DB connection and setup; must say "We submitted our PowerPoint slides prior to this presentation.").

Done:
- GitHub org `dance-practice-analytics`, repo `dance-practice` (public, for GitHub Pages). Push to `main` with short feature branches.
- Supabase project ref `fcdgjzlbjrzkonaained` (us-west-2, free). URL and publishable key in `.env.local` (git-ignored).
- `supabase/migrations/20261115000000_init.sql`: enums, tables profiles/subjects/consents/sessions/attempts/attempt_keypoints/attempt_metrics/feedback, owner-only RLS on every table, profile trigger, private buckets `keypoints` ({uid}/{attempt_id}.json.gz) and `videos` (user_upload only). **Not applied yet**: needs `npx supabase login` (the user runs it with `!`), then `npx supabase link --project-ref fcdgjzlbjrzkonaained` and push the migration (or the user pastes it in the SQL Editor).
- The user is designing the screens in Claude Design (11 screens: sign in, consent, library, import, processing, review, compare, progress, AI notes, researcher dataset grid, settings). Implement against that design when it arrives; keep the existing code map below where it fits.

- Step 1, auth half (branch `feat/supabase-auth`): `src/api/supabase.ts` (client, null without env), `withSupabaseAuth` in `src/api/client.ts` (email + password sign-in/sign-up, session restore, `onAuthChange`); session data still comes from the mock, keyed by an account code `U` + 6 hex of the user id (`adoptAccount` in `src/mock/server.ts`). `src/api/authErrors.ts` maps Supabase errors to dancer-safe copy. Sign-in screen follows screen 1 of the Claude Design canvas. Without `VITE_SUPABASE_URL` the app is the mock with participant codes; `playwright.config.ts` blanks the Supabase env so e2e never touches the real project. Password recovery (FR-3.1.3) and the consent screen are done in v2; recovery email delivery needs custom SMTP (the built-in sender only reaches project team addresses, and the test account's domain is rejected). Not done yet: sign-in link.
- Migration applied on 2026-11-15 by pasting it in the SQL Editor (the CLI's Postgres connection times out on the user's network, so `supabase db push` hangs; the CLI migration history is therefore empty, fix later with `supabase migration repair --status applied 20261115000000`). CLI is logged in and linked.
- `supabase/config.toml` declares only what we manage: email confirmation OFF (prototype; built-in SMTP is rate-limited, turn back on with custom SMTP before real participants) and minimum password length 10. Apply with `npx supabase config diff` then `npx supabase config push --yes` (HTTPS, works on this network).
- A test account for manual checks lives in `.env.local` as `TEST_ACCOUNT_EMAIL` / `TEST_ACCOUNT_PASSWORD` (git-ignored, no `VITE_` prefix). Verified end to end: sign-up, `profiles` row with role `dancer`, role change refused (403), session survives reload, sign out, sign in.
- `.env.local` must be saved without a BOM, or Vite silently drops the first variable.
- Modules for steps 2–4 exist as tested libraries, **not wired to any screen yet** (2026-11-15):
  - `src/pose/`: `types.ts` (PoseSeries contract), `landmarker.ts` (`estimatePose`, seeks a hidden video frame by frame, GPU→CPU fallback, main thread), `oneEuro.ts` (`smoothSeries`), `codec.ts` (gzip JSON, delta-coded), `frames.ts`. Model self-hosted at `public/mediapipe/pose_landmarker_full.task` (9.4 MB, falls back to Google's URL); WASM comes from the npm package via `?url`. `estimatePose` has never run in a real browser.
  - `src/metrics/`: `computeMetrics(series, movement)` → `attempt_metrics` row; phases prep/rise/hold/turn/finish/recovery; null + reason when a metric can't be computed; `ALGORITHM_VERSION`. Constants the SDD leaves open (rise-end 0.05 leg lengths/s, swap jump > 135°) are untuned against real MediaPipe output.
  - `src/data/`: typed Supabase repo (`repo.ts`: subjects, sessions, study attempts with `video_path` always null, keypoints upload/download, metrics), `schema.ts`, `clipFile.ts` (`sha256Hex`, `parseClipName`, `readVideoMeta`). Tested against a fake client only. `.gitignore` has `!/src/data/` because the NDA rule `data/` would hide it.
  - SRS FR-3.4.3, SDD 5.3–5.5 and the Development Document were aligned with the code on 2026-11-15 (leg length, no gap interpolation, per-foot floor level, 0.3/0.6 visibility gates) and regenerated. Possible schema additions: `attempts.clip_number`, session note, a way to update `fps` after pose.
- **New UI ("v2") implemented from the Claude Design canvas (2026-11-15).** `src/main.tsx` picks the tree at startup: Supabase configured → `src/v2/` (design stylesheet `studio.css` only); no Supabase env → the old MT-1 prototype via `src/legacyMain.tsx` (mock data; the Playwright e2e runs here). Never import old CSS into v2 or the reverse. **Read `src/v2/README.md` before touching v2**: router, auth, consents, data hooks, pipeline, clips, shared components. Design sources are saved in `../docs/mt2/design/*.dc.html`, screenshots in `../docs/mt2/design/shots/`.
  - Working against the real project: Sign in, Consent (writes `consents`), Dashboard, Library, Import → Processing (on-device MediaPipe → keypoints to Storage → metrics), Review (single clock, skeleton over the local video, relink by SHA-256 after a reload), Compare (phase-aligned), Progress, Settings & data (export JSON/CSV, delete with report), Study dataset (role `researcher`, set by hand in `profiles`).
  - Not connected, and the screens say so: Practice notes (Edge Function `supabase/functions/generate-feedback` is written and unit-tested but not deployed; needs the `LLM_*` secrets; never run under Deno) and Mika, the AI chat (formerly "Ask AI", named after the domain mentor; Edge Function `mika-chat`, not deployed; sending disabled until it answers). Also disabled: video backup, Record. Change password and Delete account work (Edge Function `delete-account`, deployed 2026-11-15, service role only inside the function).
  - Metrics engine is `mt2-metrics-1.1.0`: landmarks are used from visibility ≥ 0.3 (`TRACK_MIN`) while confidence still uses 0.6; floor reference is per foot over 0.5–1.0 s; balance speed over 0.2 s; only the first lift of a clip is measured (`clip_notes: multiple_lifts_detected`). Calibrated (mt2-metrics-1.2.0, see `src/metrics/CALIBRATION.md`) on synthetic stick-figure clips only: trunk reads ~2.7° high, pelvis–ankle ~15% low, balance duration reads short; pirouette/turns untested on real output. Clips should start with the dancer standing still and hold one attempt each.
  - Local study check (2026-11-17, general results only, in the docs and deck): against an approximate self-calibrated multi-view reference, the **diagonal view (~45°) is the recommended single-camera setup** (front second, side weakest). Phrase engine `mt2-phrase-0.2.0` caps left/right relabelling at 1 s (a swap could stay for the rest of a clip). Knee tracking and circle completion are not reliable from one camera; a calibrated Pose2Sim reference is future work. No per-dancer values in this repo.
  - Known issues: `planFrames` in `src/pose/frames.ts` seeks to mid-frame and Chrome presents the next frame about 1 time in 30; phone Processing layout fix unverified with a full queue; `clip_notes` not shown in the UI or sent to the notes function.
  - PWA files exist (`public/sw.js`, manifest, icons, `.github/workflows/deploy-pages.yml`, `docs/pwa.md`); nothing deployed. Capacitor 8 Android project in `android/` (2026-11-17): `npm run android:build` → debug APK (~17 MB, model + WASM bundled), `npm run cap:sync`; see "Android app" in `src/v2/README.md`. Not yet run on a phone or emulator.
  - The test account holds subjects S01/S02 with six processed synthetic clips.
  - Published on Vercel, one domain since 2026-11-17: https://dance-practice-teal.vercel.app/ = landing page (source `site/`, incl. `vercel.json` and a root `sw.js` that retires the old root service worker), `/app/` = the app (built with `BASE_PATH=/app/`). Not connected to GitHub: `npm run deploy` (`scripts/deploy-vercel.mjs`: build, assemble outside the repo without `dist/clips`, stamp sw VERSION, secret scan, `vercel deploy --prod`; `--dry-run` to stop before deploying). Needs `.vercel/project.json` in the repo (git-ignored). `supabase/config.toml` has `site_url` = `/app/` and the redirect URLs. The old GitHub Pages site (`../landing`) is now only a redirect.
  - Night of 2026-11-16: navy #0B1533 / cloud #F5F7FB / lime #C8F54A identity in v2 (tokens in `studio.css`; lime is an accent only, never text on white and never "better"); Edge Function `mika-chat` written and tested (not deployed: needs the `LLM_*` secrets, then `npx supabase functions deploy mika-chat --use-api`); landing page live at https://dance-practice-analytics.github.io (repo `dance-practice-analytics.github.io`, local folder `../landing`); C-Day abstract and poster in `../docs/mt2/cday` (`build_all.ps1`); 598 unit tests in 30 files.
  - Readability pass (2026-11-16): light theme by default; side nav cut to Dashboard/Library/Import/Progress/Settings (attempt screens appear under Library); pose thumbnails (`AttemptThumb`); Dashboard greeting + optional display name; data-derived "Next step" card (`library/nextStep.ts`); first-run Welcome with "Try with a sample session" (`src/v2/sample*.ts`, synthetic, no video, recognised by its title/label); `knee_not_bent` shown as a compact gap (`CompactGap`); Progress "Session n" labels and date presets; relink card on the stage; A/B chips in Compare; text tokens raised to AA.

Build order (prototype demo first):
1. Supabase client (`@supabase/supabase-js`), email auth, replace the mock API in `src/api/client.ts` behind the same types.
2. Local import of study clips (multi-file, subject S01–S12, movement, camera view) → attempts rows with source `study_dataset`, no upload.
3. MediaPipe Pose Landmarker (`@mediapipe/tasks-vision`, VIDEO mode, full model, in a worker or batched with yields) → PoseSeries (33 image + 33 world landmarks, visibility) → One-Euro smoothing → gzip upload to `keypoints`.
4. Metrics engine on world landmarks (SDD 5.4–5.5: heel-lift phase state machine with 2%/1% hysteresis, trunk inclination, pelvis-ankle offset / leg length, balance duration, knee tracking, turn count; confidence = share of frames with visibility ≥ 0.6 × mean visibility; high ≥ 0.8, medium ≥ 0.5) → `attempt_metrics`. Unit tests with Vitest.
5. Review/compare screens on real keypoints (skeleton overlay on the local video).
6. Edge Function `generate-feedback` (Deno; user JWT so RLS applies; 20 req/user/hour; model from the `LLM_MODEL` secret via `_shared/llm.ts` (Gemini or Grok, OpenAI-compatible, no SDK); structured output FeedbackResponse {summary, observations[1-4]{metric, observation, suggestion, confidence}, cautions[], disclaimer} as `response_format` json_schema, always re-validated; `finish_reason` content_filter → refusal, length → truncated). Written; deploy with `npx supabase functions deploy generate-feedback --use-api` after the user sets the secrets.
7. Capacitor Android build + PWA manifest/service worker.

Requirement IDs to reference in commits: FR-3.1.x accounts, 3.2 import/dataset, 3.3 pose, 3.4 metrics, 3.5 review, 3.6 compare/history, 3.7 AI notes, 3.8 mobile, 3.9 export/delete; NFR-1..20.

## Old AI companion plan (MT-1, superseded by the Edge Function above)

- `POST /sessions/{id}/assistant` on FastAPI, streaming (SSE), using the Python `anthropic` SDK with model `claude-opus-5-5` and server-side fallbacks.
- Read tools that enforce session ownership: `get_session_results`, `compare_attempts`, `get_metric_definition`, `get_notes`. UI tools are relayed to the browser as the `UIAction`s above.
- Send derived numbers and dancer notes only, never video or names. Needs sponsor and IRB approval before use with participants; stays behind a toggle.
- Before writing Claude API code, use the claude-api skill and don't guess SDK calls.

## Key dates (Eastern)

Prototype presentation **Nov 17** (in class) · final C-Day materials Nov 17, 5 pm · release freeze Nov 20 · C-Day Dec 2 · handoff Dec 4.

## Old MT-1 next steps (kept for reference)

1. Team review of the full flow; pick the final 3–4 metrics after the MovAI trial.
2. Serve the uploaded clip from `GET /sessions/{id}/video` (the frontend already plays `api.videoUrl`; it needs range requests for seeking).
3. FastAPI backend matching `src/types.ts`, including `/auth/session` and `/auth/me` (httpOnly cookie).
4. Confirm the study log with the IRB before user testing; run `npm run e2e` before each testing day (add it to CI).
5. Companion backend endpoint once approved.

# Dance Practice Analytics (MT-2-HCI)

CS 4850-02 (Fall 2026), Kennesaw State University, team **MT-2-HCI** (solo: Andres Turipe Toro). Domain mentor: Dr. Milka Trajkova. Started from the MT-1 "Practice Studio" prototype; the MT-2 scope adds real-video pose estimation on device (MediaPipe), a Supabase backend, AI practice notes and an Android/PWA build. The SRS/SDD in `../docs/mt2` are the source of truth for requirements (FR-3.x.y, NFR-n) and design.

**MT-2 architecture (supersedes the FastAPI/MovAI notes further down):** React app → MediaPipe Pose Landmarker in the browser/WebView → metrics engine in TS → Supabase (Auth, Postgres with owner-only RLS, private buckets `keypoints` and `videos`) → Edge Function `generate-feedback` → Claude (metrics only). Schema: `supabase/migrations/`. Env: `.env.local` (see `.env.example`). Study clips (12 dancers × 15) are opened locally and never uploaded; subject codes S01–S12.

The user writes in Spanish. Answer in Spanish; code, UI copy and docs stay in English.

## Product in one paragraph

A dancer uploads a practice video of one movement. MovAI (proprietary markerless pose software, under NDA) extracts the pose. The dancer confirms where each attempt and phase starts. The dashboard shows 3–4 measurements and synced video plus charts to compare two of the dancer's **own** attempts, and the dancer writes a reflection. The current candidate movement is a **relevé balance in parallel**; the teacher interview prioritized alignment (knee over toes, parallel feet, head–spine, shoulders down).

## Hard rules

- **Never grade technique.** Show values and change between the dancer's own attempts, never scores. No radar charts, no red/green "good/bad", no rankings. Copy stays neutral ("B is 2.1 pts lower").
- Out of scope: multiple dancers, live processing, training a pose model.
- **NDA/IRB:** no real footage, MovAI exports, participant data or interview content in this repo. Everything here is synthetic. Participants are identified by codes only. Don't write MovAI's URL anywhere.
- Missing or low-quality tracking is shown as a gap or a hatched band, never filled in or zeroed. Unavailable summaries say why.
- The browser never sees credentials. The future AI companion calls Claude **only through the FastAPI server**.
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

## AI companion plan (not built yet)

- `POST /sessions/{id}/assistant` on FastAPI, streaming (SSE), using the Python `anthropic` SDK with model `claude-opus-5-5` and server-side fallbacks.
- Read tools that enforce session ownership: `get_session_results`, `compare_attempts`, `get_metric_definition`, `get_notes`. UI tools are relayed to the browser as the `UIAction`s above.
- Send derived numbers and dancer notes only, never video or names. Needs sponsor and IRB approval before use with participants; stays behind a toggle.
- Before writing Claude API code, use the claude-api skill and don't guess SDK calls.

## Key dates (Eastern)

Phase 2 ends Nov 2 · user testing Nov 3–16 · C-Day application Nov 9, 5 pm · final C-Day materials Nov 17, 5 pm · release freeze Nov 20 · C-Day Dec 2 · handoff Dec 4.

## Next steps

1. Team review of the full flow; pick the final 3–4 metrics after the MovAI trial.
2. Serve the uploaded clip from `GET /sessions/{id}/video` (the frontend already plays `api.videoUrl`; it needs range requests for seeking).
3. FastAPI backend matching `src/types.ts`, including `/auth/session` and `/auth/me` (httpOnly cookie).
4. Confirm the study log with the IRB before user testing; run `npm run e2e` before each testing day (add it to CI).
5. Companion backend endpoint once approved.

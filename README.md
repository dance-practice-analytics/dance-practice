# Dance Practice Analytics

A web app (installable as a PWA) that helps a dancer review their own practice clips. Pose estimation runs on the device, the app measures each attempt of one movement (currently a relevé balance in parallel, with pirouettes in progress), and the dancer compares two of their own attempts side by side and across sessions.

Capstone project for CS 4850 (Fall 2026), Kennesaw State University, team MT-2-HCI: Andres Turipe Toro. Domain mentor: Dr. Milka Trajkova.

- Project site: https://dance-practice-teal.vercel.app
- App: https://dance-practice-teal.vercel.app/app/

## Privacy principles

These are design rules, not settings:

- **Pose estimation runs on the device.** MediaPipe Pose Landmarker runs in the browser. Video is never sent to a server.
- **Study clips are never uploaded.** They are opened as local files, processed in the tab and kept out of storage; a database constraint rejects a video path on study attempts.
- **Only keypoints and metrics are stored.** Smoothed keypoints go to a private Storage bucket and metrics to Postgres, both protected by owner-only row-level security.
- **AI features see metrics only.** The planned practice notes and the chat assistant receive metric values, units, confidence and the reasons a value is missing. Never video, frames, keypoints, file names or subject codes. They require a separate opt-in consent.
- **The app never grades technique.** It shows values and neutral differences between the dancer's own attempts ("B is 2.1° lower than A"). No scores, rankings, radar charts or good/bad colours.
- **Gaps stay gaps.** Missing or low-confidence tracking is shown as a gap or a hatched band with its reason, never filled in or set to zero.
- Participants are identified by codes (S01 to S12). The repository contains no real footage or participant data; every fixture and sample is synthetic.

## Architecture

```
Browser / PWA (React 19 + TypeScript + Vite)
  local video file ──> MediaPipe Pose Landmarker (on device)
                   ──> One-Euro smoothing ──> metrics engine (TypeScript)
                   │
                   ▼
Supabase
  Auth (email + password)
  Postgres with owner-only RLS: profiles, subjects, consents, sessions,
    attempts, attempt_keypoints, attempt_metrics, feedback
  Storage, private buckets: keypoints (gzip JSON), videos (own uploads only, disabled for now)
  Edge Functions: delete-account, generate-feedback, mika-chat
                   │
                   ▼ metrics JSON only
  LLM provider (Gemini or Grok, to be selected)
```

- The browser holds only the Supabase URL and publishable key. Row-level security protects the data.
- The LLM key and settings live only in Supabase secrets and are read by the Edge Functions.
- The metrics engine (`src/metrics/`) finds the phases of an attempt (prep, rise, hold, turn, finish, recovery) from heel lift and computes trunk inclination, pelvis-ankle offset, balance duration, knee tracking and turn count, each with a confidence level or a null with a reason. Calibration notes are in `src/metrics/CALIBRATION.md`.

## Setup

Requirements: Node.js 22 or later, npm, and a Supabase project.

```
npm install
```

1. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the Supabase dashboard (Project Settings, API). Save the file **without a byte-order mark** (UTF-8 without BOM); otherwise Vite silently ignores the first variable. Only public values go in this file.
2. Apply the database schema in `supabase/migrations/`, either by pasting each file into the Supabase SQL Editor in order, or with the CLI:
   ```
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
   If you applied the SQL by hand, mark it as applied with `npx supabase migration repair --status applied <version>` so the CLI history matches.
3. Apply the auth settings in `supabase/config.toml` (email confirmation, password length, redirect URLs): `npx supabase config diff`, then `npx supabase config push`.
4. Start the dev server:
   ```
   npm run dev
   ```
   and open http://localhost:5173.

The researcher role is set by hand in the `profiles` table; every new account is a dancer.

Without the Supabase variables the app starts the earlier MT-1 prototype on in-browser mock data (sign in with any code like `P07`, passcode `practice`). The end-to-end tests run against that mode.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on http://localhost:5173 |
| `npm run build` | Type check and production build into `dist/` |
| `npm run typecheck` | TypeScript check only |
| `npm test` | Vitest unit tests (metrics, pose codec, data layer, insights, Edge Function handlers with fakes) |
| `npm run e2e` | Playwright end-to-end tests against the mock mode, using the installed Chrome (`PW_BUNDLED=1` for Playwright's own Chromium) |
| `npm run clips` | Generates the synthetic test clips in `public/clips` (git-ignored); `npm run e2e` runs it when they are missing |

CI (`.github/workflows/ci.yml`) runs the type check and unit tests on every push and pull request to `main`.

## Deployment

**Site and web app (Vercel).** One domain serves both: https://dance-practice-teal.vercel.app/ is the project site (source in `site/`) and https://dance-practice-teal.vercel.app/app/ is the app. The Vercel project is not connected to GitHub; one script builds and publishes both:

```
npm run deploy                          # node scripts/deploy-vercel.mjs
node scripts/deploy-vercel.mjs --dry-run   # build, assemble and scan only
```

It builds the app with `BASE_PATH=/app/` (Supabase values from `.env.local`), assembles a folder outside the repository (default `<tmp>/dance-practice-deploy/dance-practice`, or `--out <dir>`) with `site/*` at the root and `dist/*` under `app/` (without `dist/clips`), stamps the service worker version with the commit, scans every file for secrets (`sk-`, `sb_secret_`, `service_role`, `TEST_ACCOUNT`, any non-`VITE_` value in `.env.local`) and runs `npx vercel deploy <folder> --prod --yes`. It needs the Vercel project link in `.vercel/project.json` (git-ignored; create it once with `npx vercel link`, or pass `--link <dir>`). Routing and cache headers are in `site/vercel.json`; `site/sw.js` removes the service worker that older deploys registered at the root. Old app links (`/#/...`) are forwarded to `/app/#/...` by the site. The app URL must stay in `supabase/config.toml` (`site_url`, `additional_redirect_urls`) for password-reset links to work; apply changes with `npx supabase config push --yes`.

The former site at https://dance-practice-analytics.github.io now only redirects here.

**GitHub Pages (optional).** `.github/workflows/deploy-pages.yml` builds with `BASE_PATH=/<repo>/` and publishes on push to `main`. See `docs/pwa.md` for the one-time repository settings and the PWA details.

**Edge Functions.** Deploy with Supabase's bundler (no Docker needed) and keep JWT verification on:

```
npx supabase functions deploy delete-account --use-api
npx supabase functions deploy generate-feedback --use-api
npx supabase functions deploy mika-chat --use-api
```

**Secrets.** The project owner sets them in their own terminal. Never paste a key into a chat, an issue or a file in the repository:

```
npx supabase secrets set LLM_API_KEY=... LLM_BASE_URL=... LLM_MODEL=...
```

## Project structure

| Path | Contents |
| --- | --- |
| `src/v2/` | The current app (screens, router, auth, data hooks, processing queue). **Start with [`src/v2/README.md`](src/v2/README.md).** |
| `src/pose/` | MediaPipe wrapper, frame planning, One-Euro smoothing, keypoint codec |
| `src/metrics/` | Phase detection and metric definitions, calibration notes |
| `src/data/` | Typed Supabase repository, schema types, export and delete |
| `src/insights/` | Neutral comparison text, progress series, dashboard summary |
| `src/feedback/` | Client for the practice-notes Edge Function |
| `src/api/` | Supabase client and dancer-safe error messages |
| `src/legacyMain.tsx`, `src/pages/`, `src/components/`, `src/mock/`, `src/lib/` | The MT-1 prototype (mock mode, used by the e2e suite) |
| `supabase/migrations/` | Database schema, RLS policies and storage buckets |
| `supabase/functions/` | Edge Functions (Deno) |
| `e2e/` | Playwright specs |
| `docs/pwa.md` | PWA and GitHub Pages notes |

Requirements and design are specified in the project's SRS and SDD (requirement IDs FR-3.x.y and NFR-n are referenced in commit messages).

## Status and known limitations

Working against a real Supabase project: sign-up and sign-in, password reset, consent, dashboard, library, import of local clips, on-device processing, review with the skeleton over the local video, phase-aligned comparison, progress across sessions, export (JSON/CSV), and deletion of data or the whole account.

Not done or not verified:

- **AI features are not connected.** The `generate-feedback` (practice notes) and `mika-chat` (chat assistant) Edge Functions are written and unit-tested but not deployed, and the LLM provider (Gemini or Grok) has not been selected. The screens say so and sending is disabled.
- **Metrics are calibrated on synthetic data only.** On synthetic stick-figure clips the trunk angle reads about 2.7° high, the pelvis-ankle offset about 15% low, and balance duration reads short. Turn counting has not been tested on real MediaPipe output. Accuracy against real recordings still has to be evaluated, separately from the usability evaluation.
- Clips should start with the dancer standing still and contain one attempt; only the first lift in a clip is measured.
- Frame seeking occasionally lands one frame late in Chrome (about 1 frame in 30).
- **Email needs custom SMTP.** Supabase's built-in sender only reaches project team addresses, so password-reset emails won't reach participants, and email confirmation is turned off for the prototype. Configure a custom SMTP provider and turn confirmation back on before a study.
- Android (Capacitor) build not started. The PWA manifest and service worker exist.
- Video backup and in-app recording are disabled.
- The usability-study log needs IRB approval before use with participants.

## License

MIT. See [LICENSE](LICENSE).

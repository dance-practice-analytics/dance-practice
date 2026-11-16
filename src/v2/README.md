# v2 — the MT-2 app

`src/main.tsx` loads this tree when Supabase is configured (`.env.local`) and the old
MT-1 prototype (`src/legacyMain.tsx`, mock data) when it is not. The e2e suite runs the
old tree. The two never share CSS: **nothing under `src/v2/` may import `styles.css`,
`pages.css`, `shell.css`, `motion.css` or any old component from `src/components`,
`src/pages`, `src/state/app.ts`, `src/api/client.ts`.** Pure logic is fine
(`src/data`, `src/pose`, `src/metrics`, `src/api/{supabase,errors,authErrors}.ts`,
`src/state/store.ts`).

Design reference (read-only): the `*.dc.html` files of the design canvas. Each page file
names its design files in its top comment. `States.dc.html` has the empty / loading /
error patterns; `Main.dc.html` shows every component class.

## Folder map

| File | What it is |
| --- | --- |
| `main.tsx` | Entry: loads `fonts.css`, `studio.css`, `v2.css`, mounts `App`. |
| `App.tsx` | Auth gate → consent gate → `Shell` + routed page. No screen logic. |
| `Shell.tsx` | Sidebar (≥ 900px) / bottom nav (< 900px). Pages render inside `<main class="v2-main">`. |
| `router.ts` | Hash routes: `Route`, `href`, `navigate`, `useRoute`, `parseRoute`. |
| `auth.ts` | Supabase auth store: `useAuth`, `signIn`, `signUp`, `signOut`, `client()`. |
| `consents.ts` | `useConsents`, `acceptConsents`, `setConsent` (table `consents`). |
| `theme.ts` | `useTheme`, `useThemePref`, `setThemePref`, `toggleTheme`. |
| `data.ts` | Read hooks: `useLibrary`, `useSessions`, `useAttempts`, `useAttempt`, `useSubjects`, `invalidate`. |
| `clips.ts` | Local videos picked in this tab: `registerClip`, `useClip`, `relink`, … |
| `pipeline.ts` | On-device processing queue: `enqueue`, `pause`, `resume`, `cancel`, `usePipeline`, … |
| `format.ts` | Metric catalogue, labels, number / time formatting, `readMetric`, `frameAt`, `phaseAt`. |
| `useIsNarrow.ts` | `useIsNarrow()` — true under 900px. |
| `components/` | Shared presentational components (import from `../components`). |
| `pages/` | One file per route. Also, outside the router: `ResetPassword` (set a new password after a reset link), `AccountDeleted` (after Settings → Delete account) and `PasswordFields` (shared new-password inputs). |
| `studio.css` | The design stylesheet, verbatim. **Do not edit.** |
| `v2.css` | Shell grid and a few helpers (`v2-` prefix). |

## Replacing a stub page

Each stub in `pages/` is replaced one-for-one: keep the file name and the **named export**
(`export function Library()`), take no props, read the route with `useRoute()`. Do not
edit `App.tsx`, `Shell.tsx`, the router or shared files for one screen's needs — if
something shared is missing, add it in your page file (or a new file next to it, e.g.
`pages/review/Timeline.tsx`) and say so in your report.

A page renders a fragment whose **first child is `<PageHeader>`**; the shell's `<main>`
is a flex column (gap 24px, 16px on phones; padding 28/32/48px, 16px on phones). On
phones `PageHeader` becomes the sticky `.mhead` bar, and it must be a direct child of
`<main>` to span the full width — so don't wrap it in your own container.

```tsx
export function Library() {
  const attempts = useAttempts()
  return (
    <>
      <PageHeader title="Library" mobileTitle="My practice" actions={<PrivacyPill />} />
      {attempts.error && <ErrorAlert error={attempts.error} onRetry={attempts.refetch} />}
      {attempts.loading ? <SkeletonList label="Loading library" />
        : attempts.data?.length === 0 ? <EmptyState icon="review" title="No clips yet" action={…}>…</EmptyState>
        : …}
    </>
  )
}
```

One responsive component per screen: use the wide design by default and the `*Mobile`
design when `useIsNarrow()` is true (or with CSS that wraps, as the designs do).

## Router (`router.ts`)

```ts
type Route =
  | { name: 'signin' } | { name: 'consent' } | { name: 'dashboard' }
  | { name: 'library'; sessionId?: string }        // #/library?session=<id>
  | { name: 'import' } | { name: 'processing' }
  | { name: 'review'; attemptId?: string }         // #/review/<id>, #/review
  | { name: 'compare'; a?: string; b?: string }    // #/compare?a=<id>&b=<id>
  | { name: 'progress' }
  | { name: 'notes'; attemptId?: string }          // #/notes/<id>
  | { name: 'chat'; attemptId?: string }           // #/chat/<id>
  | { name: 'dataset' }                            // researcher only (App redirects a dancer)
  | { name: 'settings' }

href(route): string                 // '#/review/abc' — use for every <a href>
navigate(route, { replace? }): void // replace: true for redirects and filter changes
useRoute(): Route                   // current route, re-renders on change
parseRoute(hash): Route             // unknown hashes → dashboard
```

Links are real `<a href={href({ name: 'review', attemptId })}>`; use `navigate` only
after an action (e.g. after import, go to processing). `#/review` without an id: use
`latestProcessed(attempts)` from `data.ts`, else show the empty state.

## Auth, role, consent, theme

```ts
useAuth(): { status: 'loading'|'signedOut'|'signedIn'; user: { id, email } | null;
             profile: ProfileRow | null; role: 'dancer' | 'researcher';
             recovery: boolean;            // signed in through a reset link → only ResetPassword shows
             linkError: ApiError | null }  // a reset link that failed (expired / used); SignIn shows it
signOut(): Promise<void>
client(): SupabaseClient            // pass to src/data/repo.ts functions
requestPasswordReset(email): Promise<void>   // FR-3.1.3; redirectTo = origin + BASE_URL + '#/reset-password'
updatePassword(pw, { currentPassword? }): Promise<void>  // reset screen, or Settings (checks the current one first)
```

Password recovery: SignIn → "Forgot password?" → `resetPasswordForEmail`. The link in the
email lands with the session in the URL fragment; `src/api/supabase.ts` reads it before
supabase-js clears it (`authLinkAtLoad`, helpers in `src/api/authLink.ts`) and also moves
`#/reset-password#access_token=…` into a form supabase-js understands. `App` shows
`ResetPassword` while `recovery` is true (also after a reload, via sessionStorage); the
`PASSWORD_RECOVERY` event sets it too. Errors go through `authError(e, 'reset' | 'password')`
in `src/api/authErrors.ts`. Redirect URLs are allowed in `supabase/config.toml`
(`site_url`, `additional_redirect_urls`). The built-in mail service only delivers to the
project's team addresses and refuses domains without mail (`email_address_invalid`), so
use a custom SMTP before participants rely on it.

Account deletion: Settings → Delete account (type DELETE) → `deleteAccount(client(), typed)`
in `src/data/deleteData.ts` → Edge Function `supabase/functions/delete-account` (service
role, server side only) → `showAccountDeleted(report)` + `signOut()`; `App` shows
`AccountDeleted` until the user presses Done.

`role` is the real `profiles.role` (read-only for the user; set by hand in the Supabase
dashboard). Don't add a role switch. Pages render only when signed in with both required
consents accepted, so `user` is non-null inside a page.

```ts
useConsents(): { status; granted: ReadonlySet<ConsentScope>; has(scope): boolean;
                 requiredAccepted: boolean; grantedOn(scope): string | null; reload() }
setConsent(scope, granted): Promise<void>   // Settings toggles (throws ApiError)
// scopes: 'on_device_processing' | 'keypoints_and_metrics_storage'   (required)
//         'ai_metrics_only' | 'own_video_upload'                       (optional)
```

Notes / Chat must check `has('ai_metrics_only')` before calling the AI and otherwise
explain how to turn it on in Settings. Upload of a personal video needs
`has('own_video_upload')`.

Theme: `useThemePref()` → `'light' | 'dark' | 'system'`, `setThemePref(pref)`. The class
`dark` is on the `.app` root; all colours come from tokens, so pages need nothing else.

## Data (`data.ts`)

Every hook returns `Loadable<T>`:
`{ data: T | null; loading; refreshing; error: ApiError | null; refetch() }`.
`loading` is true only while there is nothing to show; show `error.message` +
`error.recovery` (both dancer-safe) with `<ErrorAlert>`.

```ts
useSessions(): Loadable<SessionSummary[]>      // newest first; subject_code, attempt_count
useAttempts(sessionId?): Loadable<AttemptView[]>  // all attempts, or one session's
useSubjects(): Loadable<SubjectRow[]>
useLibrary(): Loadable<{ sessions, attempts, subjects }>
useAttempt(id): Loadable<{ attempt: AttemptView; series: PoseSeries | null }> & { notFound }
latestProcessed(attempts): AttemptView | null
invalidate(): void                              // call after ANY write you make

interface AttemptView extends AttemptRow {      // src/data/schema.ts
  session: SessionSummary                       // movement_type, camera_view, recorded_on, subject_code, title
  metrics: AttemptMetricsRow | null             // null = not processed yet
  number: number                                // 1-based within its session → "Attempt 3"
}
```

All hooks share one cached load, refreshed by `invalidate()` and automatically when the
pipeline finishes an attempt. Writes go straight to `src/data/repo.ts` with `client()`
(`ensureSubject`, `createSession`, `createStudyAttempts`, `deleteAttempt`,
`deleteSession`, …), then `invalidate()`. `series` in `useAttempt` is the smoothed
`PoseSeries` (`src/pose/types.ts`) from the in-memory cache or the `keypoints` bucket;
it is `null` when the attempt has no keypoints yet. Frames inside can be gaps
(`frame.image === null`).

Reading metrics — never read the columns and format by hand:

```ts
readMetrics(attempt.metrics, attempt.session.movement_type): MetricReading[]
readMetric(row, key): { key, def, value: number | null, confidence: 'high'|'medium'|'low'|'none',
                        score, phases: Phase[], reason: string | null, notes: string[] }
```

`value === null` always comes with a `reason` sentence. Show the gap; never 0.

## Clips (`clips.ts`) — local video only

Study clips are never uploaded, so the video exists only as a `File` in this tab. After
a reload the registry is empty while keypoints and metrics remain in Supabase.

```ts
registerClip(attemptId, file): { file, objectUrl }   // Import calls this for every created attempt
useClip(attemptId): { file, objectUrl } | null       // Review/Compare: null → skeleton only + "Choose the file again"
relink(file, attempts): Promise<string | null>       // re-picked file → attempt id by SHA-256, registers it
releaseClip(attemptId)                               // after deleting an attempt
```

`objectUrl` goes to `<VideoStage src>`. Nothing in v2 may send a file, a frame or a
canvas capture anywhere.

## Pipeline (`pipeline.ts`)

```ts
enqueue(jobs: { attemptId, movement, clipName? }[])  // clip must be registered first; starts at once
pause() / resume()        // pause holds the queue after the clip in progress finishes
cancel(attemptId?)        // one attempt, or everything queued/running; DB status goes back to 'queued'
clearFinished()
usePipeline(): { items: PipelineItem[]; paused; activeId; delegate: 'GPU'|'CPU'|null }
usePipelineItem(attemptId): PipelineItem | null
onAttemptFinished(cb)     // data.ts already uses this to refresh; you rarely need it
getCachedSeries(attemptId): PoseSeries | null

interface PipelineItem { attemptId; movement; clipName?;
  status: 'queued'|'processing'|'done'|'failed'|'cancelled';
  step: 'loading_model'|'pose'|'saving_keypoints'|'metrics'|null;
  fraction: number;            // 0..1 of the pose step
  reason: string | null; recovery: string | null;   // dancer-safe, when failed
  frames: number | null; trackedFrames: number | null; startedAt; finishedAt }
```

Per attempt: status `processing` → `estimatePose` → `smoothSeries` → `encodeSeries` →
`uploadKeypoints` → `computeMetrics` → `saveMetrics` → status `done`; on failure status
`failed` with the reason saved in `attempts.error`. One clip at a time, on the main
thread with yields. The queue lives in memory: after a reload, attempts still `queued`
in the database need their file again (`relink`) before `enqueue`. An attempt left as
`processing` in the database by a closed tab is stale — treat it as queued.

A clip in which no person is found finishes as **done** with `trackedFrames === 0` and
every metric null (reason "No person was found in this clip…"); show that, don't hide it.

## Shared components (`components/`, import from `'../components'`)

No component fetches data. All copy is passed in.

- **`Icon`** `{ name: IconName; size?: number; label?: string; style?; className? }` —
  stroke icons of the designs. Names: `home library import processing review compare
  progress notes chat dataset settings device lock warning info clock filter search plus
  close check trash copy refresh download upload mail camera sign-out sun moon
  chevron-left chevron-right chevron-down arrow-right play pause step-forward step-back`.
  Inside `.btn`, `.privacy`, `.chip`, `.tag`, `.alert`, `.note-box`, `.sidenav` the CSS
  sizes it; elsewhere pass `size`. `label` makes it non-decorative.
- **`Logo`** `{ size?: number }` — the app mark.
- **`MetricFigure`** `{ metric; size? }` — the small drawing of what a metric measures;
  `MetricCard` shows it under "What is this?" when given `info` (`metricCardProps` sets it).
- **Simple / Detail** (`viewMode.tsx`: `useViewMode()`, `<ViewModeSwitch />`) — Simple is
  the default for dancers; Detail adds frame-by-frame traces, phase tags and B − A arithmetic
  on Review and Compare. Metric names and units for dancers live in `src/insights/catalog.ts`
  (`label`, `unit`, `description`; `scale`/`displayDecimals` turn the leg-length ratio into a
  percent on screen). Exports keep the stored values and technical units.
- **`PageHeader`** `{ title; mobileTitle?; eyebrow?: ReactNode; subtitle?: ReactNode;
  actions?: ReactNode; mobileActions?: ReactNode; backHref?: string }` — desktop header
  row (string `eyebrow` → `.t-label`; a node → small subtle line, e.g. a breadcrumb) or
  the phone `.mhead` bar (eyebrow as caption above `h1.t-h2`; `mobileActions` on the
  right; `backHref` adds a back chevron).
- **`VideoStage`** `{ src?: string | null; frame?: PoseFrame | null; ghostFrame?:
  PoseFrame | null; width?: number; height?: number; videoRef?: Ref<HTMLVideoElement>;
  videoProps?: VideoHTMLAttributes; showSkeleton?: boolean; label?; view?; timecode?;
  phase?; privacy?: string | false; chrome?: boolean; noTrackingLabel?; ariaLabel?;
  placeholder?: ReactNode; children?; style? }` — dark stage. With `src` it plays the
  local video (muted, `playsInline`; you drive it through `videoRef`: `play()`,
  `pause()`, `currentTime`) and draws the skeleton from `frame.image` as SVG scaled to
  the video box (`width`/`height` = `series.width/height`). Without `src` the skeleton
  is drawn alone. `frame` semantics: a frame with landmarks → skeleton (segments and
  joints under 0.6 visibility dashed / hollow); `null` or a gap frame → **no skeleton
  and a "No tracking" pill**; `undefined` → no overlay. `ghostFrame` draws a second,
  dashed skeleton (Compare: A behind B). Pills: `label` (top-left), privacy pill, `view`
  (top-right), `timecode` (bottom-left, mono), `phase` (bottom-right); `chrome={false}`
  hides them. Typical use:
  `frame={frameAt(series, t)} timecode={`${formatTimecode(t)} / ${formatTimecode(series.durationS)}`}
  phase={PHASE_LABELS[phaseAt(metrics.phases, t)?.phase]}` with `t` from the video's
  `timeupdate` / `requestVideoFrameCallback` (keep the per-frame state in a small
  component so the whole page doesn't re-render at 30 fps).
- **`MetricCard`** `{ name; value: number | null; unit?; decimals?; confidence?:
  'high'|'medium'|'low'|'none'; phase?; meta?: ReactNode; delta?: ReactNode; reason?:
  ReactNode; selected?; onSelect? }` — `.metric`. `value === null` renders the `is-none`
  variant: "—", "No tracking" badge and the hatched `reason`. `confidence: 'low'` gives
  the dashed `is-low` card. `onSelect` makes it a button. Use
  `<MetricCard {...metricCardProps(reading)} delta={differenceText(…)} />`.
- **`ConfBadge`** `{ level: 'high'|'medium'|'low'|'none'; label? }` — `.conf` bars + word.
- **`StatusPill`** `{ status: 'queued'|'processing'|'done'|'failed'|'cancelled'; label? }`.
- **`PrivacyPill`** `{ children?; onStage?; style? }` — default text "Processed on this
  device, not uploaded".
- **`EmptyState`** `{ icon: IconName; title; children?; action?: ReactNode; bare?; style? }`.
- **`Alert`** `{ title?; children?; actions?: ReactNode; role?: 'alert' | 'status' }` and
  **`ErrorAlert`** `{ error: { message; recovery? }; onRetry? }` for a caught `ApiError`.
- **`NoteBox`** `{ title?; children?; icon?: IconName }` — quiet information.
- **`Skeleton`** `{ width?; height?; radius?; style? }`, **`SkeletonList`** `{ rows?; label? }`,
  **`SkeletonWorkspace`** `{ caption?; label? }`, **`Spinner`** `{ size? }`.

## Formatting (`format.ts`)

`METRICS[key]` → `{ label, unit, unitShort, decimals, description, less, more, movements }`
for the five `attempt_metrics` columns; `metricsFor(movement)` (turn count is pirouette
only). `formatNumber`, `formatMetric`, `formatMetricWithUnit` (`'4.2°'`),
`formatSeconds` (`'8.4 s'`), `formatTimecode` (`'00:03.48'`), `formatDate` (`'Nov 4'`),
`formatDateTime`, `formatBytes`. Every formatter returns `'—'` for null — never `0`.
`differenceText(key, value, other, 'attempt 2')` → `'2.1° lower than attempt 2'` or
`null` across a gap. Labels: `MOVEMENT_LABELS`, `VIEW_LABELS`, `PHASE_LABELS`,
`STATUS_LABELS`, `CONFIDENCE_LABELS`, `NULL_REASON_TEXT`. Pose lookups:
`frameAt(series, t)`, `phaseAt(phases, t)`, `trackedFrames(series)`.

The catalogue itself lives in `src/insights/catalog.ts` (`METRIC_CATALOG`, `roundValue`,
`formatValue`, `formatDifference`); `format.ts` re-uses it, so there is one rounding
rule: differences are computed on the rounded values that are on screen.

## Other libraries to use (built and tested; don't rewrite, don't edit)

- `src/insights/` (import from `'../../insights'`): `compareAttempts(a, b, labels)` →
  per-metric comparison with neutral sentences and "not compared" reasons (Compare);
  `progressSeries(…)`, `changeBetweenSessions`, `pickView`, `gapText`, `exclusionText`
  (Progress); `dashboardSummary(…)` (Dashboard). Read each file's header for the input
  shape; `AttemptView` from `data.ts` carries the fields they need.
- `src/data/exportData.ts`: `exportAll(client(), options)`, `exportMetricsCsv(client())`;
  `src/data/deleteData.ts`: `deleteAttemptData`, `deleteSessionData`, `deleteAllMyData`
  (each returns a `DeleteReport`). Settings and Library use these; call `invalidate()`
  and `releaseClip()` afterwards. `deleteAccount(client(), typed)` calls the Edge Function
  `delete-account` and returns its `DeleteAccountReport` (files, rows and the auth user).
- `src/feedback/client.ts`: `generateFeedback(…)`, `listFeedback(client(), attemptId)`,
  `AI_CONSENT_SCOPE` (= `'ai_metrics_only'`), `DISCLAIMER`. The Edge Function is not
  deployed yet: handle its `FeedbackError` with the designed error state.
- PWA: `public/sw.js` + `register-sw.js` are wired in `index.html`; a page may listen
  for the `dpa:update-ready` window event. Leave those files and `vite.config.ts` alone.

## CSS rules

- Use the design classes (`.btn .btn-primary`, `.card`, `.seg`, `.field`, `.input`,
  `.chip`, `.tag`, `.subj`, `.ribbon/.phase`, `.track`, `.band-low`, `.bar`, `.tbl`,
  `.cell`, `.attempt`, `.choice`, `.drop`, `.dialog`, `.hatch`, `.t-*`, `.mono`, `.muted`,
  `.subtle`, …) and tokens (`var(--surface)`, `var(--line)`, `var(--text-2)`,
  `var(--accent)`, …). Inline styles copied from the design markup are fine.
- No hex colours outside the video stage; no new tokens; never edit `studio.css`.
- A new global class needs the `v2-` prefix and goes in a CSS file of your own screen
  (e.g. `pages/review.css`, imported by the page), not in `v2.css`.
- Helpers already in `v2.css`: `v2-clip` (ellipsis), `v2-sr` (screen-reader only),
  `v2-only-wide` / `v2-only-narrow`.
- Links styled as buttons (`<a class="btn btn-primary">`) are supported; `v2.css`
  restores their colours over `.app a`.
- Charts: SVG by hand or Recharts, in tokens; one neutral series colour plus the accent.

## Hard rules (from CLAUDE.md — they apply to every screen)

- **Never grade technique.** Values and neutral differences between the dancer's own
  attempts only. No scores, no red/green good/bad, no rankings, no radar charts. Status
  and confidence are told apart by shape and words, not hue.
- **Gaps stay gaps.** Missing or low-confidence tracking is a gap, a dashed line or a
  hatched band with its reason — never interpolated, never 0. The skeleton is only ever
  drawn from pose data.
- **Video never leaves the device.** Study clips are local files (blob URLs); nothing in
  v2 sends video, frames or canvas captures anywhere. Only the publishable key is in the
  browser; no service-role key; no new env vars. Claude is called only from the Edge
  Function `generate-feedback`, with metrics JSON only.
- **No real people.** Subjects are codes S01–S12; no names, no real footage, no
  participant data in the repo, in fixtures or in screenshots.
- UI copy in English, taken from the designs where it exists. Sample values in the
  designs (S04, 4.2°, file names) are placeholders — render real data or an empty state.
- Accessibility as designed: real buttons / links / labels, `aria-current` on nav,
  visible focus, `aria-pressed` / `aria-selected` on toggles and tabs.
- Code style: no semicolons, 2 spaces, single quotes, short comments that say why.
- Verify with `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, and
  `npx playwright test` (old tree; must stay green).

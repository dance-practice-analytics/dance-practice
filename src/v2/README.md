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
| `Shell.tsx` | Sidebar (≥ 900px) / bottom nav (< 900px). Pages render inside `<main class="v2-main">`. Sidebar: Dashboard, Library, Import, Review, Compare, Progress, Practice notes, Mika, (Study dataset), Settings & data. The phone bar is Home, Library, Mika (raised centre button), Import, Progress; the open slot gets a lime pill with a navy icon, and Review / Compare / Practice notes light up Library. Settings is the gear at the top right of every phone header (`PageHeader` adds it). Processing shows under Import only while the queue has clips (with a count) or while it is open; the phone bar shows the count on Import. |
| `router.ts` | Hash routes: `Route`, `href`, `navigate`, `useRoute`, `parseRoute`. |
| `auth.ts` | Supabase auth store: `useAuth`, `signIn`, `signUp`, `signOut`, `client()`. |
| `consents.ts` | `useConsents`, `acceptConsents`, `setConsent` (table `consents`). |
| `theme.ts` | `useTheme`, `useThemePref`, `setThemePref`, `toggleTheme`. |
| `data.ts` | Read hooks: `useLibrary`, `useSessions`, `useAttempts`, `useAttempt`, `useSubjects`, `invalidate`. |
| `clips.ts` | Local videos picked in this tab: `registerClip`, `useClip`, `relink`, … |
| `pipeline.ts` | On-device processing queue: `enqueue`, `pause`, `resume`, `cancel`, `usePipeline`, … |
| `format.ts` | Metric catalogue, labels, number / time formatting, `readMetric`, `frameAt`, `phaseAt`. |
| `useIsNarrow.ts` | `useIsNarrow()` — true under 900px. |
| `focus.ts` | `useFocusThemes()`, `saveFocus(themes)`: the dancer's up to three phrase focus themes (table `user_preferences`, owner-only RLS). |
| `components/` | Shared presentational components (import from `../components`). |
| `pages/` | One file per route. Also, outside the router: `ResetPassword` (set a new password after a reset link), `AccountDeleted` (after Settings → Delete account) and `PasswordFields` (shared new-password inputs). |
| `studio.css` | The design stylesheet. Components verbatim; the tokens at the top follow the brand palette of the landing page (navy, cloud, lime). Change colours only through the tokens. |
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
      <PageHeader title="Library" mobileTitle="My practice" />
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
enqueue(jobs: { attemptId, movement, clipName?, trim? }[])  // clip must be registered first; starts at once
                          // trim (FR-3.2.7) = attemptTrim(attempt) from src/data/repo.ts; pass it on every re-run
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

Offline upload queue (FR-3.8.6, `offline/uploadQueue.ts` over the small IndexedDB wrapper
`offline/idb.ts`): when the save fails on the network (offline, fetch error, 5xx, 429), the
result — gzipped keypoints bytes, the metrics row, attempt id and owner id, never the video —
is kept in IndexedDB and the item finishes `done` with `pendingUpload: true`. It is retried
on the `online` event, when the app opens signed in (`App.tsx`) and from "Retry now" on
Processing (`pages/processing/OfflineNotice.tsx`); the sidebar shows "n results waiting to
upload" and the phone's Import badge counts them. Retries use the same repo functions
(`uploadKeypoints` → `saveMetrics` → `setAttemptStatus('done')`) and only touch entries of
the signed-in user. Validation / permission / not-found errors are never queued (a kept
entry that hits one is dropped). `signOut()` and `resetPipeline()` (sign-out, delete all,
delete account) clear the queue. Hooks: `useOfflineQueue()` → `{ ids, flushing, lastError,
unavailable }`, `flushQueue()`. Tests: `offline/uploadQueue.test.ts` (fake-indexeddb).

A clip in which no person is found in more than half of the frames (FR-3.3.8,
`mostlyUntracked`) finishes as **failed** with the reason "No person was found in most of
this clip…" and nothing is stored; show that reason, don't hide it.

Trim (FR-3.2.7): Import can set a start / end per clip (`pages/import/TrimEditor.tsx`,
stored in `attempts.trim_start_s/trim_end_s`). Only that part is processed, but frame
times stay those of the original clip and `series.durationS` stays the whole clip;
`series.trim` says which part was processed. `frameAt` returns null outside it and the
Review timeline shows it as a `trimmed` band, so Review and relinking need no offset.

Camera position (`sessions.camera_view`): where the one camera stood, set at import. The stage
pill says "Filmed from: Diagonal" (`filmedFromLabel` in `pages/review/StageInfo.tsx`); under
the Review stage `StageInfo` explains it can't be turned and lets the dancer correct it
(`updateSession(client(), id, { camera_view })`, the whole session). Metrics don't depend on
it; Compare, Progress and Mika's phrase progress group by it. The same block says why only
the skeleton shows when the video isn't on this device.

Reference attempt (FR-3.6.6): `attempts.is_reference`, one per movement and subject (a
trigger clears the previous one). `setReferenceAttempt(client(), id, on)` then
`invalidate()`. Compare's default A is the reference (`choosePair` in
`pages/compare/pick.ts`); Review, Library and the Compare pickers show a neutral
"Reference" tag (`pages/review/ReferenceToggle.tsx`). Never call it "best".

## Phrase attempts (movement `phrase`)

A phrase is a longer combination (folds, leg gestures, turns, arm circles). The pipeline
calls `computeAttempt` (`src/metrics/attempt.ts`): for `phrase` it stores the five relevé
columns as null (`not_applicable`) and the versioned result of `computePhrase`
(`src/metrics/phrase.ts`, `mt2-phrase-x.y.z`) in `attempt_metrics.phrase` (jsonb,
migration `20261117020000_phrase.sql`): an events timeline (leg gestures with side, height,
direction and knees; folds; turns; rises; pliés) and six theme measures, each a value +
confidence or null + reason. Swapped left/right labels lower the confidence of side-dependent
themes (`left_right_labels_uncertain`) and mark events `side_uncertain`.

- `pages/phrase/model.ts`: theme catalogue (names, units, "What does this mean?", best views),
  `readTheme`, neutral `themeDifference` / `compareThemes`, event labels and lanes, focus order.
- `pages/phrase/PhraseTimeline.tsx`: the event strip (Review under the stage, Compare for A and B);
  a click seeks the clock. `ThemeCards.tsx` (Review), `PhraseDifferences.tsx` (Compare).
- Compare lines two phrase attempts up on matched events (`alignPhrases` in
  `src/metrics/phraseAlign.ts` → `buildEventTimeMap` in `compare/align.ts`).
- Progress (`progress/phraseModel.ts`, `PhraseProgress.tsx`) and the Dashboard
  (`dashboard/PhraseTiles.tsx`) chart phrase themes only against phrase attempts.
- Import reads `D01_att3_d.mp4`-style names (view letter f/s/d) as a phrase.
- Phone: `PhraseTimeline compact` has 44 px events (at least 24 px wide), a 56 px label
  column and three axis labels; theme cards are one per row under 420 px. Library tiles
  read a phrase's themes for "Done / Hard to see / Not seen" (`tileKind`); the Library
  trend card is relevé / pirouette only.
- Compare on a phone (relevé, pirouette) adds a phase list under the ribbons (A and B
  lengths, tap to seek), since short phases are only slivers on the shared time axis.

## Shared components (`components/`, import from `'../components'`)

No component fetches data. All copy is passed in.

- **`Icon`** `{ name: IconName; size?: number; label?: string; style?; className? }` —
  stroke icons of the designs. Names: `home library import processing review compare
  progress notes chat dataset settings device lock warning info help clock filter search plus
  close check trash copy refresh download upload mail camera sign-out sun moon
  chevron-left chevron-right chevron-down arrow-right play pause step-forward step-back`.
  Inside `.btn`, `.privacy`, `.chip`, `.tag`, `.alert`, `.note-box`, `.sidenav` the CSS
  sizes it; elsewhere pass `size`. `label` makes it non-decorative.
- **`Logo`** `{ size?: number }` — the app mark.
- **`MetricFigure`** `{ metric; size? }` — the small drawing of what a metric measures;
  `MetricCard` shows it under "What does this mean?" when given `info` (`metricCardProps` sets it).
- **`InfoDisclosure`** `{ children; label?; about? }` — the "What does this mean?" pill (help
  icon, chevron, 44 px on phones) that opens a short explanation in place. Used by
  `MetricCard` and the phrase `ThemeCard`; both take `askHref` (Review passes the chat route)
  for an "Ask Mika about this" link under the explanation.
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
- **`AttemptThumb`** `{ attempt; draw?; className?; style?; children? }` — the dark `.thumb`
  tile with one skeleton frame from the attempt's keypoints. Fetched once near the screen,
  two at a time (a keypoints file is ~300 KB and can take seconds on a phone network);
  the reduced 33-point pose is kept in memory and in this tab's sessionStorage, so a
  reload doesn't refetch. Shimmers while loading, retries once, never invents a pose.
- **`MetricCard`** `{ name; value: number | null; unit?; decimals?; confidence?:
  'high'|'medium'|'low'|'none'; phase?; meta?: ReactNode; delta?: ReactNode; reason?:
  ReactNode; selected?; onSelect? }` — `.metric`. `value === null` renders the `is-none`
  variant: "—", "No tracking" badge and the hatched `reason`. `confidence: 'low'` gives
  the dashed `is-low` card. `onSelect` makes it a button. Use
  `<MetricCard {...metricCardProps(reading)} delta={differenceText(…)} />`.
- **`ConfBadge`** `{ level: 'high'|'medium'|'low'|'none'; label? }` — `.conf` bars + word.
- **`StatusPill`** `{ status: 'queued'|'processing'|'done'|'failed'|'cancelled'; label? }`.
- **`PrivacyPill`** `{ children?; onStage?; style? }` — default text "Processed on this
  device, not uploaded". Use it only where the on-device decision or video is in view
  (Import, Processing, the video stage); list pages rely on the one sidebar line.
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

## Mika (AI practice chat)

`pages/Chat.tsx` talks to the Edge Function `supabase/functions/mika-chat` through
`pages/chat/mikaClient.ts`:

```ts
mikaStatus(client()): Promise<boolean>          // GET: deployed and has its API key? No question sent.
askMika(client(), { attemptId, compareAttemptId?, scope?, messages }): Promise<string>
isNotConnected(e)                                // 404 (not deployed) or missing/rejected key
// throws MikaError (an ApiError): message + recovery are dancer-safe (copy in contract.ts)
```

- The function verifies the caller's JWT and queries with it (RLS applies), checks the
  `ai_metrics_only` consent, loads the attempt's `attempt_metrics` row (plus the
  comparison attempt, or every attempt of the session for scope `session`) and sends
  the configured model (Gemini or Grok, see "AI provider" below) metric values, units,
  confidence and null reasons only, labelled "Attempt N" (phrase attempts: see below). Never keypoints, frames, video, titles, file names
  or subject codes. The system prompt is in `mika-chat/prompt.ts` (answers only from
  the numbers, neutral differences, never grades, no medical advice, short).
- The screen sends the last 12 messages (questions ≤ 1000 characters); in scope
  `attempt` it compares with the previous analyzed attempt of the session. Nothing is
  stored: the conversation lives in the page and is gone on reload or "New conversation".
- Before the function is deployed (404), while `LLM_API_KEY`, `LLM_BASE_URL` or
  `LLM_MODEL` is unset, or when the provider rejects the key, the screen shows "Mika isn't connected yet" and sending stays off. Without the consent,
  it points to Settings.
- Rate limit: 30 questions per user per hour, counted **in the memory of each function
  instance** (no table fits and the schema is unchanged). A cold start resets it and two
  instances count separately; it stops a runaway client, it is not a hard quota.
- Tests: `pages/chat/mika.test.ts` (validation, context, prompt, rate limit, handler with
  fakes, client). `index.ts` is the Deno wiring and is not run by Vitest.

### Phrase attempts in the AI features (prompts `practice-notes-v2`, `mika-v2`)

For a `phrase` attempt both functions send, instead of the relevé metrics
(`supabase/functions/_shared/phrase.ts`, allowlisted and rounded like `buildPayload`):

- the six theme values with unit, confidence, notes (`left_right_labels_uncertain`,
  `few_pairs`) and the null reason;
- an event summary: counts per kind and at most one main event per role (main leg
  extension, largest turn, deepest plié, largest tilt, longest relevé) with start/end
  seconds and allowlisted values; `side_uncertain` events keep the flag;
- the same theme values of up to 3 earlier attempts of the session;
- **progress**: theme medians of up to 5 earlier sessions of the same phrase, camera view and
  dancer (subject), oldest first (`sessions_before`), from high/medium values only, with
  counts of uncertain values left out and of gaps. Loaded by `_shared/phraseContext.ts` with
  the caller's JWT and an explicit `owner_id` filter on every query; a session without a
  camera view gets no progress. Only `phrase->themes` is read from earlier rows;
- the dancer's **focus themes** (`user_preferences`, up to 3).

Never sent: titles, notes, dates, labels, file names, subject codes, ids, keypoints, video.
Practice notes also take an optional `language` (the browser's, `en es fr pt de it`); it is
added to the payload only when not English. The prompts explain each theme in dance-class
words, ask for neutral change over time ("your arm reach went from 1.27 to 1.33 arm lengths
across three sessions"), suggestions as options for attention tied to the focus themes, and
say that uncertain values are named as uncertain and not interpreted. Relevé payloads are
unchanged. `validate.ts` rejects notes with scores, grades or verdict words (good/bad,
better/worse, correct/incorrect, improved, perfect…, English and Spanish) for every movement;
a rejected note is `model_invalid_output` (try again). Mika's free-text answers are not
filtered.

On screen: Notes' "What is sent" lists the phrase payload plus "This attempt / Progress /
Focus" lines (`phraseShare`, `progressLine`, `focusLine` in `pages/notes/model.ts`, built
with the function's own code from the attempts already loaded); Mika's "What is shared"
panel shows theme rows (focus first) and the same event, progress and focus lines. Both keep
the "not connected" state until the functions are deployed. Tests: `src/feedback/phrase.test.ts`
(payload allowlist, fake-DB progress with owner/view/dancer filters, focus, handlers,
prompts, grading words, panels).

## AI provider (practice notes and Mika)

Both Edge Functions call the model through `supabase/functions/_shared/llm.ts`: one
`fetch` client for the OpenAI-compatible Chat Completions API (`POST {LLM_BASE_URL}/chat/completions`,
`Authorization: Bearer {LLM_API_KEY}`), no SDK. The project does not use Anthropic. Google
Gemini and xAI Grok both work; which one is used is decided only by three Supabase secrets:

| Secret | Gemini | Grok (xAI) |
| --- | --- | --- |
| `LLM_API_KEY` | key from Google AI Studio | key from console.x.ai |
| `LLM_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai/` | `https://api.x.ai/v1` |
| `LLM_MODEL` | `gemini-3.8-flash` | `grok-4.7` |

- Practice notes ask for `response_format: { type: "json_schema", strict: true }` with the
  `FeedbackResponse` schema; the validator in `generate-feedback/validate.ts` checks every
  answer anyway (schema adherence is best-effort on some providers). If a provider rejects
  that mode, set `LLM_JSON_MODE=json_object`. Mika gets plain text.
- `finish_reason`: `stop` is read; `length` → "incomplete" (`model_truncated`);
  `content_filter`/safety or a `refusal` field → `model_refused`; anything else →
  `model_invalid_output`. 401/403 (or Gemini's 400 "API key not valid") → not configured /
  not connected. 429 and 5xx get one retry within the 30-second budget, then "busy".
- Optional secrets: `LLM_PROVIDER` (log label), `LLM_JSON_MODE=json_object`,
  `LLM_REASONING_EFFORT` (e.g. `low`; not sent unless set), `ALLOWED_ORIGINS`.
- Only metrics JSON and the dancer's questions reach the provider, never keypoints,
  frames or video. Changing `LLM_MODEL` changes the practice-notes cache key.
- Tests: `src/feedback/llm.test.ts` (fake `fetch`: success, `length`, content filter,
  429 retry, 5xx, network, bad key, timeout, missing config).

### Deploy

Run these yourself in your own terminal (never paste the key into a chat or a file in the
repo). Pick one provider:

```
# Gemini
npx supabase secrets set LLM_API_KEY=<gemini-key> LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/ LLM_MODEL=gemini-3.8-flash

# or Grok
npx supabase secrets set LLM_API_KEY=<xai-key> LLM_BASE_URL=https://api.x.ai/v1 LLM_MODEL=grok-4.7
```

Then deploy both functions (the shared module is bundled with each):

```
npx supabase functions deploy generate-feedback --use-api
npx supabase functions deploy mika-chat --use-api
```

`--use-api` bundles on Supabase's side (no Docker). Keep JWT verification on (no
`--no-verify-jwt`). Switching provider later only needs `secrets set` again; secrets
apply without a redeploy. Logs: `npx supabase functions logs mika-chat` (failure codes,
provider label and finish reason only). If an old `ANTHROPIC_API_KEY` secret exists it is
no longer read: `npx supabase secrets unset ANTHROPIC_API_KEY`.

## Android app (Capacitor, FR-3.8.x)

The same web build runs in a Capacitor 8 shell (`capacitor.config.ts`: app id
`edu.kennesaw.dancepractice`, name "Dance Practice", `webDir: 'dist'`, `androidScheme:
'https'`). The WebView serves the app from `https://localhost`, which the Edge Functions'
CORS list (`supabase/functions/generate-feedback/cors.ts`) already allows. The native
project is `android/` (checked in; its `build/`, `.gradle/`, `local.properties` and the
copied web assets are git-ignored and regenerated by `cap sync`).

```
npm run cap:sync        # typecheck + vite build --base / + drop dist/clips + npx cap sync android
npm run android:build   # the above + gradlew assembleDebug + gradlew --stop
npx cap open android    # open the project in Android Studio
```

The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk` (debug-signed with
the SDK's debug key; there is no release key in this repo; about 17 MB, of which the
model and WASM are ~24 MB uncompressed). Needs JDK 21 or newer (`JAVA_HOME`; first built
with JDK 22 + Gradle 8.14.3 + AGP 8.13) and the Android SDK (platform 36, build-tools
35.0.0; `ANDROID_HOME` or `android/local.properties` with `sdk.dir=…`). Without Android
Studio, the SDK command-line tools are enough: `sdkmanager "platforms/android-36"
"build-tools/35.0.0" "platform-tools"`. `android/gradle.properties` caps the Gradle daemon at 2 GB and two
workers; the script stops the daemon after the build.

- The build always uses base `/` (`--base /` beats a `BASE_PATH` left in the shell), so
  `MODEL_URL_LOCAL` resolves to `https://localhost/mediapipe/pose_landmarker_full.task`
  and the WASM runtime is a hashed file under `assets/`: both ship inside the APK, no
  download at first run. GPU delegate first, CPU fallback, as in the browser.
- Supabase URL and publishable key are read from `.env.local` at build time, exactly like
  the web build. Nothing else is baked in.
- Import uses the standard `<input type="file">`; Capacitor's WebView opens the system
  picker, which needs no storage permission. No camera permission either (Record is
  off). The manifest asks for `INTERNET` only and sets `allowBackup="false"`, so the
  WebView's session token and the offline upload queue are not copied to cloud backups.
- `public/register-sw.js` skips the service worker inside Capacitor (`window.Capacitor`).
- Password-reset links open the web app (`site_url`), not the APK; deep links are not set up.

## Testing

- `npx vitest run` — unit tests (`src/**/*.test.ts`).
- `npm run e2e` — Playwright against the **old** tree on the mock (port 5180, Supabase env
  blanked). Must stay green.
- `npm run e2e:v2` — smoke tests of **this** app against the real Supabase project
  (`playwright.v2.config.ts`, specs in `e2e-v2/`). Builds into `dist-e2e-v2/` and serves it
  with `vite preview` on port 5190, signs in as `TEST_ACCOUNT_EMAIL` /
  `TEST_ACCOUNT_PASSWORD` from `.env.local` (read in the test only). Without those or the
  Supabase env every test is skipped and no server starts. Read-only except the Review
  note, which is written and then restored; never deletes, never changes the password,
  never sends to Mika. One worker; desktop 1440×900 plus a 390×844 phone project.
- `npm run check:rls` — FR-3.1.5 two-user RLS check (`scripts/rls-check.mjs`): the test
  account and a throwaway account it creates try to read, update, delete and insert each
  other's rows and keypoint files; prints a PASS/FAIL table and deletes the throwaway
  account through `delete-account`. Mutating probes only target rows made for the run.

## CSS rules

- Use the design classes (`.btn .btn-primary`, `.card`, `.seg`, `.field`, `.input`,
  `.chip`, `.tag`, `.subj`, `.ribbon/.phase`, `.track`, `.band-low`, `.bar`, `.tbl`,
  `.cell`, `.attempt`, `.choice`, `.drop`, `.dialog`, `.hatch`, `.t-*`, `.mono`, `.muted`,
  `.subtle`, …) and tokens (`var(--surface)`, `var(--line)`, `var(--text-2)`,
  `var(--accent)`, …). Inline styles copied from the design markup are fine.
- No hex colours outside the video stage; use the tokens in `studio.css` (`--series`, `--series-a/-b`, `--measure`, `--focus`, `--stage-*`, `--lime`/`--navy` for the logo only). Lime is never text or a thin line on white, and never means "good" or "better".
- A new global class needs the `v2-` prefix and goes in a CSS file of your own screen
  (e.g. `pages/review.css`, imported by the page), not in `v2.css`.
- Helpers already in `v2.css`: `v2-clip` (ellipsis), `v2-sr` (screen-reader only),
  `v2-only-wide` / `v2-only-narrow`.
- Links styled as buttons (`<a class="btn btn-primary">`) are supported; `v2.css`
  restores their colours over `.app a`.
- Charts: SVG by hand or Recharts, in tokens; one neutral colour plus `--series` (Compare: `--series-a` dashed, `--series-b` solid).

## Hard rules (from CLAUDE.md — they apply to every screen)

- **Never grade technique.** Values and neutral differences between the dancer's own
  attempts only. No scores, no red/green good/bad, no rankings, no radar charts. Status
  and confidence are told apart by shape and words, not hue.
- **Gaps stay gaps.** Missing or low-confidence tracking is a gap, a dashed line or a
  hatched band with its reason — never interpolated, never 0. The skeleton is only ever
  drawn from pose data.
- **Video never leaves the device.** Study clips are local files (blob URLs); nothing in
  v2 sends video, frames or canvas captures anywhere. Only the publishable key is in the
  browser; no service-role key; no new env vars. The AI model (Gemini or Grok) is called
  only from the Edge Functions `generate-feedback` and `mika-chat`, with metrics JSON only.
- **No real people.** Subjects are codes S01–S12; no names, no real footage, no
  participant data in the repo, in fixtures or in screenshots.
- UI copy in English, taken from the designs where it exists. Sample values in the
  designs (S04, 4.2°, file names) are placeholders — render real data or an empty state.
- Accessibility as designed: real buttons / links / labels, `aria-current` on nav,
  visible focus, `aria-pressed` / `aria-selected` on toggles and tabs.
- Code style: no semicolons, 2 spaces, single quotes, short comments that say why.
- Verify with `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, and
  `npx playwright test` (old tree; must stay green).

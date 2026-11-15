# Practice Studio

Frontend prototype of the Dance Analytics Dashboard (CS 4850, Team 2, MT-1 HCI). It runs entirely on a synthetic practice session, so no real footage or study data is involved.

```
npm install
npm run dev
```

Open http://localhost:5173.

Sign in with any participant code like `P07` and the passcode `practice`. With no `VITE_DAD_API_URL`, a mock API in the browser stores sessions in localStorage and generates synthetic pose data.

## The flow

1. **Sign in** by participant code. No names are stored with practice data.
2. **Practice journal**: past sessions with their goal, the shape of each practice (heel height with attempts shaded) and the reflection, plus a strip plot of one measurement across sessions. Only front-view sessions are compared; the rest are hatched and labelled.
3. **New session**: goal, camera setup checklist with a framing guide, recording conditions, the clip (checked in the browser first) and the footage-permission confirmation.
4. **Processing**: upload the pose export, follow the job stage by stage, and read the import report (coverage, gaps, warnings). A mismatched export shows a typed error with a recovery step.
5. **Confirm attempts**: attempt and phase boundaries are suggested from heel and hip height. Check each one with keyframe thumbnails, nudge by frames (`[` `]`) or drag on the signal, add or remove attempts, then confirm.
6. **Workspace** (one screen): synced skeleton and traces, ghost and motion trails, the timeline, A/B compare side by side or overlaid, moments, export (JSON/CSV), delete with typed confirmation, and **Finish & reflect** with guided prompts and a goal for next time. Everything autosaves.

Keyboard: Space plays or pauses, ← → step one frame, M marks a moment, Ctrl+K opens the command palette.

## Usability study log

Off by default. Turn it on with `#/signin?study=on` or Ctrl+Shift+S. The facilitator panel runs a task script (T1–T6), times each task with its outcome, and exports a JSON log. It records actions by participant code only, never notes or other free text, and stays in the browser. Confirm it with the IRB before using it with participants.

## Tests

`npm test` runs Vitest on the time mapping, boundary editing and validation, boundary suggestions against the synthetic ground truth, summaries, export and routing.

`npm run e2e` runs Playwright against the in-browser mock: the whole dancer flow (sign in → new session → processing → confirm → compare → reflect), the mismatched-export error, video sync and phase-matched compare, gaps, autosave across reload, export, delete, the study panel reset and a phone-width check. It uses your installed Chrome (or `PW_BUNDLED=1` after `npx playwright install chromium`) and generates the synthetic test clips first if they're missing (`npm run clips`; they're git-ignored with the other `*.mp4`).

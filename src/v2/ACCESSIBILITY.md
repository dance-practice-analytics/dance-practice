# Accessibility audit (NFR-13)

Run on 2026-11-17 with `node scripts/audit-a11y.mjs [--pages …] [--themes light,dark] [--json out.json]`:
axe-core 4 (`@axe-core/playwright`, tags wcag2a, wcag2aa, wcag21a, wcag21aa, best-practice) plus a keyboard
pass, in headless Chrome at 1440×900, light and dark. Screens: Sign in (signed out), then with the test account
(synthetic clips only): Dashboard, Library, Import, Review, Compare, Progress, Practice notes, Mika, Settings & data.
The script waits until no `aria-busy` element or "Loading" line is left in `<main>` before it audits.

## Result

| | Before | After |
| --- | --- | --- |
| axe violations, serious / critical | 4 rules on 4 screens (10 nodes per theme) | **0 on all 10 screens, both themes** |
| axe violations, moderate / minor | 1 (Compare) | **0** |
| Tab stops without a visible focus indicator | 0 | 0 |
| Visible controls Tab never reaches | 1 (Import: the second radio of a group, expected) | same |

Keyboard pass: every screen was tabbed through to the end (5–41 stops). Each stop gets the global
`.app :focus-visible` ring (2 px `--focus` outline + halo), and the only "unreached" control is the second option
of a radio group, which arrow keys reach (standard radio behaviour). The hidden file inputs on Import are
`tabIndex=-1` behind real buttons ("Choose files", "Choose a folder").

## Fixed

| Screen | Rule (WCAG) | Fix |
| --- | --- | --- |
| Dashboard (loading) | aria-prohibited-attr, serious | Skeleton wrapper got `role="status"`, so its `aria-label` is allowed (`pages/Dashboard.tsx`). |
| Library, Dashboard | label-content-name-mismatch, serious (2.5.3 Label in Name) | Attempt tiles no longer override their name with `aria-label`: the name comes from the text, with a visually hidden "Attempt n," (and "processing" before a percentage), e.g. "Attempt 2, Done" (`pages/library/cards.tsx`). |
| Review, Compare | label-content-name-mismatch, serious | Phase ribbon buttons: the name now starts with the visible text ("Hold 1.2s phase"; "Rec. Recovery phase, 31.3 seconds" for abbreviated ones), and a space separates name and length (`pages/review/Tracks.tsx`). |
| Compare | landmark-unique, moderate | The two "video not on this device" regions are named after their attempt ("Video of A not on this device") (`pages/review/Relink.tsx`). |
| All (no-tracking chips) | color-contrast, manual check (1.4.3) | `.conf-none` text over the hatch stripes was 3.9:1 in light; now `--text-2` (≥ 5.7:1 on the stripes in light and dark) (`studio.css`). |

## Left for a manual look (axe "needs review", not violations)

- Text on hatched backgrounds (`.reason.hatch`, `.conf-low`): axe can't compute contrast over a gradient. Worked
  out by hand on the stripe colour: `.reason` 5.7:1 (light) / 5.6:1 (dark); fine.
- Progress chart axis text inside `svg[role="img"]` and the 1-character attempt number on Library tiles: axe can't
  decide; the numbers use `--text-2`/`--text-3` on `--surface` (≥ 5.7:1).
- Compare: the A/B `<label>`s carry `aria-label="Attempt A/B"` (minor; axe flags `aria-label` on a `<label>` as
  "needs review"). Chrome uses it for the select's name; moving it onto the `<select>` would be cleaner.

## Not covered

- Phone width (bottom nav, `.mhead`) and the Processing, Dataset (researcher) and Consent screens were not part of
  this run; Processing needs a queued clip, Dataset the researcher role.
- Screen-reader listening test (NVDA / TalkBack), 200% zoom / reflow (1.4.10) and reduced motion were not tested.
- axe finds roughly a third to a half of WCAG issues; this is not a conformance claim.

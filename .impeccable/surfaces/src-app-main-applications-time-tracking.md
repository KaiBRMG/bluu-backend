---
version: 1
slug: "src-app-main-applications-time-tracking"
primary_target: "src/app/(main)/applications/time-tracking"
related_targets: []
---

## Scope

`/applications/time-tracking`: every employee's own clock (all roles, not only chat agents), inside the Electron console. Operate. Whole page redesigned (hero, Sessions, History, Screenshots) inside DESIGN.md's Quiet Instrument world; no new world.

## Audience & job

Someone mid-shift, or about to start or end one, who must start, pause, break or end time and in one glance know their state, the live clock, how far through their shift they are, how much break is left and when breaks open. Driver: the old page read as generic and dated beside Shift Management and Chatter Analytics.

## Constraints

- Real data only. The ring draws the scheduled shift (when there is one), today's sessions per `STATE_CONFIG` state, not-counted spans (pauses tagged `no-evidence` / `sleep-gap`) as the grey hatch, and a white/60 now tick.
- The person's own shift comes from `GET /api/time-tracking/my-shift`: uid from the token only, `private, max-age=300` + `Vary: Authorization`.
- No integrity, input-quality or activity scoring for the employee. Timer logic, break rules, ClockOutButton and the stale-page remount are untouched.
- Arc and now tick move at most once a minute; the clock is the only per-second figure.
- Ring + side panel side by side down to the 1024px window floor (container query @[38rem] on a p-6 panel: ~650px content at 1024 with the 260px sidebar), stacked below.

## Direction contract

THESIS: The clock and the day are one object: the live clock sits inside a ring whose arc is today's span, filled by state as the shift goes on. Refuses the default: a big number in a tinted card above a 24-hour bar that squeezes a 9-to-5 into a third of its width.

OWN-WORLD: Quiet Instrument. Near-black canvas, SURFACE panel, hairlines, Google Sans with tabular numerals. Colour only from STATE_CONFIG hues and the Shift Management grey hatch for unknown/not counted. The scheduled shift is a dashed outer arc. Action Blue is used only for the primary button.

STORY: They see the state word and the clock inside the ring and read how much of the arc is filled against the shift. Beside it are the action, the break left, a sentence about the shift ("2h 10m of shift left · breaks open 10:00") and today's working/idle/break/paused/not-counted list. They act, and the state word changes. Below are Sessions, History and Screenshots.

FIRST VIEWPORT: Title row. One SURFACE panel: on the left a 300px ring (a 280° arc with the gap at the bottom labelled with the span's start and end times; dashed shift arc outside; state word, the 48–60px clock and the today total in the centre). On the right, top to bottom: the action row (the primary action first), the shift sentence, Break Remaining, and the Today list. Below the panel, line tabs.

FORM: Ring instrument, rank 3 of 7 in re-roll 1; seed 9a73bcef. Signature interaction: hovering an arc segment swaps the centre's today line for that segment's state and time range; leaving restores it.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Open decisions

- Home widget parity: the ring reads `useTodaySessions` + `useDayTotal`, the same sources as the home widget's today figure, so they agree by construction; no separate sync needed.

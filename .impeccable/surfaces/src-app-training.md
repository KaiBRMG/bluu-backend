---
version: 1
slug: "src-app-training"
primary_target: "src/app/training"
related_targets: []
---

## Scope

`/training` — the public, link-only surface for candidates on a paid trial (not app users), plus the console page `admin-portal/training` where admins switch a module on and open its tests one at a time. Candidate side: Operate (one entrance moment). Extends DESIGN.md §8's stage with §9's task-surface scale; no new world.

## Audience & job

A nervous candidate, probably at a computer for the work and on a phone for the first tap, being judged on a clock. They must get in, see what is next and when, do one timed part without doubt about the rules, and know their work landed. Admins must switch a module on, open a test (copying its files from Drive) and see who is where, in under a minute.

## Constraints

- No invented numbers or claims. Rules are stated before Start; the clock is server-truth.
- Entry is email → emailed 6-digit code → signed httpOnly cookie. Approved/unapproved look identical to the caller.
- Candidate data is server-only. Uploads go direct to Storage over signed URLs capped at the deadline plus a grace (30s for a final image, 10 minutes for a working file). Materials come from a Google Drive shared drive, copied to Storage when a test opens.
- 16px fields, >=44px targets, `NoTranslate`, `noindex`, no `<Link>` prefetch.
- Flashing is <=1 Hz and absent from T7; reduced motion replaces it with a static state change plus a milestone announcement. The briefing returns no image.

## Direction contract

THESIS: After Start the page becomes a focus room: all chrome goes and the clock is the largest thing on screen. Refuses the category default: a quiz page with a small timer badge in the corner.

OWN-WORLD: §8's stage — #08090b ground, one azure wash, azure the only voice with AZURE_INK on fills, Google Sans alone, translucent-white panels, hairlines, no shadows. The clock is tabular numerals at `clamp(4rem,14vw,9rem)` in a rail; urgency is carried by words ("5 minutes left"), a border state and weight, never hue alone.

STORY: They enter an email, then a code, and understand they are on the list. They read what the open test asks and what the rules are, tap Start, and the task and the clock arrive together. They upload final images, see each one land, add working files and a task record, and finish with "N of M uploaded" visible the whole time. At zero the room locks, says what is still arriving, and says so calmly.

FIRST VIEWPORT: Gate — logo, "Bluu Rock Training" h1 at the §9 task scale, one honest line about approval, one email field and one Continue. Task screen at 1440 — the brief and paired source→slot rows left, a sticky rail right with the clock at about 9rem, progress, Datasets, Explainer and Finish early. On a phone the clock is a pinned top band.

FORM: Surface extension of an established world, no concept roll; the planning doc fixes the structure. Code-led. Signature interaction: the clock's milestone pulses (10 and 5 minutes, a halfway pulse) and the last-minute 1 Hz flash; T7's per-image window clock deliberately has neither. Seed key: n/a (extension).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

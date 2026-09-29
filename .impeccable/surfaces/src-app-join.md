---
version: 1
slug: "src-app-join"
primary_target: "src/app/join"
related_targets: []
---

## Scope

`/join/[token]` — the personal onboarding link an approved applicant receives in the "Welcome to BLUU ROCK 🎉" email. Landing (Persuade) then a long form (Operate), on a phone, once. Extends DESIGN.md §8 "the stage" (the public application form's skin); no new world.

## Audience & job

An applicant who has just been approved. They should feel chosen (true: every application is reviewed by hand, and this link is personal), then get through ~50 questions without it feeling like ~50 questions, and never lose an answer.

## Constraints

- No invented claims: no acceptance rates, roster sizes, earnings. Exclusivity comes from true facts only.
- Answers autosave to the server; unsynced edits buffer locally until acknowledged.
- `NoTranslate` on the route (the same React-root crash as /model-submissions).
- 16px fields, ≥44px targets, sticky action bar with safe-area inset.

## Direction contract

THESIS: The welcome is a backstage pass, not a banner. An approved creator is handed a credential with their own name on it, then walks three short sets — You · Your limits · Your persona. Refuses the category default: a "Welcome!" hero over a single scrolling questionnaire with a percentage bar.

OWN-WORLD: §8's stage — #08090b ground, one azure stage wash from above, azure the only voice with AZURE_INK on fills, Google Sans alone, translucent-white panels, hairlines, no shadows. Signature object: the pass — an opaque laminate card with a punched lanyard slot, the applicant's name large, pass number and approval date in tabular numerals.

STORY: They see their own name on a pass and understand they are in; the setlist shows three sets with honest minutes and "saves as you go", so they believe it is short; they tap Begin. Inside, one small screen at a time, limits as a fast yes/no deck, persona as a character card that fills in live. At the end the pass is stamped.

FIRST VIEWPORT: Mobile — small logo top-left; the pass centred at ~66% width (adapted from ~86%: any larger pushes the setlist out of the first viewport), slightly tilted; beneath it "You're in, {first name}." at display size and one line; the three-set setlist with minutes; the sticky bar carries "About 13 min · three sets · saves as you go" directly above the azure "Begin onboarding". Desktop ≥lg — copy, setlist and CTA left; pass right at 26rem (~416px).

FORM: Surface extension of an established world (no concept roll — the brief pins landing content and the world is §8). Signature interaction: the pass tilts toward the pointer (±5°) with one specular sweep on arrival; the completion stamps it "Onboarded". Seed key: n/a (extension).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

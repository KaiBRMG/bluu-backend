---
target: src/app/(main)/admin-portal/user-management
total_score: 19
p0_count: 2
p1_count: 4
timestamp: 2026-09-07T17-12-20Z
slug: src-app-main-admin-portal-user-management-page-tsx
---
Method: dual-agent (A: design review · B: detector + evidence). Both ran isolated and in parallel; neither saw the other's output.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | Every mutation swaps the whole page for a bare spinner (`page.tsx:42-50` + `useAdminUsers.ts:118`); group writes report nothing at all; the result count has no `aria-live`. |
| 2 | Match System / Real World | 3 | Vocabulary is genuinely good ("Invited", "Registered but not yet set up"). The main CTA is labelled "New" — new what? One field carries two names ("Nickname" vs "Preferred Nickname"). |
| 3 | User Control and Freedom | 1 | No Undo anywhere. Every save/create/group-write destroys the open drawer, the search, all three filters and the selected group. Removing a group member is one silent, unconfirmed, unrecoverable click. |
| 4 | Consistency and Standards | 1 | Four greys for one role (`#6b7280`, `#9ca3af`, `#a1a1aa`, `#71717a`); hand-rolled popover beside shadcn dialogs; hardcoded status hexes beside `STATUS_COLORS`; two different search predicates in one feature. |
| 5 | Error Prevention | 3 | Type-the-name delete, dirty-state guard, the load-bearing `=== false` in `userStatus.ts:25`, the "if it's wrong, their login will be blocked" email hint. Docked for the checkbox no-op. |
| 6 | Recognition Rather Than Recall | 2 | The user record never shows the user's groups — 1300 lines of `UserDetailContent` with no group field. Reassignment carries a name across three screens. |
| 7 | Flexibility and Efficiency | 1 | No bulk actions, no multi-select, no keyboard shortcuts, no sort control, no URL state, and the roster search ignores email. |
| 8 | Aesthetic and Minimalist Design | 2 | One card can carry up to six saturated colour objects from two independent 10-hue hash palettes, on a console whose stated posture is "greyscale by default". |
| 9 | Error Recovery | 2 | The save-validation path is exemplary. Everything else dead-ends: no retry on the page error state, silent group failures, a filtered-empty state with no way out, and a mistyped login email recoverable only by permanent deletion. |
| 10 | Help and Documentation | 3 | Strong inline hints throughout. The Actions menu offers Archive and Delete with no stated difference until you open a dialog. |
| **Total** | | **19/40** | **Poor — major UX overhaul required** |

## Anti-Patterns Verdict

**LLM assessment.** It does not read as AI-generated; it reads as three design systems wearing one page. The prose is the work of someone who understands the domain deeply — the code comments, the dialog copy, and the `isInvitedUser` rationale are better than most production admin UI. The assembly is not. Confirmed violations of the shared bans: a 4px hash-coloured side stripe (`GroupList.tsx:31-34`), an identical card grid (`EmployeeRegistry.tsx:126`) where the design system already ships a faceted index for exactly this job, and a magic-number text clearance (`UserCard.tsx:75` `pr-20`) that long names will run under. Product-register bans: inconsistent component vocabulary (a hand-rolled absolute-positioned popover with a `mousedown` listener and a literal `z-50`, next to correct shadcn `Sheet`/`Dialog`/`AlertDialog` usage), colour-hashing a free-form string (banned by name in DESIGN.md section 6, which records it was already removed from Resources once), and heavy colour on a default state (every healthy record opens with a full green box for "Account Active").

**Deterministic scan.** `detect.mjs` over both directories returned `[]`, exit 0 — zero findings. Assessment B control-tested the detector against a planted file and got 2 hits, so the clean result is genuine, not a broken run. It is also a false negative, and the reason matters: the detector's ruleset does not encode this project's own contrast rules, and this surface de-emphasises text through custom CSS tokens rather than zinc utilities — so a `text-zinc-500` grep under-reports too. `--foreground-muted: #6b7280` (`globals.css:34`, not redefined in the `.dark` block) measures 4.12:1 on the canvas and 3.71:1 on the card surface. It is the same failure as the `text-zinc-500` DESIGN.md section 2 already condemns, wearing a token name. It appears 12 times, carrying every employee's email address, every hint in the registration dialog, every job title, and the result count.

**Visual overlays.** None. No browser automation is exposed in this session, and this page is auth-gated behind Google OAuth with `middleware.ts` rewriting non-Electron traffic to `/desktop-only`, so a live render was not reachable. No dev server was started and no overlay exists. Every contrast figure in this report is computed from the hex values in `globals.css` via the WCAG relative-luminance formula, not measured in a browser.

## Overall Impression

The strongest thinking in this codebase and the weakest execution in this codebase are in the same folder, sometimes in adjacent files. `UserDetailContent.tsx` force-opens the accordion sections holding validation errors, waits two `requestAnimationFrame`s so layout settles, focuses the first invalid field, and names the sections in the toast. Forty lines away, `GroupMemberList.tsx` swallows a failed permission-graph write into `console.error`.

The single biggest opportunity is structural, and it is the one the redesign should start from: the tab bar is a filter that has been promoted to navigation. Three of the four tabs render the same component with booleans, and those booleans collapse to two predicates — `isArchived` and `isInvitedUser` — both of which already exist as filter values in that same component. The cost is not abstract: the page's stated primary action is mounted inside two of the four panels, so "add an employee" is invisible on half the surface it belongs to.

And underneath all of it is a defect neither the visual review nor the detector would ever surface: this page cannot hold a thought. Every write blanks it.

## What's Working

1. **`userStatus.ts` is a real product insight, correctly implemented.** "Invited" spans registration through the end of onboarding, not through first login — because onboarding is all-or-nothing and a half-finished record would show a complete-looking employee who is actually empty. The `=== false` test (not a falsy check) is load-bearing and commented as such: pre-onboarding users have no such field, and a falsy test would relabel every long-standing employee as Invited. Then `invitedStageLabel` distinguishes "never signed in" from "signed in, didn't finish" — because that difference decides whether to chase the person or check the email for a typo. One definition, three surfaces, zero drift. Carry this forward untouched.

2. **Destructive-action friction is consequence-proportional rather than uniform.** Archive states plainly that nothing is deleted; delete enumerates the exact cascade (timesheets, screenshots, shifts, leave requests, notifications) and requires typing the full name; revoke-access describes the user-visible consequence and says it is reversible. Three stakes, three levels of ceremony. The dirty-state guard routes Esc, overlay-click and the X through one handler while exposing a `forceClose` for flows that already committed — so archiving doesn't ask you to confirm discarding edits it just made moot.

3. **The registration flow itself is the best-designed thing on the page.** Eight interactions, one dialog, no navigation, group assignment folded into creation rather than deferred — and a success toast written in the operator's own terms: "{name} can now sign in with {email}". That toast is the page's genuine peak. The redesign should promote this flow, not rebuild it.

## Priority Issues

### 1. [P0] Every mutation blanks the page and destroys your place

**What.** `useAdminUsers.fetchData(true)` sets `loading: true` (`useAdminUsers.ts:118`) and is awaited by every mutation — `updateUser`, `createUser`, `addGroupMembers`, `removeGroupMember`. `page.tsx:42-50` returns a full-page spinner whenever `loading` is true, unmounting the entire `Tabs` tree. So saving a record: the drawer closes, `searchQuery` and all three filters reset, the page flashes to a centred dot, and the "Changes saved" toast lands over a roster you are no longer looking at. Removing a member from the fifth group snaps you back to the first group (`UserGroups.tsx:21-23` re-initialises to `groups[0]`).

**Why it matters.** Every task on this page is "filter down, act, act again". This makes the second act impossible. An admin auditing eight contractors re-types the filter eight times. It also means the page can never support an optimistic update, an Undo toast, or bulk actions — all of which are on the redesign's list — because the tree they'd live in doesn't survive the write.

**Fix.** Split the flag: keep `loading` for the initial cold fetch only and add `isRefreshing` for post-mutation refetches, which should re-render in place. Better, apply the server's response to local state instead of refetching at all. Then hoist filter/search/selection state out of `EmployeeRegistry` into the URL (`searchParams`), which fixes refresh-safety and linkability in the same change.

**Suggested command:** `/impeccable harden`

### 2. [P0] Adding an existing user to a group is broken by mouse and impossible by keyboard

**What.** `AddMembersDropdown.tsx:91-102` — each row is a `<div onClick={() => toggleUser(uid)}>` wrapping a Radix `<Checkbox onCheckedChange={() => toggleUser(uid)}>`. Radix's Checkbox renders a `<button>`; `src/components/ui/checkbox.tsx:14` is a bare `Root` with no `stopPropagation`. Clicking the checkbox fires `onCheckedChange` and bubbles to the parent — both call the same functional updater, so it toggles on then off. Clicking the checkbox does nothing. Only the row's dead space works. Separately the row `<div>` has no `role`, no `tabIndex` and no key handler, so the list is entirely unreachable by keyboard; tab order runs search input, then nothing, then "Add Selected". `handleConfirm` (`:57-62`) also fires `onAdd` without awaiting and closes immediately.

**Why it matters.** This is the second half of the page's stated main CTA. The most obviously clickable target in the component is the one that silently fails, so a user's reasonable conclusion is "this feature is broken". Both assessments found this independently, from different angles.

**Fix.** Delete the component and rebuild on shadcn `Popover` + `Command` — the exact pairing DESIGN.md cites for the Sharing page's pickers. That brings arrow-key navigation, type-ahead, Esc, `role="listbox"`, a focus trap and focus return for free, and removes the last hand-rolled overlay in the feature.

**Suggested command:** `/impeccable harden`

### 3. [P1] The main CTA is buried, vaguely named, and defaults to skipping its own second half

**What.** The path to the primary action is: page `<h1>`, then tab bar, then tab panel, then a paragraph of description, then a `size="sm"` button labelled "New" (`EmployeeRegistry.tsx:92`). DESIGN.md section 3 is explicit that a page's primary action sits to the right of the `<h1>` on the same row. Because it lives inside the tab panel it is mounted twice with two independent form states, and disappears entirely on User Groups and Archived Users. And `NewUserDialog.tsx:56` initialises `groupId` to `UNASSIGNED`, rendering "Unassigned — decide later" as a filled, deliberate-looking value — so the default state of "add a user and assign a group" is "don't assign a group". `AdminGroup.isDefault` exists in the type and is never read. The dialog also assigns exactly one group while the model is `groups: string[]`.

**Why it matters.** This is the page's reason to exist. Right now it is a small ghost button two levels down, named after nothing, defaulting to the half-done outcome — and the hire it half-creates signs in to an empty sidebar and messages the admin.

**Fix.** Move it to the `<h1>` row as the page's one primary `Button`, label it "Add employee", make it visible from every view, seed the group from `isDefault`, and make the group field a multi-select.

**Suggested command:** `/impeccable layout`

### 4. [P1] The person's record can't show or change their group

**What.** `UserDetailContent.tsx` is 1300 lines and contains no group field — not editable, not even displayed. The card shows group badges; open that person and the badges vanish. Moving someone between groups requires: close drawer, User Groups tab, find the old group, click X (silent), find the new group, Add Members, retype the name, confirm. The name is carried in the operator's head across three screens, as two separate mutations, with no confirmation that the pair completed.

**Why it matters.** Group is page access — the dialog's own hint says "Decides which pages they can reach". The single most consequential attribute of an employee record is the one the employee record doesn't have. `AdminFullUser.role` and `AdminGroup.description` are likewise fetched, typed, and never rendered.

**Fix.** Put an editable group multi-select in the drawer's Access & Permissions block, on the same "applies immediately" contract as the switches beside it. The cross-tab round-trip then disappears, and the User Groups tab can become a facet rather than a peer destination.

**Suggested command:** `/impeccable shape`

### 5. [P1] Group writes are silent and irreversible, while the safest action on the page has typed confirmation

**What.** `GroupMemberList.tsx:38-40` and `:48-50` catch failures into `console.error`. No toast on success, no toast on failure, no rollback. Removing a member is one click: no confirmation, no undo, no record. DESIGN.md section 5 requires every mutation to toast its outcome, precisely because CRUD results happen off-screen.

**Why it matters.** The friction on this page is inverted. Deleting a person demands typing their full name. Removing them from a group — which silently revokes every page that group grants — is one unconfirmed click that reports nothing, and a failed write is indistinguishable from a successful one because the list refetches either way. The operator's most likely reading of a failure is "I must have mis-clicked."

**Fix.** `toast.success` / `toast.error` on both handlers with the real name and count, plus an Undo on removal that re-POSTs the uid — the Sharing page's revoke-with-Undo pattern, already sanctioned in CLAUDE.md.

**Suggested command:** `/impeccable harden`

### 6. [P1] Four greys for one role, two of which fail AA, plus a ten-hue rainbow the design system already banned once

**What.** Measured against the real token values, with the `.dark` block confirmed not to override them:
- `text-foreground-muted` (`#6b7280`) — 4.12:1 on canvas, 3.71:1 on the card. 12 uses, carrying every employee's email, every hint in the registration dialog, every job title, and the result count. Two more uses bypass Tailwind entirely as `style={{ color: 'var(--foreground-muted)' }}`.
- `text-zinc-500` (`#71717a`, 4.12:1) — 5 uses as the disabled treatment in the drawer; `UserDetailContent.tsx:803` steps a legal `text-zinc-400` down to it.
- Roster focus ring — `UserCard.tsx:44` uses `ring-ring/50`; `--ring` is `oklch(0.552 …)` about `#71717b` at 50% over near-black, roughly 1.8:1, and not inset. DESIGN.md mandates a 2px inset Action Blue ring.
- `groupColors.ts` hashes an admin-editable group name into ten saturated hues, rendered as badges, a 4px side stripe and a dot. Two of those ten fail AA at 12px on the card surface: `#6366f1` at 4.01:1 and `#8b5cf6` at 4.25:1. Whether a group's badge is legible is decided by its spelling, and changes when someone renames it.
- Status hues are retyped inline (`#22c55e`, `#ef4444`, `#fb923c`) instead of imported from `STATUS_COLORS` — and they're the -500 steps, not the -400 steps the palette chose for dark grounds. `UserCard.tsx:24` even comments "per the palette" while not using it.

**Why it matters.** The failing colour carries the data the page exists to display. And a keyboard user cannot see where they are in the roster at all.

**Fix.** Redefine `--foreground-muted` to `#a1a1aa` (the app-wide fix) or sweep to `text-zinc-400`; import `STATUS_COLORS`; delete `groupColors.ts` and render groups as greyscale attribute chips; replace the ring with `focus-visible:ring-2 focus-visible:ring-inset` at `#3b82f6`.

**Suggested command:** `/impeccable colorize`

## Cognitive Load: 6 of 8 failed — CRITICAL

| Check | Result | Evidence |
|---|---|---|
| Single focus | FAIL | One page doing four jobs: roster, invite-chase queue, group editor, account-lifecycle console. |
| Chunking (4 or fewer per group) | FAIL | 7 accordion sections in the drawer; up to 9 elements per user card. |
| Grouping | PASS | Access block, read-only `<dl>` and accordion sections are properly bounded. |
| Visual hierarchy | FAIL | The card grid is perfectly flat — nothing aligns to a column, so nothing can be scanned. "New", "Add Members", "Add Selected" and "Save Changes" are all the same near-white button. |
| One thing at a time | FAIL | The drawer runs two save models at once: "Applies immediately" switches above a 25-field deferred form. Labelling it is honest; it doesn't remove the load. |
| Minimal choices (4 or fewer) | FAIL | See below. |
| Working memory | FAIL | Group reassignment carries a name across three screens and two mutations. |
| Progressive disclosure | PASS | Accordion, drawer and dialog all defer correctly. |

Decision points over the 4-item working-memory limit: the 7-section accordion with no expand-all and labels that don't say which section holds the phone number; the 5-control filter row where none of the three Selects carries a count, so every filter choice is a blind guess (DESIGN.md: "Counts are faceted, or they are lies" — showing none is the weaker of the two acceptable options); Employment Type at 5 values; the 9-element user card whose layout reflows depending on which fields a person happens to have; and the drawer presenting an access switch, a permission switch, an Actions menu containing both Archive and Delete, Cancel, and Save simultaneously with no hierarchy.

## Emotional Journey

Entry is a valley. A cache miss replaces the entire page — title, tabs and counts included — with a centred animated dot. The `<h1>` should never leave.

Scanning is flat. Forty tinted cards in a rainbow grid, with no sort, no letter rail, no sections and no column alignment. There is no "ah, there they are" moment because retrieval is by scanning colour noise.

The peak is real and well-earned: the registration toast, "{name} can now sign in with {email}", states the outcome in the operator's own terms.

The end is uncertainty. Group work finishes in silence, and a failed write ends in exactly the same silence as a successful one. Under the peak-end rule, the page's lasting impression is doubt about whether the last thing you did actually happened.

One inverted-stakes gap worth naming. The registration dialog warns beautifully that a mistyped email will block the hire. The Invited tab then diagnoses it perfectly — "Has never signed in". And there is no way to fix it: `workEmail` is read-only in the drawer, and the address is claimed transactionally in `auth-emails`. The only recovery is Delete Permanently — which requires typing the full name of the record you're trying to correct. The page's clearest diagnostic leads to its harshest remedy.

## Persona Red Flags

**Alex (power user, onboarding six hires after a hiring round).** No multi-select and no bulk create — six passes through the dialog, and after each one the page blanks and refetches the entire admin payload before he can reopen it. No keyboard shortcuts anywhere; `AddMembersDropdown` has no Esc, no arrow keys, no type-ahead. He pastes an email into the roster search and gets nothing, because `EmployeeRegistry.tsx:59-64` matches first/last/display only — while the dropdown twenty lines away does match email. No sort control, so "who hasn't logged in?" is unanswerable. Tab and all four filters are `useState`, so a reload — or a `NavigationWatchdog` rescue, which CLAUDE.md documents as a real path — dumps him back on tab one with everything cleared. And one "applies immediately" switch triggers two full admin-payload fetches.

**Sam (screen reader + keyboard, needs 4.5:1).** Cannot add anyone to a group at all — the rows are `<div onClick>` with no role, tabindex or key handler. The roster's focus ring is about 1.8:1 and not inset, so on `rounded-lg` cards it can clip; they cannot see where they are. Every employee's email is 3.71:1, as is every hint in the registration dialog. `GroupList` marks selection with an 8%-white fill DESIGN.md itself measured at 1.25:1, with no `aria-current` — invisible to eye and to AT. The result count has no `aria-live`, so changing a filter announces nothing. The search input has a placeholder but no accessible name. The hand-rolled popover has no focus trap, no `role`, no Esc, and doesn't return focus to its trigger. Two things to preserve through the redesign: `UserDetailContent`'s `fieldProps` wires `aria-invalid` + `aria-describedby` correctly, and the phone composite carries `sr-only` labels on both parts.

**The Bluu Rock admin (project-specific — registering a new hire in the Electron window).** They land on a spinner that eats the page header. They click a button labelled "New". They leave the group unassigned by accident, because the Select renders "Unassigned — decide later" as a confident-looking filled value. They mistype the email and discover the only fix is permanent deletion. They see two different member counts for the same group side by side — `GroupList.tsx:41` counts raw uids while `GroupMemberList.tsx:68` counts uids that resolved to a user, so one stale uid shows "12" in the rail and "11 members" in the panel with no explanation. They remove someone from a group and get no confirmation that the page-access revocation happened. And they do all of this against a fixed 500px `Sheet` holding a 25-field record behind seven collapsed accordions, on a 27-inch desktop window where the roster behind it sits idle.

## Minor Observations

- The empty state is a dashed-border box containing an icon medallion — two DESIGN.md Don'ts in twelve lines ("never an illustration, and never wrapped in a bordered box"). The default tab's copy also always says "No users match the selected filters" even with zero filters applied, and ships no inline control to clear them.
- `GroupList` has no empty state at all; zero groups renders an empty bordered box.
- Avatar seed drift. `UserCard.tsx:68` seeds `displayName || fullName || 'User'`; `GroupMemberList.tsx:98` and `AddMembersDropdown.tsx:103` seed `displayName || 'User'`. A user with no `displayName` renders as two different colours and two different initials across the same page — the exact failure the Avatar Seed Rule exists to prevent.
- `page.tsx:72` re-declares `dark` inside an already-dark shell, and ten-plus `SelectContent`/`DialogContent`/`AlertDialogContent` call sites repeat `className="dark"`. That much repetition means the theming contract isn't understood at the call sites.
- `UserGroups.tsx:30` has no responsive stacking around a `w-64 flex-shrink-0` rail; `min-h-[500px]` and `max-h-[560px]` are magic values that disagree with each other. `max-w-6xl` (1152px) caps a grid whose `xl:grid-cols-3` triggers at 1280px, so the 3-up state is always the cramped one.
- `AddMembersDropdown` uses a literal `z-50` rather than `z-[var(--z-overlay)]` (the Named-Layer Rule).
- Opening any user's drawer mounts `useAdminData()` to read one permission doc — pulling pages, teamspaces, pagePermissions, groups and users. Per-row, against CLAUDE.md rule 9.
- The Time Tracking switch is a single hardcoded page permission living in the drawer, while every other page permission lives on `/admin-portal/sharing`. One page has a privileged shortcut and nothing says why.
- `UserDetailDrawer.tsx:97` — "Select a user to view their record." is unreachable copy; the Sheet only opens when a `userId` is set.
- Ellipsis characters are inconsistent: "Saving..." / "Deleting..." (ASCII) vs "Registering…" (typographic).

## Questions to Consider

1. If the tab bar is a filter, why is it navigation? Archived and Invited are already predicates inside `EmployeeRegistry`, and `statusFilter` already offers Invited. What survives if you delete `TabsList` and move Status and Archived into a facet rail — and what does the page look like when there is exactly one list of people?

2. Is a user group an attribute of a person, or a container of people — and can it be both without a round-trip? Today it is a container only, which is why the person record can't show it. If membership becomes an editable field on the record, does the User Groups tab need to exist at all, or does it become a facet plus a small "who's in Ops?" view?

3. What is the actual most-frequent job here? The stated CTA is "add a user", but four registration fields versus a 1300-line, 25-field editor suggests the daily weight is elsewhere. If the real daily job is "chase the four people who haven't onboarded", the front door should be that queue — DESIGN.md's decision-queue pattern, verdict on the row — not a roster you filter down to it.

4. Why can a login email be typed but never corrected? Is the answer a guarded "change login email" flow that re-claims in `auth-emails` and releases the old, or a confirm-email field in the dialog? Today the recovery path for a typo is permanent deletion.

5. Index, table, or queue? DESIGN.md frames these as three different answers. "View and manage employee data" sounds like an index, but "who has no Telegram, who's on paid leave, who hasn't logged in" are column audits. Is the honest answer a two-line-row index with a column-view toggle, rather than picking one?

6. On a desktop Electron window, why is the record a modal at all? A `lg:grid-cols-[20rem_minmax(0,1fr)]` master/detail — index left, record right — deletes the Sheet, the discard-guard dialog and the close-to-switch-tabs round-trip in one move, and it's the same two-pane shape the design system already sanctions for the satellite window.

7. What would an operator actually learn from a group's colour? If the answer is "nothing, I read the name", ten hues are pure noise and greyscale chips are strictly better. If the answer is "I recognise Ops by orange", then group is a closed vocabulary that deserves assigned, stored colours — not a hash that changes on rename. The current design commits to neither.

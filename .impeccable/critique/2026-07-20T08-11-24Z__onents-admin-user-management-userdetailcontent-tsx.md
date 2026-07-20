---
target: UserDetailContent.tsx + UserDetailDrawer.tsx
total_score: 16
p0_count: 2
p1_count: 3
timestamp: 2026-07-20T08-11-24Z
slug: onents-admin-user-management-userdetailcontent-tsx
---
Method: dual-agent (A: aeac297f6bfb29c33 · B: a5643c148b119ff78)

Targets: src/components/admin/user-management/UserDetailContent.tsx + UserDetailDrawer.tsx
Register: product (admin console). Browser visualization unavailable (no browser automation tool exposed).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | Archive/Enable/Delete/toggles produce zero feedback; validation failure produces nothing |
| 2 | Match System / Real World | 2 | Archive/Enable/Revoke Access/Account Disabled = four words, two concepts; "Enable Time Tracking" actually grants a page permission |
| 3 | User Control and Freedom | 2 | Good confirms; no unsaved-changes guard; accordion not collapsible |
| 4 | Consistency and Standards | 1 | Deferred form + instant toggles identical; DropdownMenu as Select; raw textarea; two label systems; inline hexes over variant="destructive" |
| 5 | Error Prevention | 2 | Delete 2 clicks from same menu as Archive; no type-to-confirm; no max on leave inputs |
| 6 | Recognition Rather Than Recall | 1 | Accordion type="single", 7 sections, one open, not collapsible, no dirty/error markers |
| 7 | Flexibility and Efficiency | 1 | No <form> so Enter never submits; no expand-all, no next/prev user, no type-ahead |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained and dense; banner chroma + duplicated name header cost a point |
| 9 | Error Recovery | 1 | Five catches end in console.error; failed permanent delete looks identical to success |
| 10 | Help and Documentation | 2 | Toggle subtext good; nothing explains archive vs delete vs disable |
| **Total** | | **16/40** | **Poor — core experience broken on the feedback axis** |

## Anti-Patterns Verdict

Not AI-slop (no gradient hero, no glassmorphism). It is product slop: three mutation models in one visual language, a form control that isn't the form control, every failure path ending in the console.

Deterministic scan: detect.mjs exit 2, 1 advisory finding — design-system-color at UserDetailContent.tsx:907, #f59e0b outside DESIGN.md palette. Same single finding across the whole directory.

Detector under-reports: 8 hardcoded color sites in the file (#22c55e, #ef4444, #f59e0b + rgba washes), none matching DESIGN.md's status-green #4ade80 / status-red #f87171 / status-orange #fb923c. 26 inline style={{}} blocks in one file.

Convergent findings neither assessment produced alone:
- DESIGN.md:196 mandates a sonner toast per mutation; Toaster is mounted at layout.tsx:43. This file performs 6 mutations and toasts none, and is the only file in src/components using a bespoke inline saveMessage banner. Across 33 admin components exactly one imports sonner.
- Contrast: white on #f59e0b Archive button = 2.15:1 (FAIL); white on #ef4444 Delete/Revoke = 3.76:1 (fails normal text); --foreground-muted #6b7280 on #0A0A0A = 4.10:1 (FAIL); that muted text inside an opacity:0.4 gated block = 2.13:1. The status banner itself passes (7.93 green / 4.97 red).
- Zero htmlFor/id pairs. 20 .form-label elements, 0 id= on any Input, 0 aria-label. 8 fields (all Address, all Emergency Contact) are placeholder-only.

False positives: #fff at :333 (AvatarFallback over generated color, out of scope); pointerEvents:'none' wrappers at :585/:597/:614/:624 (redundant — inner controls carry real disabled); w-[500px] sub-500px overflow (Electron-only app).

## Overall Impression

Bones are better than the score. Dirty-state model is clean, confirm copy is professional, isActive switch is non-optimistic. What sinks it: the panel cannot tell you anything went wrong. Biggest single opportunity — replace saveMessage + five console.errors with sonner toasts: ~15 lines removed, one design rule satisfied, three P0/P1s closed.

## What's Working

1. isActive switch is honest (:198) — setIsActive only after the await resolves. Never claims an untrue account state.
2. Confirm-dialog copy is the best writing in the file; :899 vs :942 distinguishes archive from delete accurately per documentation/user-management.md.
3. State isolation correct by construction: originalDataRef + JSON diff + key={user.uid} remount. No stale-state bug class.

## Priority Issues

[P0] Save fails completely silently on validation error — handleSave returns at :258-261 with no message/scroll/expansion. With type="single", an error in a collapsed section is invisible. Fix: toast.error, Accordion type="multiple", force-open erroring sections, focus first invalid field, error-count badge per trigger. → /impeccable harden

[P0] Every failure path is invisible — :152, :166, :179, :200, :219 all console.error. Failed archive is indistinguishable from a no-op; failed delete from success. Fix: replace all five catches and saveMessage with toast.success/toast.error; delete the state, the auto-clear effect (:139-144), and the footer slot (:834-843). → /impeccable harden

[P1] Unsaved changes destroyed silently — UserDetailDrawer.tsx:37 onOpenChange calls onClose() unconditionally. Esc/overlay/X discards an edited form. hasChanges lives in the child, unreachable from the parent. Fix: lift hasChanges or move Sheet inside the content; intercept onOpenChange/onEscapeKeyDown/onPointerDownOutside with a discard AlertDialog. → /impeccable harden

[P1] Time Tracking toggle is a dead switch — enableTimeTracking reads user.permittedPageIds (:130, from useAdminUsers); the write goes via useAdminData.updatePermission which refetches only the admin-data cache. The switch snaps back on success. onRefetch is already passed to the drawer and unused. Fix: call onRefetch, or hold optimistic state. → /impeccable harden

[P1] Two write models, one visual language — "Enable Time Tracking" (:576) writes on flip; the three toggles 20px below are deferred and pixel-identical; the account-status switch writes instantly behind a confirm. Fix: hoist all instant-apply controls into a fixed "Access & Permissions" block above the accordion with an "Applies immediately" caption, or make the permission toggle deferred. → /impeccable layout

[P2] Destructive actions adjacent to the primary CTA, on broken layout math — Actions (Archive/Delete) sits immediately right of Save (:855-889). h-[calc(100vh-65px)] (:327) is a magic number for a ~69px header (53px + SheetContent gap-4), and SheetContent's overflow-y-auto nests a second scroll container. Fix: move Actions to the header or far-left; variant="destructive" on Delete; SheetContent as flex flex-col + flex-1 min-h-0 overflow-y-auto + SheetFooter; drop overflow-y-auto from SheetContent. → /impeccable layout

## Persona Red Flags

Alex (power user, 20 employees/hour): no <form> so Enter never submits; single-open accordion means two expand cycles per user; no next/prev user; Employment Type is a DropdownMenu so no type-ahead; Save stays disabled after an instant toggle with no tooltip.

Sam (screen reader + keyboard): zero htmlFor/id pairs outside the gender radios — all 20 labels decorative, clicking one doesn't focus the field; Address and Emergency Contact are placeholder-only; saveMessage has no role="status"/aria-live and self-destructs in 3s; errors have no aria-describedby/aria-invalid; the DOB trigger button (:443) has no accessible name; read-only data (Work Email, Time Zone, Created At, Last Login) rendered as disabled inputs is skipped in tab order — Sam cannot reach the work email at all.

Morgan (HR admin, same-day offboarding): an archived user's banner says "Account Disabled", never "Archived"; toggling the banner switch on an archived user silently un-archives them back into the Employee Registry (:194-196) while the dialog says only "restore access"; Archive and Delete are 8px apart in one menu.

## Minor Observations

- UserDetailDrawer destructures onAddGroupMembers, onRemoveGroupMember, onRefetch and uses none; groups is in the props interface and never destructured. No group-membership UI — amputated feature still wired to the parent.
- No SheetDescription/aria-describedby → Radix a11y warning on every open.
- parseInt(...) || 0 snaps a cleared leave field to 0; no max, so 99,999 days is grantable.
- DOB loads via toISOString().split('T')[0] but saves via toLocaleDateString('en-CA') — two timezone semantics; an untouched record can shift a day on save.
- isActive local state never re-syncs to external changes; only a uid change remounts.
- select.tsx and textarea.tsx exist in src/components/ui and are unused here.
- This Accordion is the only one in the entire admin surface.

## Questions to Consider

1. Should this panel be able to delete a user at all? Archive is reversible and data-preserving; Delete cascades across nine collections and two storage prefixes. What if Delete lived only in the Archived Users view, so the irreversible act is always preceded by a reversible one?
2. Why is there a deferred-save form here at all? If profile fields auto-saved on blur with a toast, hasChanges, originalDataRef, saveMessage, Cancel, the footer, the unsaved-changes bug and the invisible-validation bug all disappear at once.
3. If the account-status banner is the most dominant element in the panel, is editing a phone number this panel's job? Employee record and employee access control are two objects sharing one 500px column and one scroll position.

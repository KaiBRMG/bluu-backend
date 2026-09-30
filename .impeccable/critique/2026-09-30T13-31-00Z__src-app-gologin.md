---
target: all GoLogin interfaces (src/app/gologin)
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\kaijn\\Documents\\bluu-backend\\src\\app\\gologin"
timestamp: 2026-09-30T13-31-00Z
slug: src-app-gologin
---
Method: dual-agent (A: a432e327e7755f3bf · B: add3f467502f3f919). Source-only: /gologin is Electron-only (middleware rewrites browser traffic), browser step skipped.

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Launch has no pending state until main broadcasts; failed rows show bare "Retry" |
| 2 | Match System / Real World | 3 | Sharing pills don't say what a click does |
| 3 | User Control and Freedom | 2 | Only Delete has Undo; clearFilters wipes the query |
| 4 | Consistency and Standards | 3 | Retyped primary/danger fills in older files; two focus-ring recipes |
| 5 | Error Prevention | 2 | Rows reorder under cursor; folder edits are silent access grants |
| 6 | Recognition Rather Than Recall | 3 | j/k undiscoverable; search scoped to Pinned implicitly |
| 7 | Flexibility and Efficiency | 3 | No multi-select, no key to open row menu |
| 8 | Aesthetic and Minimalist Design | 3 | Unbounded row right lane |
| 9 | Error Recovery | 3 | Launch-failure toasts don't name the profile |
| 10 | Help and Documentation | 3 | No shortcut reference |
| Total | | 28/40 | Good |

## Design Specificity
Authored for the product (Ping proxy w/ country, locked fingerprint, via-REPOST, listing age, CloseGuard). Detector: 0 findings over 19 files (exit 0).

## Priority Issues
- [P1] Rows reorder under the cursor on Launch (page.tsx live-first sort) and on EditFolders toggle (members-first sort). Fix: freeze order per listKey; optimistic starting state; compute EditFolders order on select/search. harden
- [P1] Folder edits are silent access grants (live folder shares). Fix: sharedWithCount on GoLoginFolderRow, "shared with N" in FolderChecklist + EditFolders header, confirm widening adds. clarify, harden
- [P1] Row "Share profile" opens people-first Sharing with a name-substring query and nobody selected. Fix: pass profile id; profile-scoped mode listing members Direct/via folder/None. shape
- [P2] Single-profile share/unshare has no Undo and no verb in accessible name. Fix: Undo on toast; aria-label with verb. harden
- [P2] Pinned default traps search; "Clear them" wipes query. Fix: "No pinned profile matches — Show N in All". clarify

## Persona Red Flags
Alex: j/k undiscoverable; no row-menu key; inert row folder chips; no multi-select; focus jumps after launch.
Sam: session transitions unannounced; Sharing buttons lack verbs; opacity-50 disabled pane; onboarding done-tick aria-hidden; h2 eyebrow before h1.
Shift operator: one-item ⋯ menu; new shares hidden behind Pinned; Retry without reason.

## Minor Observations
"Its 1 profile are kept"; delete copy "a few seconds" vs 10s toast; stale MembersPanel comment; starting row idle dot; uncapped row folder chips; EditProfile sheet closes dirty without warning; filler OS hints; "Without proxy" one click.

## Questions to Consider
Is folders a sharing permission in disguise? Should management be a mode separate from launching? Is Sharing's axis backwards for the common case?

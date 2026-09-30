---
target: all GoLogin interfaces (src/app/gologin) — after fixes
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\kaijn\\Documents\\bluu-backend\\src\\app\\gologin"
timestamp: 2026-09-30T14-05-19Z
slug: src-app-gologin
---
Method: dual-agent (A: a09a612c3bfeee661 · B: a0e5232092c35e91a). Source-only; /gologin is Electron-only.

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Failed-launch reason survives only in a title tooltip |
| 2 | Match System / Real World | 3 | "Release", title-case "Proxy Error" |
| 3 | User Control and Freedom | 3 | Edit-folders toggles lack Undo; Orbita gate uncancellable, blocks Stop |
| 4 | Consistency and Standards | 2 | Three safety models for folder grants; re-inked focus rings; starting dot green vs blue |
| 5 | Error Prevention | 2 | Proxy change shows no before/after location; "Without proxy" unguarded; Launch unguarded when running outside Bluu |
| 6 | Recognition Rather Than Recall | 3 | Failure reason gone with toast |
| 7 | Flexibility and Efficiency | 3 | j/k lands on Release; Enter in search does nothing |
| 8 | Aesthetic and Minimalist Design | 3 | Header can stack 8 lines; ~40 11px explanations |
| 9 | Error Recovery | 3 | Proxy-error remedy tells operators to fix it in GoLogin |
| 10 | Help and Documentation | 3 | Inline reasoning everywhere, arguably too much |
| Total | | 28/40 | Good |

Detector: 0 findings (exit 0).

## Priority Issues
- [P1] Proxy change shows less evidence than create: no current exit location, no country diff, "Without proxy" unguarded (EditProfileSheet). harden, clarify
- [P1] Edit folders toggles are unannounced grants/revokes: no toast/Undo; FolderChecklist names gainers but not losers. harden
- [P1] Launch unguarded when GoLogin reports the profile running outside Bluu (liveElsewhere). harden
- [P2] OrbitaGate/CloseGuard don't move focus or inert the list; spinners lack activity-spinner; backdrop blur. audit, harden
- [P2] Unpinning in Pinned view removes the row under the cursor. harden

## Persona Red Flags
Alex: j/k stops on Release; no Enter-to-launch from search; no member search in profile-first Sharing.
Sam: overlays don't trap focus; failure reasons tooltip-only; Starting/Stopping unannounced.
Operator: proxy-error copy points to GoLogin; id + folder chips unused; Orbita download locks everything; pin toggle beside Launch.

## Minor Observations
Re-inked focus rings; starting dot colour mismatch; delete copy describes toast mechanics; Edit sheet editable while locked; duplicate id="proxy-protocol"; truncated notes unreadable; no seat-cap warning on Add member.

## Questions to Consider
Should the operator row be only dot, name, Launch? Should every Edit sheet open with the current exit pinged? Should folders and sharing collapse into one grant/revoke model?

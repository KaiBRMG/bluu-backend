---
target: src/app/training
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/kai/Projects/bluu-backend/src/app/training"
timestamp: 2026-10-29T10-19-13Z
slug: src-app-training
---
Method: dual-agent (A: a07aa6aa64d2de2a9 · B: a7e053636593f8c64)

# Critique: src/app/training (candidate side, source-only; detector 0 findings)

Score 26/40 (Acceptable). H1 3, H2 3, H3 2, H4 3, H5 2, H6 3, H7 2, H8 3, H9 3, H10 2.

Specificity: room and clock grammar are authored; gate, Home and pre-Start page are category-default. Inline-hex drift: 28 lines literal #00b8f5, #7dd8fa x4 undocumented, #04141c once.

## Priority issues
- [P1] T7 and task record say "saved" without knowing (SequenceRoom.tsx:66-68,115-119,177; EditRoom.tsx:98) - harden
- [P1] Silent loss paths: drops outside zones navigate away (SlotUploader.tsx:69-72, WorkingFiles.tsx:118-122), no beforeunload, no Retry/Remove on failed working files - harden
- [P2] Time-critical state only visible if staring: banners not pinned, progress/recording hidden below lg, no tab-title clock (EditRoom.tsx:197,202,297-306; Countdown.tsx) - adapt
- [P2] End of test is thin: explainer re-expands (ModuleView.tsx:180), recorder flush unsaid, focus lost, live region inserted filled - clarify
- [P2] Pre-Start tells truth late, no help path: wrong disabled hint (ModuleView.tsx:650 vs :269), desktop-only learned at screen check, Home hop, no contact line - onboard

## Personas
Jordan, Casey, Sam, Nia (nervous candidate) - see chat report.

# Terms of Use & Privacy Policy — source of record

The published document lives in [`page.tsx`](page.tsx) and is served at `/terms`.
**That page is the single source of record.**

This file previously held a second, plain-markdown copy of the terms. It drifted
out of date (it still carried the March 2026 text after the page had moved on to
August 2026), which is a real legal risk: two versions of an agreement, both
checked in, neither marked as authoritative. It has therefore been reduced to
this pointer.

## When you change the terms

1. Edit `page.tsx` only.
2. Bump **both** `VERSION` and `EFFECTIVE_DATE` at the top of that file. They are
   the only record of which version a user accepted — `hasAcceptedTerms` on the
   user doc is a bare boolean with no version stamp.
3. If the change is material, notify users before the effective date (clause 1
   commits us to this).

If you need a plain-text or PDF copy to send to a lawyer, export it from the
rendered page rather than re-typing it here.

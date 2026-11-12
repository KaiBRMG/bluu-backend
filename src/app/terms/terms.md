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
2. Bump **both** `TERMS_VERSION` and `TERMS_EFFECTIVE_DATE` in
   [`src/lib/terms.ts`](../../lib/terms.ts) (the page imports them). **A bump signs
   every employee out** — once they are clocked out and inactive — and signing back
   in is their acceptance; `users/{uid}.acceptedTermsVersion` records which version.
   So bump only for a substantive edit, never for a typo.
3. If the change is material, notify users before the effective date (clause 1
   commits us to this).
4. Add new audiences or clauses at the **end** (as Part E was in v3.0). Other
   surfaces and the docs cite Parts and clauses by letter and number, so do not
   insert or renumber.

If you need a plain-text or PDF copy to send to a lawyer, export it from the
rendered page rather than re-typing it here.

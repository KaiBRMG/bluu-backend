# Instagram / Telegram are now genuinely optional

**Status:** build compiles, lint clean.

---

## What was wrong

My bug, and a self-inflicted one. In the original brief I added a rule requiring **at least one** of Instagram or Telegram, on the reasoning that "an application we cannot reply to is useless". Two problems with it:

1. **It contradicted the interface.** Both fields render an "Optional" marker, so the form told you one thing and the validator enforced another. That's the worst kind of form bug — there is no way to guess what it wants.
2. **It wasn't in the spec, and it was redundant.** `form.md` marks only Name and Email as required in section 1. Email is required, so we can always reach an applicant; the extra rule bought nothing.

The error also surfaced under the *Telegram* field regardless of which one you'd left blank, which made it read as "Telegram is required" — directly contradicting the word "Optional" sitting on the same label.

## The fix

Removed the rule from both places it ran:

- `submissionSchema` — its `superRefine` now carries only the genuine conditional (social links become required once the applicant says they have an OnlyFans account).
- `stepSchemas.info` — now a plain object, so **Continue** on step 1 gates on name and email only.

Both were fed by one shared `contactRefinement` helper, now deleted, so there's no path left that can enforce it.

I left a comment at the removal site explaining why it's gone, so it doesn't get "helpfully" reintroduced later without the field labels changing to match:

```ts
/**
 * Instagram and Telegram are genuinely optional, exactly as the form says.
 *
 * There was briefly a rule here requiring at least one of them — it contradicted
 * the "Optional" label on both fields, and it was redundant besides: email is
 * required, so we can always reach an applicant. Don't reintroduce it without
 * also changing what the fields say.
 */
```

Nothing else in the client, the API, or the Firestore write required either field, so this is the whole change — the server re-parses the same schema, so it agrees automatically.

## Still required on step 1

- **Name** — 2–80 characters
- **Email** — valid format

## Files changed

```
src/lib/modelSubmissions.ts   removed contactRefinement from submissionSchema + stepSchemas.info
```

The Telegram hint still reads "This is where we'll contact you" — that's the copy from `form.md`, and it describes what the field is *for* rather than claiming it's mandatory. Say the word if you'd rather it was softened now that the field is truly optional.

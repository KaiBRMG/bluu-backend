# Prompt Library (`prompt-library` collection)

> `/applications/apps-prompt-library` — a shared store of LLM prompts, one per model, each with its own version history. Three routes share one fetch; search runs entirely on the client.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/types/promptLibrary.ts` | Shared types + the `LLM_META` registry (client-safe) |
| `src/lib/promptDiff.ts` | Version diffing — `summariseChange` (server, O(n)) and `wordDiff` (client, LCS) |
| `src/lib/promptSearch.ts` | The client-side fuzzy search engine (`PromptSearchIndex`, `searchPrompts`) |
| `src/lib/services/promptLibraryService.ts` | Server-only Firestore read/write; 60s in-process cache |
| `src/app/api/prompt-library/route.ts` | GET the whole library + taxonomy · POST create |
| `src/app/api/prompt-library/[id]/route.ts` | PATCH metadata/archive · DELETE (**admin claim**) |
| `src/app/api/prompt-library/[id]/versions/route.ts` | GET history · POST a new version |
| `src/app/api/prompt-library/taxonomy/route.ts` | POST coin labels · DELETE retire a label |
| `src/contexts/PromptLibraryContext.tsx` | One provider for the whole route subtree; sessionStorage cache, 5 min, key `bluu_prompt_library_v1` |
| `src/app/(main)/applications/apps-prompt-library/` | The three surfaces + `_components` / `_lib` |
| `src/scripts/build-prompt-library-logos.js` | One-off asset normaliser (PNG → WebP marks) |

## Firestore

- **`prompt-library/{promptId}`** — the head of a prompt. Carries the **current text** alongside its metadata, so the list, the search index and the detail card's default view are all served by one collection read.
- **`prompt-library/{promptId}/versions/{n}`** (subcollection) — the full text of every version. Document id is the version number as a string. **Lazy** — only read when a detail card opens.
- **`prompt-library-meta/taxonomy`** — the managed `categories[]` / `tags[]` lists.
- **Rules:** all three deny `read, write` (firestore.rules #23). Every access is Admin-SDK-only through the API routes.
- **No composite indexes.** The service does one unfiltered `.get()` and sorts in memory, exactly as `resourceService` does.

### Head document schema

| Field | Type | Notes |
|---|---|---|
| `llmType` | `'chatgpt' \| 'claude' \| 'grok' \| 'higgsfield' \| 'wavespeed'` | Also the URL segment |
| `category` | string | Single value, drawn from the managed list |
| `title` | string | ≤160 chars |
| `tags` | string[] | ≤20, deduped case-insensitively |
| `text` | string | **Current** version's text, ≤100,000 chars |
| `version` / `versionCount` | number | Both equal the head version number |
| `basedOn` | number \| null | Which version the current one was edited from |
| `change` | `ChangeStat` \| null | `{added, removed, ratio, region, kind}` for the current version |
| `isArchived` | boolean | Hidden from lists and search; recoverable |
| `createdTime` / `lastUpdatedTime` | string (ISO) | |
| `createdBy` / `lastUpdatedBy` | string (uid) | |
| `createdAt` / `updatedAt` | Timestamp | Audit fields |

## Authorization

- Reads and ordinary writes: the **`apps-prompt-library` page permission** (tier 2, via `checkPageAccess`). Anyone with the page can create prompts, save versions, edit metadata, archive, and coin labels.
- **Hard delete requires the `token.admin` claim** (tier 3). Archiving is the reversible act anyone can take; destroying a version history is not. See [auth.md](auth.md#authorization-tiers-least--most-privileged).

## Versioning

`POST /api/prompt-library/[id]/versions` takes `{ text, basedOn }` where **`basedOn` is the version the editor was actually looking at**, which may not be the head. The whole write runs in a transaction that reads the head and the `basedOn` version together, diffs against **that** version's text, and appends the result at `versionCount + 1`.

This is what makes the lineage truthful: edit v3 and you get v4 "Edited from v3"; then reach back and edit v2 and you get v5 "Edited from v2". An unchanged save returns **409** rather than creating a no-op version. Metadata edits (`PATCH`) never cut a version — the history is the history of the prompt *text*.

### The two-tier diff

| | When | Cost | Stored? |
|---|---|---|---|
| `summariseChange` | Server, at save | O(n) — prefix/suffix trim then a multiset difference | Yes, on the version doc |
| `wordDiff` | Client, on "Show changes" | LCS over the **trimmed** span only | No |

`summariseChange` reports `added` / `removed` word counts, a `ratio`, a `kind` (`tweak` < 8%, `edit` < 35%, `rewrite`), and a `region` (`start` / `middle` / `end` / `throughout`) derived from where the trimmed span sits. `describeChange` renders that as one line: *"Rewrite · +182 / −45 words · near the end"*.

Comparison is **case-sensitive** — in a prompt, `must` and `MUST` are different instructions. `canRenderDiff` measures the trimmed span, not the prompt length, so a one-word fix inside a 5,000-word prompt still renders inline; only a genuinely large rewrite (>1M LCS cells) falls back to the stored summary.

## Search

`src/lib/promptSearch.ts` runs on the client over the cached list — **typing costs zero Firestore reads**. Fields and weights: title 6, category 4, tags 4, model 3, people 3, date 3, prompt text 2.

- Multiple words are **AND**-ed, but each word may match a different field.
- Per-term quality: exact 1.0 → word-prefix 0.85 → substring 0.7 → bounded edit-distance 0.45. Fuzzy is **skipped on prompt text**, where substring already covers partials and a long body would match almost any typo by chance.
- `"quoted phrases"` are treated as a single term.
- Dates are indexed in several written forms (`13 August 2026`, `13 Aug 2026`, `2026-08-13`, `13/08/2026`, weekday), so the search box handles a date with no separate filter.
- People come from `useUserName` (uid → displayName), so the resolved names are part of the index cache key.
- `PromptSearchIndex` memoises tokenisation per prompt; keystrokes re-run scoring only.

Search is always **library-wide**. The `scope` prop only changes presentation: on a model page, a hit belonging to another model is flagged `in ⟨mark⟩ Claude` and sorted below the in-scope hits.

The input is a **combobox** (`role="combobox"` + `aria-activedescendant`) over a `role="listbox"` of result rows, so the arrow-key cursor is announced rather than being visual-only. Each row is a whole-row target with the `option` role on the `<li>` itself — options own no nested controls, which is why there is no per-row button.

## Read/write budget

- **One** provider (`PromptLibraryProvider`, mounted in the segment `layout.tsx`) serves the home screen, every model page and every detail card — navigating between them refetches nothing.
- Client cache: sessionStorage, 5-min TTL. Server cache: 60s in-process, busted by every write.
- Mutations **patch state and the cache in place**; no write is followed by a re-read.
- Version histories are fetched per prompt on first open and memoised for the session.
- Coining a label writes; reusing one does not (`mergeTaxonomy` skips the write when nothing is new).

## Taxonomy

Categories and tags live in `prompt-library-meta/taxonomy` rather than being derived from prompts, so a label **persists while empty** — a category can be created before anything uses it, and archiving the last prompt in a category does not delete the category. Retiring a label removes it from the pickers; prompts already carrying it keep it. Both pickers create-or-choose in one control (`_components/LabelPicker.tsx`).

## Logo assets

Sources are five 1000×1000 PNGs in `src/public/prompt-library-llm-logos/`, and they are **not** uniform: ChatGPT and Grok are black-on-transparent (invisible on the canvas), WaveSpeed is white on an opaque black square, Higgsfield is a full-bleed lime tile, Claude is orange-on-transparent.

`src/scripts/build-prompt-library-logos.js` normalises them into `.webp` siblings — negating the black marks, lifting WaveSpeed out of its box via its own luminance as an alpha channel, then trimming and re-padding every mark to the same optical weight. Run it from `src/` after replacing any source PNG:

```bash
node scripts/build-prompt-library-logos.js
```

The app references only the `.webp` files (via `LLM_META`), rendered through `next/image` — the same brand-mark escape hatch the sidebar uses for the OnlyFans SVG. 1.0 MB of PNG becomes 36 KB of WebP.

## Adding a model

1. Add the id to `LLM_TYPES` and an entry to `LLM_META` in `src/types/promptLibrary.ts`.
2. Drop the source PNG into `src/public/prompt-library-llm-logos/`, add it to `SOURCES` in the build script (with a transform and an optical nudge), and re-run the script.

No Firestore migration is needed; the routes validate against `LLM_TYPES`.

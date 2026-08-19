# Prompt Library (`prompt-library` collection)

> `/applications/apps-prompt-library` — a shared store of LLM prompts, each targeting one or more models, each with its own version history. Two routes share one fetch; search runs entirely on the client; **the detail card is a dialog, not a page**.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/types/promptLibrary.ts` | Shared types, the `BUILTIN_MODELS` seed, `mergeModels`, `llmLogoCandidates` (client-safe) |
| `src/lib/promptHtml.ts` | The rich-text dialect: `sanitizePromptHtml`, `htmlToPlainText`, `promptBodyHtml` (isomorphic) |
| `src/lib/promptDiff.ts` | Version diffing — `summariseChange` (server, O(n)) and `wordDiff` (client, LCS) |
| `src/lib/promptSearch.ts` | The client-side fuzzy search engine (`PromptSearchIndex`, `searchPrompts`) |
| `src/lib/services/promptLibraryService.ts` | Server-only Firestore read/write; 60s in-process cache |
| `src/app/api/prompt-library/route.ts` | GET the whole library + taxonomy · POST create |
| `src/app/api/prompt-library/[id]/route.ts` | PATCH metadata/archive · DELETE (**admin claim**) |
| `src/app/api/prompt-library/[id]/versions/route.ts` | GET history · POST a new version |
| `src/app/api/prompt-library/taxonomy/route.ts` | POST coin labels **and models** · DELETE retire one |
| `src/contexts/PromptLibraryContext.tsx` | One provider for the whole route subtree; sessionStorage cache, 5 min, key `bluu_prompt_library_v2` |
| `src/app/(main)/applications/apps-prompt-library/` | The surfaces + `_components` / `_lib` |
| `src/scripts/build-prompt-library-logos.js` | One-off asset normaliser (PNG → WebP marks) |

## Firestore

- **`prompt-library/{promptId}`** — the head of a prompt. Carries the **current text** alongside its metadata, so the list, the search index and the detail card's default view are all served by one collection read.
- **`prompt-library/{promptId}/versions/{n}`** (subcollection) — the full text of every version. Document id is the version number as a string. **Lazy** — only read when a detail card opens.
- **`prompt-library-meta/taxonomy`** — the managed `categories[]` / `tags[]` / **`models[]`** lists.
- **Rules:** all three deny `read, write` (firestore.rules #23). Every access is Admin-SDK-only through the API routes.
- **No composite indexes.** The service does one unfiltered `.get()` and sorts in memory, exactly as `resourceService` does.

### Head document schema

| Field | Type | Notes |
|---|---|---|
| `llmTypes` | string[] | **Every** model this prompt is for. See the compatibility note below |
| `llmType` | string | **Legacy mirror of `llmTypes[0]`.** Still written, never the source of truth once `llmTypes` exists |
| `category` | string | Single value, drawn from the managed list |
| `title` | string | ≤160 chars |
| `tags` | string[] | ≤20, deduped case-insensitively |
| `text` | string | **Current** version's PLAIN text, ≤100,000 chars |
| `textHtml` | string \| null | Rich rendering of `text`. `null` for a prompt with no formatting |
| `version` / `versionCount` | number | Both equal the head version number |
| `basedOn` | number \| null | Which version the current one was edited from |
| `change` | `ChangeStat` \| null | `{added, removed, ratio, region, kind}` — still computed and stored, no longer displayed |
| `editNote` | string | The author's note for the current version. `''` when none |
| `isArchived` | boolean | Hidden from lists and search; recoverable |
| `createdTime` / `lastUpdatedTime` | string (ISO) | |
| `createdBy` / `lastUpdatedBy` | string (uid) | |
| `createdAt` / `updatedAt` | Timestamp | Audit fields |

## Authorization

- Reads and ordinary writes: the **`apps-prompt-library` page permission** (tier 2, via `checkPageAccess`). Anyone with the page can create prompts, save versions, edit metadata, archive, coin labels, and **add a model type**.
- **Hard delete requires the `token.admin` claim** (tier 3). Archiving is the reversible act anyone can take; destroying a version history is not. See [auth.md](auth.md#authorization-tiers-least--most-privileged).

## Many models per prompt — and no migration

A prompt targets a **set** of models, not one. The compatibility story is the whole design:

- **Reading**: `readLlmTypes` prefers `llmTypes`, and falls back to the singular `llmType` when it is absent. Every document written before this change therefore reads correctly with **no backfill and no migration script**.
- **Writing**: both fields are written on every create and metadata update — `llmType` is set to `llmTypes[0]`. That is not belt-and-braces, it is [rule 9c](../CLAUDE.md#cross-cutting-rules-do-not-violate): a renderer that has been open for weeks is still running the single-model bundle, and dropping the field would make every new prompt modelless for that user.
- **An unregistered id is never dropped.** `cleanModelIds` validates the *shape* of an id, not its membership in the managed list, so retiring a model does not orphan the prompts on it.
- The `[llm]` page filters with `llmTypes.includes(slug)`, so a prompt on three models appears under all three. The home tile counts do the same — a prompt counts once per model.

## Model types are managed data

`prompt-library-meta/taxonomy.models` holds **user-added models only**. The original five stay in code as `BUILTIN_MODELS`, so the library still renders if the meta document is missing, and `mergeModels` merges the two at read time.

- **Ordering is by recency of addition, newest first.** `addedAt` is `Date.now()` for anything added through the UI and a non-positive seed (`-index`) for the built-ins — so a newly coined model always leads, and the built-ins keep their original relative order below it. The home screen's model strip is horizontally scrollable for exactly this reason: the list grows.
- **Adding one** is a name and nothing else (`AddModelDialog` → `POST /api/prompt-library/taxonomy` with `models: [{id, name}]`). The id is the slugified name and doubles as the URL segment.
- A custom entry sharing a built-in id only **renames** it; the built-in's mark is kept.

### Icons resolve from the id, at render time

There is no upload path and no code change involved in giving a model an icon. `LlmMark` walks `llmLogoCandidates(model)`:

1. the built-in's explicit normalised `.webp`, if it is a built-in; otherwise
2. `/prompt-library-llm-logos/<id>.webp`, then
3. `/prompt-library-llm-logos/<id>.png`,
4. and finally a **monogram** — the model's initial in a muted tile — when neither file exists.

So committing `src/public/prompt-library-llm-logos/<id>.png` is the entire job, and the model renders correctly (without a mark) until then. Running `node scripts/build-prompt-library-logos.js` afterwards is optional polish — it produces the `.webp` sibling that candidate 2 picks up.

## Rich text: two representations, one truth

The body is stored twice, on both the head and every version document:

| | What | Who uses it |
|---|---|---|
| `text` | The plain-text projection. **Canonical.** | Copy to clipboard, the search index, the version diff, every pre-formatting prompt |
| `textHtml` | The presentation layer, or `null` | The detail card's editor and viewer |

The dialect is **four marks and two lists** — `b/strong`, `i/em`, `u`, `ul/ol/li`, plus the `p/div/br` the browser emits — and **no attributes at all survive sanitisation**. That total attribute strip is what makes rendering it with `dangerouslySetInnerHTML` safe: there is no `href`, `style`, `src` or `on*` for anything to hide in. `sanitizePromptHtml` runs on the **server at write** and again in the **renderer at read**, from the same isomorphic function, so neither the client nor the database is trusted.

Three consequences worth knowing before touching `promptHtml.ts`:

- **When rich markup is supplied, `text` is DERIVED from it server-side** (`resolveBody`), never taken from the client. The two can't disagree about what the prompt says.
- **`textHtml` is only written once a mark is actually applied** (`hasRichFormatting`). Editing a plain prompt without formatting it leaves it plain in Firestore, exactly as before.
- **`htmlToPlainText` must not collapse blank lines, and must drop the `<br>` inside an empty block.** A browser writes an empty line in `contentEditable` as `<div><br></div>` — a `<br>` *and* a block close. Counting both doubles every blank line on each save, silently re-flowing prompts already in production. The ordering in that function is load-bearing.

The editor (`RichPromptEditor`) is `contentEditable` + `document.execCommand`. Deprecated, and chosen anyway: the four marks are exactly what it already implements correctly against a live selection, and this renderer is Chromium by construction. The consequence is that **the DOM owns the text while you type** — the body is written in once on mount, pushed in imperatively on a version switch, and read out on change. Pastes are forced to plain text.

**Shortcuts:** `Ctrl/⌘+B`, `+I`, `+U`, and `Ctrl/⌘+Shift+8` for the bullet list (the one Docs and Word use). Chromium implements the first three natively inside `contentEditable`, but `onKeyDown` intercepts them anyway so they run through the same path as the toolbar — that is what keeps the buttons' pressed state honest and publishes the draft on the same tick, and it is the only way the list gets a shortcut at all. The digit shortcut is matched on `e.code`, since Shift+8 reports `e.key` as `*`. Each shortcut is in the button's `aria-label`, not only its `title` — a tooltip is unreachable by keyboard, which is exactly the audience.

> **`Ctrl/⌘+B` collides with the sidebar toggle**, which `components/ui/sidebar.tsx` binds on the **window**. That is closed from both ends, and both halves are needed:
> - the editor calls `stopPropagation()`, which handles the ordinary case but **cannot be relied on alone** — the detail card is a portalled dialog, so the native event does not necessarily bubble through React's root container;
> - `sidebar.tsx` carries a **local modification** — it ignores a keystroke whose `event.target.isContentEditable` is true, and any already-`defaultPrevented` event. Plain inputs and textareas are deliberately not excluded, so the sidebar shortcut still works from a search box.
>
> That guard is the general fix, so a future rich-text surface inherits it. **`npx shadcn add sidebar --overwrite` would silently delete it** — it is commented in place as a local modification for that reason.

**The body sets `font-normal` explicitly, and marks render at 900 plus a text-stroke.** `globals.css` sets `body { font-weight: 500 }` app-wide, so prompt text left to inherit reads as already bold and only 500→700 separates it from an actual `<b>`. The editor drops its base to 400 and lifts `b`/`strong` to `font-black` + white. The `-webkit-text-stroke` alongside it is not decoration: Google Sans may ship no 900 face, and a missing weight is silently served as the nearest one available — so `font-black` alone can render identically to `font-bold`. Stroking the glyph thickens it whatever faces exist. Don't remove the `font-normal` as redundant either; it is doing work.

**The toolbar is one tab stop, not four.** It declares `role="toolbar"`, so it owes the interaction that role implies (APG): a **roving tabindex** — only the button at `toolbarIndex` is tabbable, `ArrowLeft`/`ArrowRight` wrap between them, `Home`/`End` jump to the ends, and `onFocus` re-seats the cursor so a click and the keyboard never disagree. Declaring the role without this is worse than omitting it, because a screen reader announces "toolbar, 4 items" and the arrow keys then do nothing. Don't "simplify" it back to four plain toggles.

**The toolbar belongs to the editor but is placed by the caller.** It reads `queryCommandState` off the live selection and acts on this editor's caret, so it cannot be a separate component — but it is portalled into a `toolbarHost` node the detail card renders in the **version rail**, next to "First version" / "Edited from vN", rather than floating above the text. The host is held in `useState` (not a ref) because the editor needs a re-render once the node exists.

## Versioning

`POST /api/prompt-library/[id]/versions` takes `{ text, textHtml, editNote, basedOn }` where **`basedOn` is the version the editor was actually looking at**, which may not be the head. The whole write runs in a transaction that reads the head and the `basedOn` version together, diffs against **that** version's text, and appends the result at `versionCount + 1`.

This is what makes the lineage truthful: edit v3 and you get v4 "Edited from v3"; then reach back and edit v2 and you get v5 "Edited from v2". An unchanged save returns **409** — and "unchanged" now compares **both** layers, so applying bold and nothing else is a real version. Metadata edits (`PATCH`) never cut a version — the history is the history of the prompt *body*.

### Edit notes

Every version can carry an `editNote` (≤2,000 chars), written by the author at save time and displayed above the body on the detail card, in the version's own voice.

The note is **captured in the save bar**, beside the button that consumes it — taking every pixel the Revert/Save buttons do not, because it is prose and prose needs the width. It **only appears once the body is actually dirty** — a permanently visible note box reads as required on a card that is mostly opened to read. It replaced the old one-line change summary (*"Rewrite · +4 words · near the end"*), which was removed on purpose: a word count and a rough position are not what anyone wants to know about an edit. `describeChange` and `changeKindLabel` are **gone** from `promptDiff.ts`; `ChangeStat` is still computed and still stored on every version, so nothing about the stored shape changed.

### The two-tier diff

| | When | Cost | Stored? |
|---|---|---|---|
| `summariseChange` | Server, at save | O(n) — prefix/suffix trim then a multiset difference | Yes, on the version doc |
| `wordDiff` | Client, on "Show changes" | LCS over the **trimmed** span only | No |

Comparison is **case-sensitive** — in a prompt, `must` and `MUST` are different instructions. `canRenderDiff` measures the trimmed span, not the prompt length, so a one-word fix inside a 5,000-word prompt still renders inline; only a genuinely large rewrite (>1M LCS cells) falls back to a message. The diff runs on `text`, never on `textHtml`.

## The detail card is a dialog

Opening a prompt no longer navigates. `PromptDetailDialog` renders over whichever surface opened it — the board, the model page, a search result — so the library stays visible behind it.

- **`/[llm]/[id]` still exists**, purely so links and bookmarks made while it was a page keep working. It renders the model board with `initialPromptId` set, which is what a click from anywhere else produces anyway. A deep link to a deleted prompt shows "Prompt not found" with a reload, rather than closing silently.
- **Every exit routes through one guard.** The draft lives inside the dialog body, but Escape and the overlay are handled by the `Dialog`, so the body registers a close guard with the wrapper (`registerGuard`). Escape, a click outside, and the Close button therefore all hit the same "discard your unsaved changes?" confirmation — without it, two of the three would drop an unsaved version on the floor.
- **`switchTo` advances `viewingRef` before pushing the body in.** The editor echoes the new body back synchronously, and that echo becomes the version's "unchanged" baseline; attribute it to the previous version and every subsequent keystroke reads as clean. Don't reorder those lines.

## The board

Both the home screen's "Recently updated" section and the model page render `PromptKanban`: one column per category, cards showing **title, version, model marks and last-edited**. Columns are ordered by their own most-recent update, and cards within a column by recency — so the board *is* a recently-updated view that happens to be grouped.

**Masonry, via CSS multi-column — not a grid.** Three columns at `lg`, two at `sm`, one below. A grid lays out in *rows*, so every category in a row starts at the same y and the short ones leave a dead gap beneath them until the next row begins; multi-column flows each category into the shortest column, so nothing is padded out to match a taller neighbour. The trade is reading order — content runs down column one, then down column two — which suits a board ordered by recency, since the most recently touched categories sit top-left. Each category carries `break-inside-avoid`, or a column break through the middle of one would orphan its cards under the next heading.

**Model marks sit at the trailing edge of a row, never the leading edge.** A prompt can carry any number of models, so the strip's width varies — leading it would give every title a different left edge. `LlmMarks` caps the visible marks and shows a `+n` overflow.

## Search

`src/lib/promptSearch.ts` runs on the client over the cached list — **typing costs zero Firestore reads**. Fields and weights: title 6, category 4, tags 4, model 3, people 3, date 3, prompt text 2.

- Multiple words are **AND**-ed, but each word may match a different field.
- Per-term quality: exact 1.0 → word-prefix 0.85 → substring 0.7 → bounded edit-distance 0.45. Fuzzy is **skipped on prompt text**, where substring already covers partials and a long body would match almost any typo by chance.
- `"quoted phrases"` are treated as a single term.
- Dates are indexed in several written forms (`13 August 2026`, `13 Aug 2026`, `2026-08-13`, `13/08/2026`, weekday), so the search box handles a date with no separate filter.
- **All of a prompt's models are indexed**, by display name *and* id — a prompt on ChatGPT and Claude answers to either. Model names resolve asynchronously (they are managed data now), so `resolveModel` is part of the index cache stamp alongside `resolveName`.
- `PromptSearchIndex` memoises tokenisation per prompt; keystrokes re-run scoring only.

Search is always **library-wide**. The `scope` prop only changes presentation: on a model page, a hit belonging to other models is flagged and sorted below the in-scope hits. Selecting a hit opens the detail dialog in place.

The input is a **combobox** (`role="combobox"` + `aria-activedescendant`) over a `role="listbox"` of result rows, so the arrow-key cursor is announced rather than being visual-only.

## Read/write budget

- **One** provider (`PromptLibraryProvider`, mounted in the segment `layout.tsx`) serves the home screen, every model page and every detail card — navigating between them refetches nothing, and opening a prompt is now not even a navigation.
- Client cache: sessionStorage, 5-min TTL, key `bluu_prompt_library_v2`. **The key was bumped** because the cached shape gained `taxonomy.models`, `llmTypes` and the rich body; a stale `_v1` entry would render a modelless library. Server cache: 60s in-process, busted by every write.
- Mutations **patch state and the cache in place**; no write is followed by a re-read.
- Version histories are fetched per prompt on first open and memoised for the session.
- Coining a label or a model writes; reusing one does not (`mergeTaxonomy` skips the write when nothing is new).

## Taxonomy

Categories, tags and models live in `prompt-library-meta/taxonomy` rather than being derived from prompts, so a label **persists while empty** — a category or a model can be created before anything uses it, and archiving the last prompt in a category does not delete the category. Retiring a label removes it from the pickers; prompts already carrying it keep it. Categories and tags create-or-choose in one control (`_components/LabelPicker.tsx`); models are a multi-select chip group (`_components/ModelPicker.tsx`).

## Logo assets

The five built-in sources are 1000×1000 PNGs in `src/public/prompt-library-llm-logos/`, and they are **not** uniform: ChatGPT and Grok are black-on-transparent (invisible on the canvas), WaveSpeed is white on an opaque black square, Higgsfield is a full-bleed lime tile, Claude is orange-on-transparent.

`src/scripts/build-prompt-library-logos.js` normalises them into `.webp` siblings — negating the black marks, lifting WaveSpeed out of its box via its own luminance as an alpha channel, then trimming and re-padding every mark to the same optical weight. Run it from `src/` after replacing any source PNG:

```bash
node scripts/build-prompt-library-logos.js
```

1.0 MB of PNG becomes 36 KB of WebP.

## Adding a model

**Through the UI** — the home screen's "Model Types" section, the *here* link. Nothing else is required; the model is immediately selectable everywhere and renders as a monogram.

**Giving it an icon** — drop `<id>.png` into `src/public/prompt-library-llm-logos/` and commit. It is picked up on the next load with no code change (see *Icons resolve from the id*). Optionally add it to `SOURCES` in the build script with a transform and an optical nudge, and re-run the script, to get the normalised `.webp`.

No Firestore migration is ever needed for either.

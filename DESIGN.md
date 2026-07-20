---
name: Bluu Backend
description: Dark, quiet, information-dense internal management console where the data is the interface.
colors:
  canvas: "#0A0A0A"
  sidebar: "#000000"
  surface: "#171717"
  ink: "#ffffff"
  ink-secondary: "#9ca3af"
  ink-muted: "#6b7280"
  hairline: "#2a2a2a"
  action-blue: "#3b82f6"
  action-blue-deep: "#2563eb"
  status-green: "#4ade80"
  status-blue: "#60a5fa"
  status-orange: "#fb923c"
  status-yellow: "#facc15"
  status-red: "#f87171"
  status-zinc: "#a1a1aa"
  creator-accent: "#8b5cf6"
  creator-accent-deep: "#7c3aed"
  creator-amber: "#f59e0b"
  creator-emerald: "#10b981"
typography:
  display:
    fontFamily: "Google Sans, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "normal"
    fontFeature: "tabular-nums"
  title:
    fontFamily: "Google Sans, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Google Sans, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Google Sans, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  eyebrow:
    fontFamily: "Google Sans, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.06em"
  code:
    fontFamily: "Google Sans, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
    fontFeature: "tabular-nums"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  full: "9999px"
spacing:
  xs: "6px"
  sm: "12px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.action-blue-deep}"
    textColor: "{colors.ink}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  input:
    backgroundColor: "#27272a"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  status-pill:
    backgroundColor: "transparent"
    textColor: "{colors.status-blue}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  widget-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "16px"
---

# Design System: Bluu Backend

## 1. Overview

**Creative North Star: "The Quiet Instrument"**

Bluu Backend is a dark, dense operations console for an internal team — not a product anyone is meant to be delighted by, but one they live inside for eight hours a day. The design philosophy is total deference: chrome recedes to near-black, type is small, spacing is tight, and the data is the interface. It borrows its posture from Notion and Linear — an instrument panel, not a marketing site. Every surface exists to hold information legibly; nothing exists to be admired.

Color is rationed like a signal, never spent as decoration. The interface is greyscale by default — near-black canvas, translucent white overlays, hairline borders — and reaches for hue only when hue *means* something: a status, a priority, a category. Depth is built from layered translucent-white overlays on a dark ground, not from drop shadows. Motion is fast and almost subliminal: 120ms ease-out on color and opacity, a small `scale`/`brightness` nudge on press, and nothing that bounces, slides far, or asks to be watched. This system explicitly rejects the SaaS marketing look: no gradient heroes, no glassmorphism-as-decoration, no oversized display type, no color used for mood. If a screen looks like it wants to sell you something, it is wrong.

The canonical reference implementation is `src/app/(main)/creators/custom-requests/page.tsx` — when in doubt, mirror it. Its overview widgets are the house style for every dashboard and summary surface (the [Signature widget pattern](#5-components)).

**Key Characteristics:**
- Near-black canvas (`#0A0A0A`), low-chroma surfaces, 14px base type, tight spacing.
- Greyscale by default; color is strictly semantic (status / priority / category).
- Soft elevation from translucent white overlays + hairline borders — never shadows.
- Every number is `tabular-nums`; every code/ID is `font-mono`.
- Fast, subtle motion: 120ms ease-out; `hover:brightness-110 active:scale-[0.98]` on tappable rows.

## 2. Colors

A greyscale-on-black palette where the only saturated pixels carry state.

### Primary
- **Action Blue** (`#3b82f6`): The single interactive accent — primary buttons, focus, current selection. Hover deepens to **Action Blue Deep** (`#2563eb`). Used sparingly; it is the one voice that means "act here."

### Neutral
- **Canvas** (`#0A0A0A`): The app ground behind everything (`bg-background`).
- **Sidebar** (`#000000`): The navigation rail — one shade darker than canvas, the darkest surface in the app.
- **Surface** (`#171717`): Content containers, panels, modals (`--content-background`). The reading plane.
- **Ink** (`#ffffff`): Primary text and active icons (`text-foreground`).
- **Ink Secondary** (`#9ca3af`, `text-zinc-400`): Secondary text, labels, meta.
- **Ink Muted** (`#6b7280`, `text-zinc-500`): De-emphasised meta, placeholders, disabled.
- **Hairline** (`#2a2a2a`, `border-zinc-700/800`): Every divider and border. Depth is a hairline, not a shadow.

### Semantic (status / priority / category)
Centralised in `src/lib/campaignTracking.ts` as `STATUS_COLORS`, `STATUS_DOT`, `PRIORITY_COLORS`. **Import them; never re-map inline.** Each hue follows the same tinted triad — foreground at `-400`, background wash at `/10`, border at `/30`:

- **Green** (`#4ade80`): Success / paid / complete.
- **Blue** (`#60a5fa`): Info / in-progress / active.
- **Orange** (`#fb923c`): Warning / awaiting / pending.
- **Yellow** (`#facc15`): Attention needed / medium priority.
- **Red** (`#f87171`): Error / rejected / owed.
- **Zinc** (`#a1a1aa`): Neutral / archived / low priority.

### Charts
Chart hues are **validated for dark-surface contrast and CVD-safety**, not taken raw from the stock `--chart-*` tokens (the stock dark values fail contrast on card surfaces — see the `DONUT_COLORS` / `AGING_COLORS` comments in the reference page, and the `dataviz` skill for the method). Render through `src/components/ui/chart.tsx` (`ChartContainer`, `ChartTooltip`, `ChartTooltipContent`) with `recharts`. Slice strokes use `stroke="var(--card)"` so segments read as separated. Sequential data → single-hue ramp; categorical → distinct validated hues, folded into "Other" past ~5 series.

### Named Rules
**The One Voice Rule.** Action Blue is the only non-semantic color on any screen, and it marks the primary action or current selection — nothing else. Its scarcity is what makes it read.

**The Semantic-Only Rule.** Color is forbidden as decoration. If a green, orange, or red pixel does not encode a status, priority, or category, remove it. Pull every state color from `campaignTracking.ts`; never hardcode a themeable hex.

**The Overlay-Not-Grey Rule.** Interior surfaces are translucent white on the dark ground, not solid greys — this is what gives the soft, layered depth (see Elevation).

## 3. Typography

**Display / Body / Label Font:** Google Sans (both `--font-sans` and `--font-mono` map to it), fallback system stack.

**Character:** One family carries everything — headings, data, labels, code. There is no display/body pairing; a product this dense would only be made noisier by type contrast. Weight and `tabular-nums` do the work that a second family would.

### Hierarchy
- **Display** (600, `text-2xl` / 24px, `tabular-nums`): Stat and hero numbers in summary tiles. Always tabular.
- **Title** (600, `text-lg` / 18px): Dialog titles, card titles, section headers.
- **Body** (500, `text-sm` / 14px, line-height 1.5): The default — set on `body`, inherited nearly everywhere. Prose caps at 65–75ch; data and tables may run denser.
- **Label** (500, `text-xs` / 12px, `text-zinc-400`): Field labels sit above inputs (`mb-1`); meta and captions.
- **Eyebrow** (600, `11px`, uppercase, `letter-spacing: 0.06em`, low opacity): Sidebar section headers only (`.sidebar-section-header`) — a deliberate, single-use brand device, not a per-section scaffold.
- **Code** (500, `text-xs`, `font-mono`, `tabular-nums`): IDs and codes (CR0001). Dense captions drop to `text-[10px]` / `text-[8px]` (avatar fallbacks).

### Named Rules
**The Tabular Rule.** Every count, amount, and metric uses `tabular-nums`; every code or ID (CR0001) uses `font-mono text-xs`. Numbers must align in columns — always.

**The One-Family Rule.** Google Sans carries the entire UI. Never introduce a display or accent typeface; hierarchy comes from weight, size, and color, never from a second family.

## 4. Elevation

This system uses **no drop shadows** for interface depth. Elevation is built entirely from **translucent white overlays layered on the dark ground, edged with hairline white borders** — the "soft, layered" look that distinguishes the app. The only shadow-like effect in the whole system is the `backdrop-filter: blur(2px)` behind a full-screen network overlay; it is an exception, not a pattern.

### Overlay Vocabulary
The surface recipe, reused for kanban columns, list rows, and panels:
- **Panel / column background** (`rgba(255,255,255,0.025)`): The base interior surface.
- **Panel / column border** (`rgba(255,255,255,0.07)`): Its hairline edge.
- **List-item background** (`rgba(255,255,255,0.04)`): A row resting on a panel.
- **List-item left accent** (`rgba(255,255,255,0.14)`, `border-l-2`): The compact row's leading edge inside kanban columns.
- **Hover surface** (`rgba(255,255,255,0.055)`) → **Active surface** (`rgba(255,255,255,0.08)`): State on interactive surfaces.

Card radius is `rounded-xl`; controls and rows are `rounded-md` / `rounded-lg`; chips and dots are `rounded-full`. `--radius` is `0.625rem` (10px).

### Named Rules
**The No-Shadow Rule.** Depth comes from a lighter overlay and a hairline border, never from a `box-shadow`. If a surface needs to lift, raise its white overlay opacity — do not add a shadow.

**The Hairline Rule.** Every border is a single hairline: `#2a2a2a` on opaque surfaces, `rgba(255,255,255,0.07)` on overlays. No heavy dividers, no double borders.

## 5. Components

**Only** shadcn/ui primitives from `src/components/ui/`. Never introduce another component library or hand-roll a primitive that already exists there; add new ones with `npx shadcn@latest add <name>`. Icons are **only** `@tabler/icons-react` and `lucide-react`. Images are **only** `Avatar` / `AvatarImage` / `AvatarFallback` — never a raw `<img>`. Every mutation `toast`s its outcome via `sonner` (`toast.success` / `toast.error`).

### Buttons
- **Shape:** `rounded-md` / `rounded-lg`.
- **Primary:** shadcn `default` variant; the global `.btn-primary` is Action Blue (`#3b82f6`), padding `8px 16px`, hover `#2563eb`.
- **Variants:** `outline`, `secondary`, `ghost`, `destructive`, `link`; sizes `xs` / `sm` / `default` / `lg` / `icon*`. Inline table/card actions use `size="sm"` or `size="xs"` with `h-6` / `h-7 text-xs`.
- **Destructive:** `variant="destructive"` or `text-destructive`.
- **Motion:** icon/text buttons `text-zinc-500 hover:text-zinc-300 transition-colors`; 120ms ease-out globally.

### Badges & Status
- **Badges:** `variant="secondary"` for counts, `variant="destructive"` for alerts ("3 over 30d").
- **Status pill:** `rounded-full px-2 py-0.5 text-xs font-medium` span, colored from `STATUS_COLORS` (the `-400` text / `/10` fill triad).
- **Status dot:** `inline-block w-2 h-2 rounded-full` + `STATUS_DOT[status]` — the compact indicator in dense lists.

### Inputs / Fields
- **Style:** the shared `inputClass` — `w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500`. `Select` / `SelectTrigger` match with `bg-zinc-800 border-zinc-700`.
- **Focus:** `focus:outline-none focus:border-zinc-500` (border shift, no glow).
- **Error:** `.form-input.error` → `border-color: #ef4444`. Native date/time inputs add `[color-scheme:dark]`.
- **Labels:** `text-xs text-zinc-400` above the input (`mb-1`).

### Cards / Containers
- **Corner:** `rounded-xl`. **Background:** Surface (`#171717`) or the white-overlay recipe. **Shadow:** none (see Elevation). **Border:** hairline.
- **Padding:** shadcn `Card` ships `py-6`/`px-6`; dashboard widgets tighten to `py-4` + `px-4` (`<Card className="gap-3 py-4">`, headers/content `px-4`).

### Navigation
- **Style:** the 260px `.sidebar` on `#000000`, collapsing to 68px (`width 250ms ease-out`). Nav items are 14px/500, `rounded` 4px; hover raises to the hover overlay, `.active` uses the active overlay + `font-weight 600`. Section headers are the uppercase 11px eyebrow. Every internal page renders inside `AppLayout` (sidebar + top bar + boot gating) — never build a bespoke shell.

### Loading & Empty States
- **Loading:** shadcn `Skeleton` shaped to the final layout (`<Skeleton className="h-64 rounded-xl" />`), never a bare spinner mid-layout. Async home widgets gate boot via `useBootPhase('home-<name>', isLoading)`.
- **Empty:** a single quiet line — `text-sm text-muted-foreground` ("Nothing outstanding.", "None") — never an illustration.

### Signature Component: Tinted Summary Cards + Kanban
The `OverviewTab` in `custom-requests/page.tsx` is the reference look for any dashboard. Three parts:

- **A. Summary tile row** — `grid grid-cols-2 lg:grid-cols-4 gap-4` of compact `Card`s (`gap-3 py-4`): a `CardDescription` label + a big `CardTitle text-2xl font-semibold tabular-nums` metric, optional `CardAction` badge. Body is either a top-3 ranked list (avatar + name + count Badge, then "+N more") or an inline donut (`ChartContainer` + `PieChart` with a centre `RechartsLabel` total).
- **B. Category-tinted section cards** — a `Card` whose border + wash + title hue encode its meaning: Completed → `border-green-500/30 bg-green-500/5` / `text-green-400`; Archived → orange; Customs → blue; Payments → red. Title `text-sm font-semibold`; `CardAction` holds a legend or an `outline` "Dismiss All" button.
- **C. Multi-column kanban** — a CSS-columns board (`columnWidth: "13rem"`, `columnCount: 4`, `columnGap: "0.75rem"`), so uneven columns pack tightly. Each column (`break-inside-avoid mb-3 rounded-xl p-2.5`) sits on the white-overlay surface, headed by a `size-4` avatar + truncated name + right-aligned count. Items are compact button-rows with a **left accent border** (`border-l-2`, `rgba(255,255,255,0.14)`), a `StatusDot`, a `font-mono text-xs` code, and an optional right-aligned amount, each `hover:brightness-110 active:scale-[0.98]` when clickable.

The throughline: **the card's tint tells you the category at a glance, the kanban groups by entity, and every leaf row is a dense, monospaced, tappable line.**

### Interaction / Motion
- Global 120ms ease-out transition on color/opacity for all interactive elements (`globals.css`).
- Clickable list items: `transition-all hover:brightness-110 active:scale-[0.98]`.
- Text links in dense lists: `hover:text-white hover:underline underline-offset-2`.
- Custom scrollbars are thin (6px) translucent-white, inherited globally — don't override.

## 6. Do's and Don'ts

### Do:
- **Do** keep the canvas near-black (`#0A0A0A`) and let chrome recede — the data is the interface.
- **Do** build depth from the white-overlay recipe (`rgba(255,255,255,0.025)` bg / `0.07` border) plus hairline borders.
- **Do** pull every status/priority color from `campaignTracking.ts` and apply the `-400` text / `/10` fill / `/30` border triad.
- **Do** put `tabular-nums` on every count, amount, and metric, and `font-mono text-xs` on every code/ID (CR0001).
- **Do** use only `src/components/ui` components, only `@tabler/icons-react` / `lucide-react` icons, and only `Avatar` for images.
- **Do** shape `Skeleton`s to the final layout, write empty states as one quiet `text-muted-foreground` line, and `toast` every mutation outcome.
- **Do** keep motion to 120ms transitions and `hover:brightness-110 active:scale-[0.98]` on tappable rows.
- **Do** make it read like `custom-requests/page.tsx`. If it doesn't, reconcile.

### Don't:
- **Don't** add drop shadows for depth — raise the white overlay instead (The No-Shadow Rule).
- **Don't** use color as decoration; if a colored pixel doesn't encode state, category, or the one Action Blue voice, remove it (The Semantic-Only Rule).
- **Don't** hardcode a themeable hex — use the CSS variables / Tailwind tokens.
- **Don't** introduce another component library, hand-roll a primitive that exists in `src/components/ui`, or use icons outside `@tabler/icons-react` / `lucide-react`.
- **Don't** use a raw `<img>` — always `Avatar`.
- **Don't** reach for a modal first, drop a spinner into the middle of a layout, or ship an "illustration" empty state.
- **Don't** introduce a second font family, oversized display type, gradient text/heros, or glassmorphism — this is not a marketing site.
- **Don't** use a colored side-stripe as a decorative accent; the only left-border in the system is the kanban row's functional `border-l-2` overlay edge.

## 7. Creator Portal (external skin)

Everything above describes the **internal console** — the Electron app internal staff live in. The **creator portal** (`src/app/creator-portal/`) is a separate surface for **external creators** in a normal browser, and it wears a deliberately warmer, friendlier skin. This is an **authored divergence**, not drift: it trades the console's monochrome restraint for a single violet brand voice, because the audience and context differ (a creator marking their own work done, not an operator scanning a data console).

**The skin is defined once, in code, in [`src/app/creator-portal/theme.ts`](src/app/creator-portal/theme.ts).** Import those tokens; never hardcode a portal color, gradient, badge map, or surface recipe inline. If the visual language changes, change `theme.ts` and this section together.

### What carries over from the console (unchanged)
- Near-black ground, translucent-white overlay surfaces, hairline borders. **No drop shadows** (the portal previously used `box-shadow` card lifts and glow shadows — both removed).
- **No gradient fills** on buttons or cards. Actions are solid: `COMPLETE_BTN` (emerald) and `ACCENT_BTN` (soft violet). The old green→emerald gradient CTA with a glow is gone.
- `tabular-nums` on every amount; `font-mono text-xs` on every CR code.
- Only `src/components/ui` primitives; only `Avatar` for images (the profile menu uses `Avatar`, never a raw `<img>` — the logo SVG is the sole non-Avatar image).
- `Skeleton`s shaped to the layout for loading (never a spinner mid-content); every mutation `toast`s its outcome.

### What differs (the authored part)
- **Brand voice is violet, not Action Blue.** `creator-accent` (`#8b5cf6`, `ACCENT.hex`) marks CR codes, links, focus, and the avatar fallback — the portal's one non-semantic voice, used as sparingly as the console uses blue. Named category hues live in `HUES` (violet / blue / amber / emerald) for section icons and the customs/calls/items type accents (`TYPE_META`).
- **One signature brand glow.** A single `radial-gradient(... rgba(139,92,246,0.08) ...)` sits behind every portal page ground (`PAGE_GROUND_STYLE`). This is the portal's *one* decorative-color exception — the analogue of the console's single backdrop-blur — and it is the only place color is spent on mood. Do not add a second.
- **Dense badge caption size.** Content-type / status badges use `text-[10px]`, the established dense-caption step (see § Typography, Code) — legitimate here, not a new size.
- **Friendlier empty states.** A small icon-in-circle + one line ("All caught up!") instead of the console's single quiet line — a deliberate warmth for this audience.

### Components & interaction (portal-specific)
- **One dialog vocabulary.** Every detail view and confirmation uses shadcn `Dialog` via [`components/CreatorDialog.tsx`](src/app/creator-portal/components/CreatorDialog.tsx) — which gives Esc-to-close, a focus trap, and `role="dialog"` for free. **Never hand-roll a `createPortal` overlay** (the portal used to have three; all replaced). The two typed detail views are `CustomRequestDialog` (customs/calls/items) and `ContentPlanDialog` (content planning); both are reused across the dashboard and the list pages so a record looks identical everywhere.
- **Completion is labelled and recoverable.** The action button reads **"Mark Completed"** (a verb), never the bare status word "Completed". Two safety models, by stakes:
  - **Customs (high-ticket):** completion is a **deliberate two-step** — open the detail dialog, then confirm — so a single stray tap can't vanish a card. A success `toast` offers **Undo**, which reverts the request to *Awaiting Approval* (`creator-complete` with `{ revert: true }`).
  - **Content planning (routine):** quick one-tap complete with an **Undo** `toast` that reverts to *Outstanding* (the content-planning `creator-complete` endpoint mirrors the campaign one's `revert` flag), so the card returns cleanly.
- **Lists, not carousels.** Outstanding items render as responsive grids / vertical lists (`repeat(auto-fit, …)` / stacked cards), so a creator sees everything at once — no horizontal paging.

### Portal rules (in addition to everything in §1–6)
1. **Import the skin from `theme.ts`.** No inline portal hexes, gradients, or surface recipes. New portal color → add it to `theme.ts` **and** the `creator-*` palette entries in this file's frontmatter.
2. **Violet is the portal's one voice**, exactly as Action Blue is the console's. It marks brand/interactive accent only — never decoration beyond the one signature page glow.
3. **Solid fills only** — no gradient or glow buttons/cards. `COMPLETE_BTN` / `ACCENT_BTN` are the two action treatments.
4. **Detail & confirm = shadcn `Dialog`** through `CreatorDialog`. No bespoke overlays.
5. **"Mark Completed", never "Completed"**, and every completion is undoable via the `revert` flag.

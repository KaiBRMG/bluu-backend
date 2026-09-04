---
name: Bluu Backend
description: Dark, quiet, information-dense internal management console where the data is the interface.
colors:
  canvas: "#09090b"
  sidebar: "#18181b"
  surface: "#171717"
  ink: "#ffffff"
  ink-secondary: "#a1a1aa"
  ink-muted: "#71717a"
  hairline: "#2a2a2a"
  action-blue: "#3b82f6"
  action-blue-deep: "#2563eb"
  status-green: "#4ade80"
  status-blue: "#60a5fa"
  status-orange: "#fb923c"
  status-yellow: "#facc15"
  status-red: "#f87171"
  status-zinc: "#a1a1aa"
  creator-void: "#050b12"
  creator-ground: "#0a121b"
  creator-surface: "#131d27"
  creator-raised: "#1e2934"
  creator-line: "#293440"
  creator-ink: "#f4f7fa"
  creator-ink-secondary: "#b1b8c0"
  creator-ink-muted: "#80878e"
  creator-accent: "#00b8f5"
  creator-accent-deep: "#0090c8"
  creator-urgency-late: "#f9746d"
  creator-urgency-done: "#4bc680"
  creator-urgency-warn: "#edb345"
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
  attribute-chip:
    backgroundColor: "rgba(255,255,255,0.08)"
    textColor: "#d4d4d8"
    rounded: "{rounded.md}"
    padding: "2px 6px"
  facet-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.sm}"
    padding: "6px 8px"
  facet-row-selected:
    backgroundColor: "rgba(59,130,246,0.15)"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "6px 8px"
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

The canonical reference implementation is `src/app/(main)/creator-portal/custom-requests/page.tsx` — when in doubt, mirror it. Its overview widgets are the house style for every dashboard and summary surface (the [Signature widget pattern](#5-components)).

**Key Characteristics:**
- Near-black canvas (`#0A0A0A`), low-chroma surfaces, 14px base type, tight spacing.
- Greyscale by default; color is strictly semantic (status / priority / category).
- Soft elevation from translucent white overlays + hairline borders — never shadows.
- Every number is `tabular-nums`; every code/ID is `font-mono`.
- Fast, subtle motion: 120ms ease-out; tappable rows step through the overlay recipe (transparent rows) or `hover:brightness-110 active:scale-[0.98]` (rows that carry their own fill) — see [Interaction / Motion](#interaction--motion).

## 2. Colors

A greyscale-on-black palette where the only saturated pixels carry state.

### Primary
- **Action Blue** (`#3b82f6`): The single interactive accent — tints, borders, selection washes, and marks that carry no text. Used sparingly; it is the one voice that means "act here."
- **Action Blue Deep** (`#2563eb`): The **filled** step — any Action Blue surface that carries white text (primary buttons, a selected filter chip). Hover deepens again to `#1d4ed8`. This is an accessibility floor, not a preference: white on `#3b82f6` measures **3.68:1** and fails AA for anything under 18px, while white on `#2563eb` reads **5.17:1**. Tint at `#3b82f6`, fill at `#2563eb`.

  Two things do **not** yet follow this and are outstanding, both one-line changes with app-wide visual effect (deliberately left for a separate decision): `.btn-primary` in `globals.css` still fills at `#3b82f6` with white ink, and shadcn's `Button` `default` variant resolves `--primary` to **near-white** (`oklch(0.92 …)`, the stock `.dark` value) rather than to Action Blue at all — so most primary buttons in the app are currently white, not blue. OF Manager's Send button is inked correctly at `#2563eb` in-component; treat it as the reference, not as drift.

  **Do not ink ordinary page buttons in-component to work around this.** OF Manager earns the exception because it is a satellite window with its own shell; an in-app page that inks its own primary action just makes itself the odd one out, and leaves a second button somewhere in the same flow still rendering white. Ordinary pages use the plain shadcn `Button` and look like every other page — **the fix for `--primary` is one global change to `globals.css`, and that is where it belongs.** Until someone makes it, near-white primary buttons are the app's actual, consistent look.

### Neutral

**`globals.css`'s `.dark` block is the source of truth for these values, and it is what `<html class="dark">` actually resolves.** The `:root` block above it is stock shadcn and is overridden on every screen; read the `.dark` block when checking a token.

- **Canvas** (`#09090b`, `--background`): The app ground behind everything (`bg-background`).
- **Sidebar** (`#18181b`, `--sidebar`): The navigation rail. It is **1.12:1** against the canvas, so the rail/content split is carried by its hairline border, not by the fill — do not rely on the two grounds reading as distinct planes.
- **Surface** (`#171717`): Content containers, panels, modals (`--content-background`). The reading plane.
- **Ink** (`#ffffff`): Primary text and active icons (`text-foreground`).
- **Ink Secondary** (`#a1a1aa`, `text-zinc-400`): Secondary text, labels, meta. **The only de-emphasis step for text** — 7.76:1 on canvas, 6.91:1 on the sidebar, 7.25:1 on an overlay surface.
- **Ink Muted** (`#71717a`, `text-zinc-500`): **Not a text colour.** It measures **4.12:1 on the canvas**, 3.84:1 on an overlay surface and 3.67:1 on the sidebar — it fails AA on every ground in the app, including the near-black one. Use it only for non-text marks that need to clear 3:1 (hairline-adjacent icons, disabled affordances); de-emphasise text with Ink Secondary. *(Existing screens still use it as a text colour; the OF Manager window is converted, the rest is outstanding.)*
- **Hairline** (`#2a2a2a`, `border-zinc-700/800`): Every divider and border. Depth is a hairline, not a shadow.

### Semantic (status / priority / category)
Centralised in `src/lib/campaignTracking.ts` as `STATUS_COLORS`, `STATUS_DOT`, `PRIORITY_COLORS`. **Import them; never re-map inline.** Each hue follows the same tinted triad — foreground at `-400`, background wash at `/10`, border at `/30`:

- **Green** (`#4ade80`): Success / paid / complete.
- **Blue** (`#60a5fa`): Info / in-progress / active.
- **Orange** (`#fb923c`): Warning / awaiting / pending.
- **Yellow** (`#facc15`): Attention needed / medium priority.
- **Red** (`#f87171`): Error / rejected / owed.
- **Zinc** (`#a1a1aa`): Neutral / archived / low priority.

### Time-tracking state palette (authored divergence)
The timer subsystem carries its **own** five-hue palette in [`src/lib/stateColors.ts`](src/lib/stateColors.ts) (`STATE_CONFIG`) — one entry per `TimerDisplayState`, each a `{ color, bgAlpha, label, Icon }` triad (foreground hue + a matching `/10` panel wash). It shares **no values** with the semantic hues above and is a **deliberate authored divergence**, not drift: the states (Working / Idle / On Break / Paused / Clocked Out) are a closed, timer-specific vocabulary, and Paused's violet (`#8B5CF6`) has no equivalent in the status set. `STATE_CONFIG` is the single source for these colours — **import it; never re-type a state hex inline** (the time-tracking page references `STATE_CONFIG[...].color`, never a literal). Because it is a parallel system, a change to the status palette does **not** propagate here; if the two are ever meant to converge, reconcile them explicitly rather than assuming a global theme edit reaches the timer.

### Charts
Chart hues are **validated for dark-surface contrast and CVD-safety**, not taken raw from the stock `--chart-*` tokens (the stock dark values fail contrast on card surfaces — see the `DONUT_COLORS` / `AGING_COLORS` comments in the reference page, and the `dataviz` skill for the method). Render through `src/components/ui/chart.tsx` (`ChartContainer`, `ChartTooltip`, `ChartTooltipContent`) with `recharts`. Slice strokes use `stroke="var(--card)"` so segments read as separated. Sequential data → single-hue ramp; categorical → distinct validated hues, folded into "Other" past ~5 series.

### Named Rules
**The One Voice Rule.** Action Blue is the only non-semantic color on any screen, and it marks the primary action or current selection — nothing else. Its scarcity is what makes it read.

**The Semantic-Only Rule.** Color is forbidden as decoration. If a green, orange, or red pixel does not encode a status, priority, or category, remove it. Pull every state color from `campaignTracking.ts`; never hardcode a themeable hex.

**The Overlay-Not-Grey Rule.** Interior surfaces are translucent white on the dark ground, not solid greys — this is what gives the soft, layered depth (see Elevation).

**The One De-emphasis Rule** (supersedes the former Muted-on-Tint Rule). There is **one** step below Ink for text: **Ink Secondary** (`text-zinc-400` / `--foreground-secondary`). Ink Muted was previously documented as safe on the near-black canvas; measured, it is 4.12:1 there and fails everywhere else too, so there is no ground on which it is a legal text colour. Use Ink Secondary on canvas, on sidebar, on overlay surfaces and on state tints alike, and never stack `opacity` on top of it — double de-emphasis is what pushes text under the floor.

**The One-Grey Rule.** A surface picks **one** token for de-emphasised text and uses it throughout. Mixing `text-muted-foreground` (`#9f9fa9`) with `text-zinc-400` (`#a1a1aa`) and `text-zinc-500` (`#71717a`) inside one component — which is how the OF Manager window drifted — makes three greys for one role and hides the failing one among the passing ones.

### The Highlighter Palette (the one sanctioned decorative colour)

Five translucent tints, declared once in `globals.css` as `mark.hl-*` and mirrored by `HIGHLIGHT_COLORS` in [`src/lib/promptHtml.ts`](src/lib/promptHtml.ts) (that file is the source of truth — it is what the editor writes and what the sanitiser allows):

| Class | Fill |
|---|---|
| `hl-yellow` | `rgba(250, 204, 21, 0.32)` |
| `hl-green` | `rgba(34, 197, 94, 0.32)` |
| `hl-blue` | `rgba(59, 130, 246, 0.32)` |
| `hl-purple` | `rgba(168, 85, 247, 0.32)` |
| `hl-pink` | `rgba(244, 63, 94, 0.32)` |

This is the **only** place in the system where colour carries no system-assigned meaning, and it does not breach the Semantic-Only Rule: the meaning is assigned by the *author of the prompt*, the same way it is in a highlighter pen. The rule forbids the designer decorating; it does not forbid the user annotating.

Three constraints hold it in place: it applies to **prompt body text only** (the Prompt Library editor, the detail card, and the public share page), one shared alpha so the five read as one family, and `color: inherit` — the UA sheet paints `<mark>` black-on-yellow, which is illegible on every surface in this app. Never reach for these hues for chrome, status or charts.

## 3. Typography

**Display / Body / Label Font:** Google Sans (both `--font-sans` and `--font-mono` map to it), fallback system stack.

**Character:** One family carries everything — headings, data, labels, code. There is no display/body pairing; a product this dense would only be made noisier by type contrast. Weight and `tabular-nums` do the work that a second family would.

### Hierarchy
- **Instrument** (700, `text-5xl` → `sm:text-6xl` / 48–60px, `tabular-nums`): The **single** sanctioned oversized number — the live clock on the time-tracking page ([`applications/time-tracking/page.tsx`](src/app/(main)/applications/time-tracking/page.tsx)), read from across a desk. This is the one exception to the "no oversized display type" Don't; it earns it because the timer *is* the page's reason to exist, not decoration. `tabular-nums` does the alignment (in this project `font-mono` also maps to Google Sans, so the mono class is cosmetic here — the numeric feature is what matters). Do **not** cite this step to justify another big number: outside the timer, `Display` is the ceiling.
- **Page title** (700, `text-2xl` / 24px, `tracking-tight`): The `<h1>` every page under `(main)/` opens with, followed by one `text-sm text-zinc-400` line of description. It is the **only** 700-weight step and the only place `tracking-tight` appears; a page's primary action sits to its right on the same row, not below it. Do not restyle it per page — the console's pages are recognisably the same object, and that starts at the header.
- **Display** (600, `text-2xl` / 24px, `tabular-nums`): Stat and hero numbers in summary tiles. Always tabular. Same size as Page title, distinguished by weight and by never carrying prose.
- **Title** (600, `text-lg` / 18px): Dialog titles, card titles, section headers.
- **Body** (500, `text-sm` / 14px, line-height 1.5): The default — set on `body`, inherited nearly everywhere. Prose caps at 65–75ch; data and tables may run denser.
- **Label** (500, `text-xs` / 12px, `text-zinc-400`): Field labels sit above inputs (`mb-1`); meta and captions.
- **Meta** (400–500, `text-[11px]`, `text-zinc-400`): The second line of a dense two-line row and the smallest step that may carry real content — a timestamp under a message bubble, the host + groups + date line under a resource name. Facts on it are `·`-separated with an `aria-hidden` separator, numbers are `tabular-nums`, and an identifier on it takes `font-mono`. **Never stack `opacity` on it**; at this size Ink Secondary is already the floor.
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

### Z-Index Scale
Stacking is a **named semantic scale**, declared in `globals.css` and consumed via `var(--z-*)` (Tailwind `z-[var(--z-banner)]`) — never an arbitrary number. Three app-level layers sit *above* shadcn's own overlays (dialog / popover / sheet at Tailwind `z-50`):
- **`--z-overlay` (50):** dropdowns, popovers, dialogs — matches Tailwind `z-50`.
- **`--z-banner` (60):** persistent app banners (update-download / update-available) — above the overlays.
- **`--z-toast` (70):** transient toasts — the top layer, above the banner.

### Named Rules
**The No-Shadow Rule.** Depth comes from a lighter overlay and a hairline border, never from a `box-shadow`. If a surface needs to lift, raise its white overlay opacity — do not add a shadow.

**The Hairline Rule.** Every border is a single hairline: `#2a2a2a` on opaque surfaces, `rgba(255,255,255,0.07)` on overlays. No heavy dividers, no double borders.

**The Named-Layer Rule.** Stacking order is expressed with the `--z-*` scale (`--z-overlay` < `--z-banner` < `--z-toast`), never a literal like `z-[9999]`. A raw magic z-index is drift — replace it with the layer whose name matches its role.

## 5. Components

**Only** shadcn/ui primitives from `src/components/ui/`. Never introduce another component library or hand-roll a primitive that already exists there; add new ones with `npx shadcn@latest add <name>`. Icons are **only** `@tabler/icons-react` and `lucide-react`. Images are **only** `Avatar` / `AvatarImage` / `AvatarFallback` — never a raw `<img>`. Every mutation `toast`s its outcome via `sonner` (`toast.success` / `toast.error`) — with one narrow exception: a **high-frequency mutation whose result is already visible in place** toasts failures only (see the satellite shell's message send). The rule exists because CRUD results happen off-screen; it is not a licence to fire a toast every few seconds.

**The Avatar Seed Rule.** Every fallback avatar is derived from **`displayName`** (`getAvatarColor(displayName || 'User')` + `getInitials(displayName)`), exactly as `AppLayout` and `NavUser` do it. `getAvatarColor` **hashes** the string it is given, so seeding from any other value — a full name, an email, a nickname in form state — changes both the initials *and* the colour, and the same person appears as two different avatars across screens. Display a fuller name as *text* if the surface calls for it, but always seed the avatar from `displayName`. What the rule actually protects is that **one identity hashes to one colour everywhere**; on a record that has no `displayName` field at all (Growth Tracking's accounts have only `handle` — see `AccountAvatar` in [`growthUi.tsx`](src/components/growth/growthUi.tsx)), seed from that record's own stable identity instead. The failure mode to avoid is the same either way: seeding from something that can change (a caption, a form draft) makes the same entity render as two different avatars.

### Brand logo
- **The default business logo is [`/logo/HQ2.webp`](src/public/logo/HQ2.webp)** — the full lockup (cyan `uu` mark + white wordmark), 1374×868, transparent ground. Use it wherever a surface shows the business's own identity: public pages, external skins, mastheads, login and hand-off cards. **It is the master, not a derivative** — the `HQ2.png` it was converted from has been removed, because the WebP is *lossless* and 17 KB against that PNG's 38 KB. A replacement lockup ships as a lossless WebP under the same name; do not reintroduce a parallel PNG for the same artwork.
- **It is white-inked, so it only sits on a dark ground.** There is no light-ground variant; a surface that needs one has to commission it rather than filtering this file.
- **Always pass `width={1374} height={868}`** alongside the Tailwind height (`h-10 w-auto`). A raster logo given only a height reserves no width and shifts the header as it decodes — the ratio has to be known before the bytes land.
- **The legacy SVGs remain valid in their existing roles, not as the default.** `bluu_uu.svg` is the compact **mark** (collapsed sidebar, button icons, favicons) — HQ2 is a lockup and does not shrink to 16–20px. `bluu_long.svg` is the older horizontal wordmark; it is still in place across the internal console and is not worth a sweeping swap, but **new** surfaces take HQ2.
- Images are otherwise `Avatar` only (below) — the logo is the standing exception, and it is a plain `<img>` rather than `next/image` on public pages, where the optimizer buys nothing for a single fixed asset.

### Buttons
- **Shape:** `rounded-md` / `rounded-lg`.
- **Primary:** shadcn `default` variant; the global `.btn-primary` is Action Blue (`#3b82f6`), padding `8px 16px`, hover `#2563eb`.
- **Variants:** `outline`, `secondary`, `ghost`, `destructive`, `link`; sizes `xs` / `sm` / `default` / `lg` / `icon*`. Inline table/card actions use `size="sm"` or `size="xs"` with `h-6` / `h-7 text-xs`.
- **Destructive:** `variant="destructive"` or `text-destructive`.
- **Motion:** icon/text buttons `text-zinc-500 hover:text-zinc-300 transition-colors`; 120ms ease-out globally.
- **`ToggleGroup`/`Toggle` selection needs an override.** shadcn's `outline` variant paints both `:hover` and `data-[state=on]` with the same `bg-accent`, so a selected segment is indistinguishable from a hovered one — under the 3:1 floor WCAG 1.4.11 sets for a state indicator. Force the on-state to the filled Action Blue Deep (`data-[state=on]:bg-[#2563eb]! data-[state=on]:text-white!` — the trailing `!` beats the primitive's own same-specificity rule), never the tint-only `#3b82f6`. Growth Tracking's `SEGMENT_ITEM_CLASS` ([`growthUi.tsx`](src/components/growth/growthUi.tsx)) is the reference.

### Badges & Status
- **Badges:** `variant="secondary"` for counts, `variant="destructive"` for alerts ("3 over 30d").
- **Status pill:** `rounded-full px-2 py-0.5 text-xs font-medium` span, colored from `STATUS_COLORS` (the `-400` text / `/10` fill triad).
- **Status dot:** `inline-block w-2 h-2 rounded-full` + `STATUS_DOT[status]` — the compact indicator in dense lists.
- **Attribute chip:** `rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300` — a free-form label a record *carries* (a resource's types) as opposed to a state it is *in*. **Greyscale, always.** A status has a closed vocabulary and a meaning per value, so it earns a hue from `campaignTracking.ts`; an open-ended label has neither, and colouring it is decoration wearing a status pill's clothes. Square-ish (`rounded-md`) rather than `rounded-full` so the two are never confused at a glance.
- **Template-token chip:** a `<code>` on the overlay recipe — `rounded bg-white/[0.08] px-1 py-0.5 font-mono text-xs text-zinc-300` — marking a value interpolated at runtime inside otherwise literal copy (the automated-notification templates on `/admin-portal/notifications`). Greyscale by design: a placeholder is not a state, so it takes no hue.

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
- **Page icons are lucide**, mapped by name in `ICON_MAP` in [`src/components/PageIcon.tsx`](src/components/PageIcon.tsx) — the one place the `icon` string on a `PageDef`/`TeamspaceDef` is resolved, shared by the sidebar and `/admin-portal/sharing`. Render them with `<PageIcon name={page.icon ?? undefined} />`; never re-map icon names locally, or a page added to `definitions.ts` renders in one surface and not the other. The one escape hatch is `SVG_ICONS` — brand marks with no lucide equivalent (currently OF Manager's `/Icons/onlyfans.svg`), rendered through `next/image` at `size-4`, exactly as the sidebar logo already is. Add to it only for a real third-party brand; anything expressible in lucide belongs in `ICON_MAP`.
- **Platform marks outside the page-icon system follow the same principle.** Growth Tracking's `PlatformIcon` ([`growthUi.tsx`](src/components/growth/growthUi.tsx)) renders Facebook/X as raster marks (`/Icons/icons8-facebook.webp`, `/Icons/icons8-x.webp`) through `next/image`, not `ICON_MAP` — it isn't a `PageDef` icon, but the reasoning is identical to `SVG_ICONS`: a real third-party brand mark reads better as its own asset than as Tabler's generic interpretation. The platform stays **greyscale** (the marks are baked to zinc-400 in the file, not `currentColor`-able) — brand colour here would be decoration, not state; hue is reserved for direction-of-travel (green/red deltas) and the one Action Blue voice.

#### The satellite-window shell (OF Manager)

`AppLayout` is the shell for every **in-app page**. The one sanctioned exception is a surface that owns its own Electron window — currently `/of-manager` — where a sidebar and top bar would be navigation to nowhere. Its chrome is the two-pane messaging shell instead:

- **Full-bleed, never scrolling as a page — and never sized in `vw`/`vh`.** The ground is one `fixed inset-0 overflow-hidden` box and every surface below it is `h-full`/`w-full`; each pane owns its own `overflow-y-auto`. A `h-screen w-screen` shell self-oscillates against Windows' space-consuming scrollbars — see [onlyfans-crm.md § The window](documentation/onlyfans-crm.md#the-window) for the loop in full. This is a hard rule, not a preference.
- **Left rail on Sidebar** (`w-[340px]`, hairline right border) so the window still reads as part of the console; the content pane sits on Canvas. The rail is a fixed width with no breakpoint, which holds because `openSatelliteWindow` gives every satellite a **900px `minWidth`** ([`electron/main.js`](electron/main.js)) — the two panes are never squeezed. A caller that passes a smaller `minWidth` (the clamp floor is 360) would break this layout; don't, or add a single-pane mode first.
- **The third pane is opt-in.** The fan context panel (`w-[300px]`, hairline left border, on Sidebar like the rail) is toggled from the thread header and defaults **closed** — at the 900px minimum, three panes leave the thread under 280px. Any future pane in this window inherits that rule: the reading surface is what the window is for, and a pane that squeezes it must be the operator's choice.
- **Section title is the eyebrow** (11px/600, uppercase, `0.06em`) — the same device the sidebar uses for section headers, and the only place the window names itself. It is an `<h2>`; the open thread's fan name is the window's `<h1>`.
- **Filter chips** are `rounded-full px-2.5 py-1 text-xs`: the selected chip is a **filled Action Blue Deep** (`#2563eb`, white ink — see §2, filled blue never uses `#3b82f6`), the rest ride the hover/active overlay recipe. Each carries `aria-pressed`.
- **Selected chat row = three cues, never one.** An overlay-only selected row (`bg-white/[0.08]` on the rail) measures **1.25:1** against an unselected one and ~1.1:1 against a hovered one — invisible. Selection is the Action Blue **tint** (`bg-[#3b82f6]/15`), the fan name stepping to `text-white font-semibold` (unselected rows sit at `font-medium text-zinc-300`), and `aria-current`. Hover stays on the overlay recipe, so hue separates selection from hover.
- **Message bubbles** are the overlay recipe (`bg-white/[0.04]` + `border-white/[0.07]`, `rounded-xl`) for the fan; our own messages take an Action Blue tint (`/15` fill, `/30` border) because "who said this" is the one distinction the surface exists to encode. Width is `max-w-[min(75%,34rem)]` — the percentage alone runs past 120ch once the window is wide. Timestamps are `text-[11px]` `tabular-nums` **zinc-400** (the One De-emphasis Rule; zinc-500 fails on every ground here).
- **The thread is a live region.** The scroll container is `role="log"` with `aria-live="polite"`, dropped to `off` while an older page loads so paging back through history doesn't read thirty messages aloud. Both text controls carry an `aria-label` — a placeholder is not a name.
- **No success toast per message.** DESIGN's "every mutation toasts" rule is for CRUD, where the result is off-screen; here the bubble landing in the thread *is* the confirmation, and a toast every few seconds trains the operator to ignore the failure toasts that matter. Failures toast, successes don't.
- **One place holds unsent text.** A failed send removes its optimistic bubble and hands the draft back to the composer. Never do both — a red bubble plus a refilled composer shows the same message twice and the bubble never clears. The same rule covers the reply target: it belongs to the draft, and the bubble's Reply is an *event* into the composer, not a second copy of the state.
- **Per-message actions are one menu trigger, revealed on hover and on focus.** Not a row of inline buttons: four affordances across several hundred bubbles is DOM in the heaviest container here, and the trigger must reveal on `focus-visible` too or the actions are keyboard-unreachable. It sits on the *outside* edge of its bubble so it never covers text. Colour and opacity only — a `filter` re-rasterises the bubble on every hover, the same defect the chat rows were fixed for.
- **A keyboard cursor is DOM focus, not a second selection state.** `j`/`k` move focus between rows and `Enter` activates; the ring is `focus-visible:ring-2 ring-inset` Action Blue. Do not build a parallel "cursor" in React state — the browser already scrolls focus into view, and a cursor that also *opened* the row here would fire a billed API call per keystroke.

This is a shell, not a new visual language: colours, overlays, hairlines, radii, motion and the empty-state line are all unchanged. A second satellite window should reuse this shell rather than invent a third.

### The faceted index (Resources)

`/applications/apps-resources` is the reference for a **browse-and-open collection** — a list whose task is "find the one I need and open it", not "audit a table". When the surface is a directory rather than a ledger, build this shape instead of reaching for `Table`. The layout is `grid lg:grid-cols-[12rem_minmax(0,1fr)] gap-x-10`: a facet rail, then the index.

- **A filter rail, not pill rows.** Vertical facet groups in the 12rem column ([`FilterRail.tsx`](src/app/(main)/applications/apps-resources/components/FilterRail.tsx)): each row a label plus a right-aligned `tabular-nums` count, each group headed by a plain `text-xs font-medium text-zinc-400` label — **not** the sidebar eyebrow, which stays a single-use device. Selection is the Action Blue **tint** (`/15`) plus `font-semibold text-white`; unselected rows sit at `text-zinc-400` and hover to the overlay, so hue separates selection from hover exactly as it does on the satellite shell's chat rows. Every facet carries `aria-pressed`. The rail is `lg:sticky lg:top-4` and folds into a `Popover` below `lg`, triggered by a button showing the active-filter count.
- **Counts are faceted, or they are lies.** Each facet is counted against every *other* active filter, so the number beside it is what clicking it will actually produce. Implement it by running the same predicate with that one facet cleared. A count taken over the whole collection leads people into empty lists and is worse than showing no count at all.
- **Rows are two lines, and the whole row is one target.** Line one is the name at `font-medium text-white` plus any state marks; line two is the Meta step (see § Typography). If a row's name and one of its fields point at the same destination, only the row is a link — two hit areas for one target is a table habit, not an affordance.
- **Show the identity of a link, not its address.** A truncated URL is a column of noise; the **host** (`docs.google.com`) is the fact the reader wants, with the full URL on `title` for anyone who needs it.
- **Section rails, not sticky headers.** A section is headed by a `font-mono text-xs font-semibold text-zinc-400` marker, a hairline rule (`h-px bg-white/[0.07]`) filling the width, and a right-aligned count. No sticky mechanics, so it can never fight the layout's own scroll container.
- **Sort for retrieval, and let a section carry the state.** Pinned first, then A–Z under letter rails — a known name is found by position, which a `lastEditedTime` sort never allows. This is also what makes a pin worth having: pinning **promotes the row into a Pinned section** rather than lighting an icon in a column. When a search suppresses the sections, the row must show the mark inline instead — state may not simply vanish because its container did.
- **Row actions crossfade with the row's own trailing content**, in one lane, on `:hover` **and** `:focus-within`. The lane takes a `min-w` equal to the action cluster, so nothing shifts, no long value runs underneath it, and the lane is never dead space. Omitting `:focus-within` makes the actions keyboard-unreachable — the same rule as the satellite shell's per-message menu.
- **Gate affordances, don't duplicate surfaces.** Readers and managers see one page; what a viewer may do is decided per row, and a row outside a manager's write scope renders a spacer so the action lane stays one column. There is no second "management" screen for the same collection.

### The decision queue (Disputes)

`/ca-portal/disputes` is the reference for a **queue of decisions** — a list whose task is "rule on each of these", as opposed to the faceted index's "find the one I need" or a table's "audit the column". When the reader's job on every row is *approve or reject*, build this shape rather than a table with an actions column.

- **The verdict is on the row, not behind a menu.** Approve and Reject sit in the row's trailing lane, always visible on the open list. An `⋯` popover costs three interactions for the page's only job. Approve is the affirmative outline (`border-green-500/30 bg-green-500/10 text-green-400`); Reject is a ghost in `text-red-400` — the asymmetry weights the affirmative path and halves the colour mass. Never `text-green-700` / `text-red-600`: those are light-mode inks and fail on the near-black ground.
- **A destructive verdict opens its reason in place**, in a bar on the overlay recipe directly under the row it belongs to — never a modal, never a squeezed inline input in the action lane. `Esc` cancels, `Enter` confirms, and a failed write keeps both the row and the typed reason.
- **The argument is shown, not truncated.** The comment is the whole basis of the decision, so it renders in full at `text-sm text-zinc-400`, capped at 70ch. A 15-character preview behind a `HoverCard` hides the deciding fact and is unreachable by keyboard.
- **Rows carry no hover fill.** Nothing about the row is clickable — the buttons are — so the row must not borrow the interactive overlay step. Separation is a `divide-white/[0.07]` hairline.
- **The same component renders the resolved list**, with the action lane swapped for the outcome pill. Two components for one list is how the two drift apart.
- **A multi-stage record shows one derived status, not its raw enums.** A dispute carries `CaApproval` + `AdminApproval` + an unassigned sentinel; the reader wants *where is this*. [`disputeStatus.ts`](src/components/disputes/disputeStatus.ts) collapses them into one closed vocabulary (Awaiting CA review / Awaiting admin / Declined by CA / Approved / Rejected by admin) and **borrows each hue from `STATUS_COLORS`** rather than typing a new one — orange waits on a person, blue is moving, green/red are outcomes. Any other two-stage approval record should derive its stage the same way.
- **The paginated foot states the truth it has.** `Showing 12 of 47` beside the pagination when there is more than one page, `47 disputes` when there isn't — never a computed range that assumes the server's page size.

### Loading & Empty States
- **Loading:** shadcn `Skeleton` shaped to the final layout (`<Skeleton className="h-64 rounded-xl" />`), never a bare spinner mid-layout. "Shaped to the layout" means the real thing — a two-line row skeletons as two bars of the right widths, and a facet rail as a stack of rail-height blocks — so nothing jumps when the data lands. Async home widgets gate boot via `useBootPhase('home-<name>', isLoading)`.
- **Empty:** a single quiet line — `text-sm text-zinc-400` ("Nothing outstanding.", "None") — never an illustration, and never wrapped in a bordered box. A box drawn around one sentence is a container pretending there is content in it. *(`text-muted-foreground` reads `#9f9fa9` and is a third grey for the same role — see the One-Grey Rule in §2. Use Ink Secondary.)*
- **Empty because of a filter is a different state from empty because there is nothing.** "No resources are shared with your group yet" is a fact; "Nothing matches these filters" is a dead end, and it must carry its own way out — an inline control that clears the filters and names what is behind them ("Clear them to see all 47"). Same one quiet line, one more verb in it.
- **A client-side lazy window needs no indicator.** When the next page is already in memory, it arrives in the same frame; a spinner on the sentinel is theatre for work that isn't happening. Render the sentinel as a bare `h-px` and let the count line below carry the state ("Showing 24 of 61").
- **Navigating between pages:** [`NavigationProgress`](src/components/NavigationProgress.tsx), and nothing else. A `<Link>` transition keeps the current page mounted and interactive until the next one is ready, so on a slow connection a click looks like a dead app — and an Electron window has no tab spinner to say otherwise. The escalation is deliberately reluctant: **nothing under 400ms** (most navigations land in under 200ms, and a bar that flashes on every click makes a fast app look slow), then a **2px Action Blue hairline** across the top on `--z-banner`, trickling toward 90% and never reaching 100 on its own — only the commit finishes it, so the bar never promises an arrival it does not control. Past that it earns **one quiet `text-xs text-zinc-400` line** in an overlay pill ("Still loading — slow connection", or a `WifiOff` variant when offline), and if the navigation cannot be rescued at all, a `size="xs"` **Reload** button. Never a spinner in the layout, never a modal, and never a bar with no way out of it. The indicator is inked `#3b82f6` in-component for the same reason OF Manager's Send button is — shadcn's `--primary` resolves to near-white here (see §2).

### The notification tray

The top-bar tray ([`NotificationTray.tsx`](src/components/NotificationTray.tsx)) is chrome an operator sits beside all day, so its personality is rationed accordingly: **one** authored beat, and it fires on arrivals only.

- **One mark, two facts.** A leading `size-2` dot carries the notification's **type** as hue and its **read state** as treatment — filled with a `0 0 0 3px hue/15` ring while unread, dropped to `opacity: 0.3` with the ring closed once read (200ms, in place). This is what makes *Mark all read* feel like something happened: every ring in the list fades out together and nothing moves. The old 4px full-height colour stripe is gone — it violated the no-decorative-side-stripe Don't.
- **Hues come from `NOTIFICATION_TYPE_DOT`** in [`notificationTypeBadge.ts`](src/lib/notificationTypeBadge.ts) — the `-400` semantic steps, the single source for a notification's colour on a dark ground. **Import it; never re-map a type to a hex inline.** Its sibling `NOTIFICATION_TYPE_BADGE` is the *light-chip* map for the admin surfaces (`-600` inks) and must not be used on the tray.
- **Unread rests at `bg-white/[0.025]`**, one overlay step *below* the hover value — resting at the hover value makes hover invisible on unread rows and makes every read row look unread under the cursor.
- **The unread badge is status-red filled with near-black ink** (`#f87171` / `#0A0A0A`, 7.2:1). White on `#f87171` measures 2.6:1 and fails outright — the same rule as the portal's `ACCENT_BTN`. Red rather than the strictly-semantic "pending" orange because a count badge is platform chrome first; every OS trains that shape to mean red.
- **The bell strike** (`.notification-bell-strike`, 420ms, ±9°, origin at the bell's crown) is the one authored moment: it swings when a notification *arrives* while the app is open — never on open, never on click, and never on the cold-start delivery, which the tray swallows deliberately. `.notification-badge-in` lands the count with it; `.notification-tray-in` is popover chrome, not an effect. All three declare their final state as the base style.
- **Day labels are sticky** inside the 480px scroll area, and relative stamps re-tick off one shared clock while the panel is open — a tray left open on a second monitor used to freeze at "5m ago" for the rest of the shift.
- **Row clicks do not toast on success** (the dot dimming is the confirmation, and this is a per-row action — the same high-frequency exception the satellite shell's send takes). *Mark all read* and *Clear read* do toast, with the real count.

### Stepped Flows (onboarding)

Multi-step first-run flows use one shared chrome — `src/app/(main)/onboarding/_components/OnboardingCard.tsx` — so every step is the same object with different contents. Never hand-roll a step card.

- **Ground & surface:** the login photo ground (`/backgrounds/2_blur.png`) over `bg-background`, with the card **opaque** at Surface `#171717` + hairline border, `rounded-xl`. No shadows. The translucent overlay recipe is *not* used for the card here — it assumes the near-black canvas behind it, and over a photo it drops body text under 4.5:1. Interior surfaces inside the card still use the overlay recipe normally.
- **Page lock:** the flow never scrolls as a page. The shell is `fixed inset-0` (out of flow, so it adds no document height), a mounted effect pins `html`/`body` to `overflow: hidden`, and the card is `max-h-full` and a flex column (header/footer `shrink-0`, body `min-h-0 flex-1`) so a long step scrolls inside its own body. Bounding only the shell is not enough — sibling content elsewhere in the layout still grows the document. Never size a step's scroll area with a `vh` calc; guessing the chrome height is what leaves dead space under the card.
- **Progress rail:** one `size-1.5` dot per step, left of the header. Behind → `bg-white/45`; current → Action Blue with `ring-4 ring-[#3b82f6]/15` (the One Voice Rule — current selection); ahead → `bg-white/12`. Color transitions only (120ms); never animate dot size or position. The rail is `aria-hidden` with a **single** `sr-only` line ("Step 3 of 6: Screen capture") beside it — labelling every dot made a screen reader recite the whole flow on each page.
- **Identity strip:** the signed-in user's name + `Avatar` (`size="sm"`, `aria-hidden`) on the right of the header, hairline-separated from the body. A step that presents identity in its own heading passes `identity="none"` rather than rendering a second avatar.
- **Actions:** `Back` is `variant="ghost"` (`text-zinc-400`), forward is the primary `Button` and takes `flex-1`. Long steps pass a `footer` so the actions pin below the scroll area instead of riding to the bottom of a long form.

**The completion moment** (`/onboarding/done`) is the **one place in the app that celebrates**, and the only sanctioned exception to the 120ms motion budget. A new hire crosses it once, ever. Its vocabulary lives in `globals.css` as `.onboard-seal` / `.onboard-tick` / `.onboard-rise` / `.onboard-pending`:

- A green success seal scales in (380ms), then the lucide `Check` **draws along its own path** via `stroke-dashoffset` — the icon set stays pure; no bespoke SVG is introduced.
- Content rises 6px into place on a 60–80ms stagger. The whole sequence completes inside **~660ms** and nothing bounces, slides far, or loops.
- Every base style is the **final** state, so the screen is correct if the animation never runs, and `prefers-reduced-motion` zeroes all of it (including closing the tick's `stroke-dashoffset`).
- `.onboard-pending` is the sole looping animation: a 2.4s opacity pulse on the single status dot that is genuinely in progress. It encodes state — it is not decoration.

**Do not extend this vocabulary to other screens.** Its scarcity is the entire point; a second celebration makes the first one furniture.

### Signature Component: Tinted Summary Cards + Kanban
The `OverviewTab` in `custom-requests/page.tsx` is the reference look for any dashboard. Three parts:

- **A. Summary tile row** — `grid grid-cols-2 lg:grid-cols-4 gap-4` of compact `Card`s (`gap-3 py-4`): a `CardDescription` label + a big `CardTitle text-2xl font-semibold tabular-nums` metric, optional `CardAction` badge. Body is either a top-3 ranked list (avatar + name + count Badge, then "+N more") or an inline donut (`ChartContainer` + `PieChart` with a centre `RechartsLabel` total).
- **B. Category-tinted section cards** — a `Card` whose border + wash + title hue encode its meaning: Completed → `border-green-500/30 bg-green-500/5` / `text-green-400`; Archived → orange; Customs → blue; Payments → red. Title `text-sm font-semibold`; `CardAction` holds a legend or an `outline` "Dismiss All" button.
- **C. Multi-column kanban** — a CSS-columns board (`columnWidth: "13rem"`, `columnCount: 4`, `columnGap: "0.75rem"`), so uneven columns pack tightly. Each column (`break-inside-avoid mb-3 rounded-xl p-2.5`) sits on the white-overlay surface, headed by a `size-4` avatar + truncated name + right-aligned count. Items are compact button-rows with a **left accent border** (`border-l-2`, `rgba(255,255,255,0.14)`), a `StatusDot`, a `font-mono text-xs` code, and an optional right-aligned amount, each `hover:brightness-110 active:scale-[0.98]` when clickable.

The throughline: **the card's tint tells you the category at a glance, the kanban groups by entity, and every leaf row is a dense, monospaced, tappable line.**

### Interaction / Motion
- Global 120ms ease-out transition on color/opacity for all interactive elements (`globals.css`).
- **Clickable rows have two idioms, chosen by whether the row has a fill of its own.** A row that sits on a surface (kanban items, tinted cards) uses `transition-all hover:brightness-110 active:scale-[0.98]`. A row that is **transparent on the canvas** steps through the overlay recipe instead — `hover:bg-white/[0.055]` → `active:bg-white/[0.08]` (§4) — because `brightness` on a transparent element changes nothing, and a `scale` on a full-bleed row drags any absolutely-positioned actions with it. Picking the wrong one is why a row can look inert under the cursor.
- **Focus is a 2px inset Action Blue ring** (`focus-visible:ring-2 focus-visible:ring-inset`, `--tw-ring-color: #3b82f6`) on rows, facets and any full-width interactive element. Inset so it can't be clipped by the row's own rounding, and Action Blue because keyboard focus *is* current selection — the One Voice Rule. Never remove the ring without replacing it with something equally visible.
- **Reveal-on-hover must also reveal on `:focus-within`.** Anything hidden until hover is invisible to the keyboard otherwise. This applies to every hover-revealed action cluster in the app.
- Text links in dense lists: `hover:text-white hover:underline underline-offset-2`.
- Custom scrollbars are thin (6px) translucent-white, inherited globally — don't override.

## 6. Do's and Don'ts

### Do:
- **Do** keep the canvas near-black (`#0A0A0A`) and let chrome recede — the data is the interface.
- **Do** build depth from the white-overlay recipe (`rgba(255,255,255,0.025)` bg / `0.07` border) plus hairline borders.
- **Do** pull every status/priority color from `campaignTracking.ts` and apply the `-400` text / `/10` fill / `/30` border triad.
- **Do** put `tabular-nums` on every count, amount, and metric, and `font-mono text-xs` on every code/ID (CR0001).
- **Do** use only `src/components/ui` components, only `@tabler/icons-react` / `lucide-react` icons, and only `Avatar` for images.
- **Do** shape `Skeleton`s to the final layout, write empty states as one quiet `text-zinc-400` line, and `toast` every mutation outcome.
- **Do** keep motion to 120ms transitions, and pick the right row idiom: the overlay steps for transparent rows, `hover:brightness-110 active:scale-[0.98]` for rows with their own fill.
- **Do** give a filtered-empty state a way out of itself, and reveal hover-only actions on `:focus-within` too.
- **Do** stack app surfaces with the `--z-*` scale (`--z-overlay` < `--z-banner` < `--z-toast`) via `var(--z-*)`.
- **Do** make it read like `custom-requests/page.tsx`. If it doesn't, reconcile.

### Don't:
- **Don't** add drop shadows for depth — raise the white overlay instead (The No-Shadow Rule).
- **Don't** use color as decoration; if a colored pixel doesn't encode state, category, or the one Action Blue voice, remove it (The Semantic-Only Rule).
- **Don't** hash a free-form string to a colour palette. Mapping an open-ended label — a type, a tag, an author — onto N hues *looks* semantic and encodes nothing: the hue is unlearnable, it changes if the string is edited, and N of them at once is a rainbow on a greyscale console. The Resources page shipped ten such hues and they were removed wholesale. Open-ended labels are Attribute chips; only a closed vocabulary with a meaning per value earns a hue, from `campaignTracking.ts`.
- **Don't** put a border around an empty state, a single sentence, or a lone control — a box implies contents.
- **Don't** hardcode a themeable hex — use the CSS variables / Tailwind tokens.
- **Don't** introduce another component library, hand-roll a primitive that exists in `src/components/ui`, or use icons outside `@tabler/icons-react` / `lucide-react`.
- **Don't** use a raw `<img>` — always `Avatar`.
- **Don't** reach for a modal first, drop a spinner into the middle of a layout, or ship an "illustration" empty state.
- **Don't** introduce a second font family, oversized display type (the sole exception is the time-tracking `Instrument` step — see § Typography), gradient text/heros, or glassmorphism — this is not a marketing site.
- **Don't** use a colored side-stripe as a decorative accent; the only left-border in the system is the kanban row's functional `border-l-2` overlay edge.
- **Don't** reach for a magic `z-[9999]`; use the semantic `--z-*` layer whose name matches the role (The Named-Layer Rule).

## 7. Creator Portal (external skin) — "Deep Ink"

Everything above describes the **internal console** — the Electron app internal staff live in. The **creator portal** (`src/app/creator/`) is a separate surface: a Telegram Mini App for **external creators**, read almost entirely on a phone, usually to answer one question — *what do I owe, and is anything late?* This is an **authored divergence**, not drift, and as of the 2026-09 redesign it is a **Committed** colour surface, not a Restrained one: the ground itself is brand-tinted, and the brand azure carries structure (the time axis, below), not just accents. The audience and the question being asked are different enough from the console's operator-scanning-a-ledger posture to earn a different design system, not just a different accent hue.

**The skin is defined once, in code, in [`src/app/creator/theme.ts`](src/app/creator/theme.ts).** Import those tokens; never hardcode a portal color, gradient, badge map, or surface recipe inline. If the visual language changes, change `theme.ts` and this section together.

### The signature motif: the spine

The portal's dashboard and both list pages are organised around **one continuous vertical time axis** — [`components/Spine.tsx`](src/app/creator/components/Spine.tsx) — not a card grid. Work is pinned to it as nodes in the order it comes due: overdue above a lit "now" marker, then one graduation per upcoming day below. This is the structural answer to "what do I owe" — a creator reads position on the line, not a table of dates.

- **Every node is a shape *and* a hue, never hue alone.** Measured on this palette, `azure` against the AA-legal `ink2` is **1.14:1**, and `late` against `ink2` is **1.35:1** — nowhere near the 3:1 WCAG 1.4.11 requires of a state indicator. So urgency is drawn as a **filled vs. hollow node**, a **halo** on overdue items, and the accompanying **countdown word** ("2d late", "due today") — colour is the fourth cue, never the only one. This governs the tab bar's active state and the sidebar's selected row too (see below).
- **The runway.** Each work row carries a thin burn-down bar — [`components/WorkRow.tsx`](src/app/creator/components/WorkRow.tsx)'s `Runway` — showing how much of the item's window has elapsed, driven by `transform: scaleX()` (never `width`, which would relayout a live-updating list) and eased in `creator.css`'s `.pf-runway-fill`.
- **The completion seal is the portal's one authored motion moment.** A node fills, a ring expands once, the row recedes (`.pf-seal` / `.pf-ring` / `.pf-recede`, ~380–520ms, `cubic-bezier(0.22, 1, 0.36, 1)`, never a bounce). Paired with a Telegram `HapticFeedback` pulse where available ([`lib/haptics.ts`](src/app/creator/lib/haptics.ts) — every call is optional and silently absent on an older client; a garnish may never become a failure mode). Every animation's base style is its finished state, so a headless render or `prefers-reduced-motion` (which zeroes everything except a 1ms crossfade on the seal) is never wrong, only quiet. Do not extend this vocabulary to hover states or navigation — its scarcity is the point, exactly as the console reserves its own onboarding-completion vocabulary.

### Colour: Committed, not Restrained

- **The ground is brand-tinted ink, not neutral black.** `COLOR.void` / `ground` / `surface` / `raised` in `theme.ts` are derived from OKLCH at a low, constant chroma toward hue 250 — visibly the portal's own ground rather than the console's neutral near-black. Every contrast figure below was measured against this ramp, not estimated.
- **Bluu azure (`#00b8f5`, `COLOR.azure`, sampled from the logo) is still the one brand voice** — it marks the spine's "today" state, links, focus, the avatar fallback, and the single `PRIMARY_BTN` action — but it is no longer the *only* place colour appears, because urgency now has its own closed vocabulary.
- **Urgency is a four-value closed vocabulary — `URGENCY` in `theme.ts` — and colour is spent on nothing else.** `late` (coral, `#f9746d`), `today` (azure), `soon`/`later` (neutral — a thing not yet due is not worth a hue), `undated` (neutral, dimmer). This directly replaces the old portal's split personality where a due date was unconditionally rose-tinted *and* a separate component used red to mean "actually late" — the same colour meaning two things in one scroll. There is exactly one meaning of "late" now, defined once, in one file.
- **Content types and priority are attribute chips, not hues.** A content type (`SFW`/`PPV`/…) or a priority (`High`/`Medium`/`Low`) is a closed vocabulary the record carries, not a state it is *in* — the same distinction §5's Attribute Chip rule draws for the console — so both render greyscale (`contentTypeBadge`, `PRIORITY_CHIP`) rather than each claiming its own saturated hue. The old five-hue content-type map (blue/orange/purple/pink/teal) was a rainbow sitting next to a four-value urgency system that needs its colours to mean something; it is gone.
- **`ink3` (the third text step) is not legal on `raised`.** Measured: 5.4:1 on `void`, 5.2:1 on `ground`, 4.7:1 on `surface` — all AA-legal — but **4.1:1 on `raised`**, which fails. Use it for meta on the page ground; step up to `ink2` inside a raised row.
- **Fills never take white ink.** White on `azure` measures 2.29:1 and fails outright (`azureInk`, `#04222e`, reads 7.20:1); white on the `done` emerald fill would fail the same way (`#050b12`, the void ink, reads 9.11:1 on it instead). Never re-ink a filled action white to "match" the console.

### What carries over from the console (unchanged)

- Opaque surfaces (not the console's translucent-white-on-black recipe — see below), hairline borders. **No drop shadows.**
- **No gradient fills** on buttons or cards. Actions are solid: `PRIMARY_BTN` (azure), `COMPLETE_BTN` (emerald), `ACCENT_BTN` (soft azure tint), `QUIET_BTN` (bordered neutral).
- `tabular-nums` on every amount; the portal's own mono (below) on every code, date and countdown.
- Only `src/components/ui` primitives; only `Avatar` for images (the logo asset — see §5 Brand logo — is the sole non-Avatar image).
- `Skeleton`s (and the spine-shaped route `loading.tsx`) for loading, never a spinner mid-content; every mutation `toast`s its outcome.
- **One glow rule, reinterpreted.** The console's single decorative-colour exception used to be a radial glow behind the page ground. It is gone: the spine is now the portal's one authored visual signature, and a wash behind a time axis made the axis harder to read, not more branded. The portal still spends colour on exactly one deliberate, non-semantic thing at a time — it is just the axis now, not a gradient.

### What differs further (the authored part)

- **Opaque surfaces, not translucent-white overlays.** The console builds depth by layering white at low alpha on a *neutral* ground; on the portal's *tinted* ground that recipe desaturates the brand out of every panel the moment something sits on top of it. `SURFACE.panel` / `card` / `raised` in `theme.ts` are flat fills instead (`COLOR.surface`, `COLOR.raised`) — this is the portal's one deliberate departure from §4's Overlay-Not-Grey Rule, and it exists specifically because the portal's ground is not neutral.
- **A second typeface, scoped hard.** [`fonts.ts`](src/app/creator/fonts.ts) self-hosts JetBrains Mono (400/500/700, `latin`, via `next/font`) as `--font-portal-mono`, applied only on `layout.tsx`'s own wrapper so the console never inherits it. It carries the numeric column of the axis — dates, countdowns, CR codes, amounts (`.pf-mono` in `creator.css`) — where real tabular figures make the column read as an instrument. This is the one place the portal departs from §3's One-Family Rule; the departure is scoped to a single CSS variable and a single utility class, never a second ad-hoc font stack.
- **Friendlier empty states, and two of them.** [`components/EmptyState.tsx`](src/app/creator/components/EmptyState.tsx) distinguishes *finishing* everything (`tone="done"`, an emerald mark) from *nothing being scheduled* (`tone="neutral"`) — the first is an achievement, the second a status, and they must not share copy or a mark.
- **The verdict is prose, not a metric.** The dashboard opens with one sentence — "Two things are overdue." / "You're all caught up." — from [`lib/agenda.ts`](src/app/creator/lib/agenda.ts)'s `buildVerdict`, deliberately not the big-number-and-label hero this category defaults to. A creator opening the app at midnight wants the answer, not a number to interpret.

### Data model: one merged agenda, not two sections

[`lib/agenda.ts`](src/app/creator/lib/agenda.ts) and [`lib/useCreatorWork.ts`](src/app/creator/lib/useCreatorWork.ts) are the portal's data layer, shared by all three work-listing screens. Customs and content-planning records are merged into one `AgendaItem` stream ordered by urgency, rather than each screen reading its own collection and inventing its own grouping.

- **The visibility gate lives in one place.** `selectVisibleCustoms` / `selectVisibleContent` in `agenda.ts` are the single definition of "a creator's active work": customs at `In Progress`, content at `Outstanding`, never archived, never a campaign type (BFE/Hubby/VIP). The Firestore queries in `useCreatorWork` already ask for the right `status`; this is the second gate that also drops anything archived, so a query change elsewhere can't silently widen what a creator sees.
- **Completion is optimistic, sealed, and undoable — one mutation for both record types.** `useCreatorWork.complete()` plays the seal immediately, and the request runs underneath; on failure the row is restored and says so. The success toast always carries **Undo**, which calls the same endpoint with `{ revert: true }`. This is what fixed the portal's one standing inconsistency: content-planning completion used to be one-way while the dashboard's identical action was undoable — the same record behaving differently depending on which screen you tapped it from. Both now go through the one function.
- **A submitted record leaves the creator's world and enters the staff one.** Both `creator-complete` endpoints (`/api/campaign-tracking/[id]/creator-complete`, `/api/content-planning/[id]/creator-complete`) write `status: 'Completed'` with `isArchived` left `false` — exactly the predicate the internal **Recently Completed** panels on `/creator-portal/custom-requests` and `/creator-portal/content-planning` already query. Nothing in the completion flow changed to make that true; it was already the contract, and this redesign relies on it rather than re-plumbing it.
- **Customs now have a real overdue state**, resolved through the same `isOverdue(dueDate, creatorUser.defaultTimezone)` helper content planning already used ([`src/lib/timezone.ts`](src/lib/timezone.ts)) — previously only content planning computed one at all.

### Components & interaction (portal-specific)

- **One dialog vocabulary.** Every detail view uses shadcn `Dialog` via [`components/CreatorDialog.tsx`](src/app/creator/components/CreatorDialog.tsx) — Esc-to-close, a focus trap, `role="dialog"` for free, a sticky footer so a long record's primary action never scrolls out of reach. **Never hand-roll an overlay.** `CustomRequestDialog` and `ContentPlanDialog` both take an `AgendaItem`, not a raw Firestore record, so both dialogs and every list row read the same shape.
- **The button reads "Done", never "Mark Completed" or "Submit for review".** Completion still routes a record to *Awaiting Approval* (customs) or a pending-review state (content) server-side — that workflow detail is deliberately not surfaced in the label. "Done" is the creator's own point of view: she has finished her part. Two safety models, by stakes, unchanged in substance:
  - **Customs (high-ticket):** a **deliberate two-step** — open the detail dialog, then confirm — so a stray tap in a dense list can't complete one. Undo reverts to *Awaiting Approval*.
  - **Content planning (routine):** one tap from the row itself (a dedicated 44px tick target, separate from the row's own open-detail tap target), with the same Undo toast.
- **Every content-planning row also names its kind.** A merged agenda item carries `typeLabel` — `"Custom"` / `"Call"` / `"Item"` for a custom request, `"Content Request"` for content planning, always present — so a creator scanning the spine can tell the two record types apart at a glance; the record's own content type (`SFW`/`PPV`/…) rides alongside it as a separate `contentTypeBadge` chip. See `lib/agenda.ts`.
- **The stream, not a grid.** Outstanding items render down the spine in due-date order; the all-customs page groups the same items by type (customs are a ledger question — "how much" — as well as a schedule question). Neither uses horizontal paging.

### Mobile is the design target (and the portal runs inside Telegram)

Creators read this surface almost entirely on a phone, so — as with §8 — mobile is the target, not a breakpoint.

- **Primary navigation lives in the thumb zone.** [`CreatorBottomNav`](src/app/creator/components/CreatorBottomNav.tsx) is a fixed four-tab bar below `md`; the shadcn `Sidebar` (and every page's `SidebarTrigger`, `hidden md:inline-flex`) is **desktop-only**. The four destinations are declared once in [`nav.ts`](src/app/creator/nav.ts) — `title` for the sidebar, `shortTitle` for the tab bar, ordered by how often a creator actually uses them (Today, Customs, Content, then the reference-only Welcome Guide last) — and both navs read from it. The bar's surface is `TABBAR_STYLE` (rule 1 applies).
- **Google Drive lives in the header, not a section card.** [`components/PortalHeader.tsx`](src/app/creator/components/PortalHeader.tsx) is the one top bar for all four screens and carries the Drive link as a persistent affordance — uploading is the physical act the whole portal coordinates, and a creator who has just finished filming needs the folder from whatever screen she is on, not from the bottom of one page's scroll.
- **`min-h-dvh`, never `min-h-screen`.** `100vh` on a mobile browser excludes the collapsing URL bar. Every portal page ground uses `dvh`.
- **16px field text; zoom is never blocked.** Same rule and reasoning as §8.

**The frame is Telegram's webview, and the PWA install path is gone.** The portal is a Telegram Mini App: creators reach it from the bot's chat menu button, and `CreatorPortalShell` signs them in from Telegram's `initData` (see [telegram.md](documentation/telegram.md)) — none of that session logic changed in this redesign. [`src/app/creator/layout.tsx`](src/app/creator/layout.tsx) is still scoped to the `/creator` segment, so the internal Electron console never inherits its viewport, its stylesheet (`creator.css`), or its second typeface.

**An empty type collapses; it does not announce itself.** A customs type (Customs / Calls / Items) with nothing in it renders no group at all — unchanged from before the redesign, now implemented in `customsByType` (`agenda.ts`) rather than per-page.

**Failure is a state, never an empty list.** [`LoadError`](src/app/creator/components/LoadError.tsx) is what a failed Firestore listener renders, and `useCreatorWork` sets its error flags *before* clearing `loading` — every consumer branches to `LoadError` before its empty branch. **An empty state must be reachable only from a successful snapshot with zero documents.** `retry()` re-subscribes both listeners rather than reloading, so a transient failure costs one tap and no scroll position.

**The tab bar's and sidebar's active states are a shape, not a hue** — see "Every node is a shape and a hue" above; the same measured failure (azure vs. the AA-legal ink step is 1.14:1) governs both. The tab bar carries a 2px azure top rail plus a label-weight step; the sidebar carries an azure tint fill plus a weight step. Neither may be simplified to a colour swap.

**There is deliberately no service worker.** Unchanged: every screen is a live Firestore subscription, so offline caching would serve stale work as if it were current — worse than an honest network error.

### Portal rules (in addition to everything in §1–6)

1. **Import the skin from `theme.ts`.** No inline portal hexes, gradients, or surface recipes. A literal hex is legal in exactly one place: `theme.ts` itself, where Tailwind's static-string scanning leaves no alternative — and even there it must be a named token's value, documented in its own comment. New portal color → add it to `theme.ts` **and** the `creator-*` palette entries in this file's frontmatter.
2. **Bluu azure is the portal's one brand voice.** It marks brand/interactive accent and the spine's "today" state only — never decoration.
3. **Urgency is the portal's other colour vocabulary, and it is closed at four values.** `late` / `today` / `soon` / `later` / `undated` from `URGENCY` in `theme.ts`. A hue that means something other than urgency or brand does not belong on this surface — content types and priority are greyscale for exactly this reason.
4. **Solid fills only** — no gradient or glow buttons/cards. `PRIMARY_BTN` / `COMPLETE_BTN` / `ACCENT_BTN` / `QUIET_BTN` are a hierarchy, not a palette: **`PRIMARY_BTN` appears at most once per screen.**
5. **Every state cue is a shape plus a hue, never hue alone.** This is not a preference — it is measured (§ Colour, above) and it governs every future addition to the spine, the tab bar, and the sidebar.
6. **Detail & confirm = shadcn `Dialog`** through `CreatorDialog`. No bespoke overlays.
7. **"Done", never "Mark Completed", "Submit for review" or "Completed"**, and every completion is undoable via the `revert` flag, for both record types, from every surface that offers completion.
8. **A new destination goes in [`nav.ts`](src/app/creator/nav.ts)**, with a `shortTitle` that fits a quarter of a phone's width — never in one nav only. Past four tabs the bar needs rethinking, not a fifth squeeze.
9. **A listener error branches to `LoadError` before the empty branch.** No new Firestore subscription on this surface ships without one.
10. **≥44px on every control**, not just the nav. Where a glyph must stay small, expand the hit area with `after:absolute after:-inset-N` rather than shrinking the target.
11. **The mono typeface is scoped to `.pf-mono` and the portal's own numeric content.** Never apply `--font-portal-mono` to prose, and never let it leak past `layout.tsx`'s wrapper.

### Resolved since the 2026-09-02 critique

The prior version of this section documented four deferrals left open by that critique. This redesign addresses all four as part of the same change, rather than carrying them forward again:

- **Content-planning completion is now undoable**, via the shared `useCreatorWork.complete()`/`undo()` pair — no longer one-way while the dashboard's was reversible.
- **The button reads "Done"**, not "Mark Completed" and not "Submit for review" — see Components & interaction, above. ("Submit for review" was this redesign's own first pass, replaced again after the client asked for plainer language.)
- **Content-planning rows now name their kind.** A merged agenda used to leave a content item's `SFW`/`PPV` sub-type as its only label, with nothing saying "this is a content request" the way a custom shows "Custom"/"Call"/"Item" — fixed via the `typeLabel`/`contentTypeLabel` split in `agenda.ts`.
- **The "your payments are governed by your signed management agreement" line is gone** from every surface that carried it (the dashboard ledger, both detail dialogs, the welcome guide) — a client copy decision, not an accuracy fix; the underlying figures are still internal tracking numbers, that fact alone is what remains stated.
- **Customs now compute a real overdue state**, through the same timezone-aware helper content planning already used.
- **Red means exactly one thing.** The closed `URGENCY` vocabulary replaces both the unconditional rose due-date colour and the separate red-means-late convention with a single definition, in one file.

One earlier deferral from the same critique — the login/refusal card's glassmorphism — was also fixed in this pass: `CreatorPortalShell`'s `Screen` component is now an opaque `COLOR.surface` card, consistent with §5's ban on glassmorphism-as-decoration.

## 8. Public model application form (external skin)

The **third** surface: `/model-submissions`, a fully public, unauthenticated form read once, on a phone, by a prospective model deciding whether to trust us. It is louder in scale than the console because it is a brand surface, and quieter in colour than a marketing page because the subject is confidential. Like §7 this is an **authored divergence**, not drift.

**The skin is defined once, in [`src/app/model-submissions/_lib/theme.ts`](src/app/model-submissions/_lib/theme.ts).** Import those tokens; never inline a hex on this surface. Full subsystem detail — including the abuse model — lives in [model-submissions.md](documentation/model-submissions.md).

### What carries over
- Near-black ground, translucent-white overlay surfaces (`PANEL`), hairline borders, **no drop shadows**, no gradient fills.
- Only `src/components/ui` primitives; only `@tabler/icons-react` / `lucide-react` icons.
- Bluu azure (`AZURE`, `#00b8f5`) as the **one voice** — the progress rail, focus, the selected choice, and the single primary action. Same hue as the creator portal, same scarcity discipline.

### What differs (the authored part)
- **"The stage."** One azure stage-light wash falls from above the page (`STAGE_GROUND`). This is the surface's *one* decorative-colour exception — the analogue of the console's backdrop blur and the portal's page glow. **Do not add a second.**
- **Display scale.** Step headings run `text-3xl` → `sm:text-4xl`, above the console's `Display` ceiling. Justified: one heading per viewport on a brand surface, not a data screen. It does not license a bigger number anywhere else.
- **16px field text** (`FIELD`), not the console's 14px. Anything smaller makes iOS Safari zoom the viewport on focus and the applicant loses their place in the form.
- **Dropdowns are re-sized for this surface** (`FIELD_MENU` / `FIELD_MENU_ITEM`). shadcn's `SelectContent` / `SelectItem` are console-sized — 14px rows around 30px tall — which is both off-scale here and under the 44px touch target. Every `Select` on this surface passes both tokens, plus `position="popper"`: the default `item-aligned` mode positions the panel by measuring the value node, so a trigger rendering its own content instead of a `SelectValue` opens **nothing at all** — and `popper` is also what lets the narrow dial-code trigger drop a full-width list of country names.
- **`AZURE_INK` on azure.** White on `#00b8f5` measures 2.3:1 and fails AA outright; the brand-tinted near-black reads 7.2:1. Never re-ink it white. (Same rule as the portal's `ACCENT_BTN`.)
- **The thank-you screen celebrates.** It reuses the onboarding completion vocabulary (`.onboard-seal` / `.onboard-tick` / `.onboard-rise`) plus a `.stage-bloom` and a single confetti burst. §5 says not to extend that vocabulary to other screens; the exception is deliberate and narrow — this is the *same beat* (a once-ever completion) on a *different surface*, and sharing the primitives keeps one motion language rather than inventing a second. It is not licence for a third celebration.

### Surface rules (in addition to §1–6)
1. **Import the skin from `_lib/theme.ts`.** New colour → add it there **and** to this section.
2. **One glow, one voice.** Azure marks brand/interactive accent only; the stage wash is the sole decorative use.
3. **Mobile is the design target**, not a breakpoint: 16px inputs, ≥44px touch targets, a sticky action bar with `env(safe-area-inset-bottom)`, one question group per scroll.
4. **Every field goes through `Field`**, which owns the label / hint / error association. Pass `group` when the control is a radio set or composite — a `<label for>` pointing at a group is invalid.

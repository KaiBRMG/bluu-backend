---
name: Bluu Backend
description: Dark, quiet, information-dense internal management console where the data is the interface.
colors:
  canvas: "#09090b"
  sidebar: "#18181b"
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
  creator-accent: "#00b8f5"
  creator-accent-deep: "#0090c8"
  creator-blue: "#3b82f6"
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

The canonical reference implementation is `src/app/(main)/creator-portal/custom-requests/page.tsx` — when in doubt, mirror it. Its overview widgets are the house style for every dashboard and summary surface (the [Signature widget pattern](#5-components)).

**Key Characteristics:**
- Near-black canvas (`#0A0A0A`), low-chroma surfaces, 14px base type, tight spacing.
- Greyscale by default; color is strictly semantic (status / priority / category).
- Soft elevation from translucent white overlays + hairline borders — never shadows.
- Every number is `tabular-nums`; every code/ID is `font-mono`.
- Fast, subtle motion: 120ms ease-out; `hover:brightness-110 active:scale-[0.98]` on tappable rows.

## 2. Colors

A greyscale-on-black palette where the only saturated pixels carry state.

### Primary
- **Action Blue** (`#3b82f6`): The single interactive accent — tints, borders, selection washes, and marks that carry no text. Used sparingly; it is the one voice that means "act here."
- **Action Blue Deep** (`#2563eb`): The **filled** step — any Action Blue surface that carries white text (primary buttons, a selected filter chip). Hover deepens again to `#1d4ed8`. This is an accessibility floor, not a preference: white on `#3b82f6` measures **3.68:1** and fails AA for anything under 18px, while white on `#2563eb` reads **5.17:1**. Tint at `#3b82f6`, fill at `#2563eb`.

  Two things do **not** yet follow this and are outstanding, both one-line changes with app-wide visual effect (deliberately left for a separate decision): `.btn-primary` in `globals.css` still fills at `#3b82f6` with white ink, and shadcn's `Button` `default` variant resolves `--primary` to **near-white** (`oklch(0.92 …)`, the stock `.dark` value) rather than to Action Blue at all — so most primary buttons in the app are currently white, not blue. OF Manager's Send button is inked correctly at `#2563eb` in-component; treat it as the reference, not as drift.

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

## 3. Typography

**Display / Body / Label Font:** Google Sans (both `--font-sans` and `--font-mono` map to it), fallback system stack.

**Character:** One family carries everything — headings, data, labels, code. There is no display/body pairing; a product this dense would only be made noisier by type contrast. Weight and `tabular-nums` do the work that a second family would.

### Hierarchy
- **Instrument** (700, `text-5xl` → `sm:text-6xl` / 48–60px, `tabular-nums`): The **single** sanctioned oversized number — the live clock on the time-tracking page ([`applications/time-tracking/page.tsx`](src/app/(main)/applications/time-tracking/page.tsx)), read from across a desk. This is the one exception to the "no oversized display type" Don't; it earns it because the timer *is* the page's reason to exist, not decoration. `tabular-nums` does the alignment (in this project `font-mono` also maps to Google Sans, so the mono class is cosmetic here — the numeric feature is what matters). Do **not** cite this step to justify another big number: outside the timer, `Display` is the ceiling.
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

**The Avatar Seed Rule.** Every fallback avatar is derived from **`displayName`** (`getAvatarColor(displayName || 'User')` + `getInitials(displayName)`), exactly as `AppLayout` and `NavUser` do it. `getAvatarColor` **hashes** the string it is given, so seeding from any other value — a full name, an email, a nickname in form state — changes both the initials *and* the colour, and the same person appears as two different avatars across screens. Display a fuller name as *text* if the surface calls for it, but always seed the avatar from `displayName`.

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
- **Page icons are lucide**, mapped by name in `ICON_MAP` in [`src/components/PageIcon.tsx`](src/components/PageIcon.tsx) — the one place the `icon` string on a `PageDef`/`TeamspaceDef` is resolved, shared by the sidebar and `/admin-portal/sharing`. Render them with `<PageIcon name={page.icon ?? undefined} />`; never re-map icon names locally, or a page added to `definitions.ts` renders in one surface and not the other. The one escape hatch is `SVG_ICONS` — brand marks with no lucide equivalent (currently only OF Manager's `/Icons/onlyfans.svg`), rendered through `next/image` at `size-4`, exactly as the sidebar logo already is. Add to it only for a real third-party brand; anything expressible in lucide belongs in `ICON_MAP`.

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

### Loading & Empty States
- **Loading:** shadcn `Skeleton` shaped to the final layout (`<Skeleton className="h-64 rounded-xl" />`), never a bare spinner mid-layout. Async home widgets gate boot via `useBootPhase('home-<name>', isLoading)`.
- **Empty:** a single quiet line — `text-sm text-muted-foreground` ("Nothing outstanding.", "None") — never an illustration.

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
- **Do** stack app surfaces with the `--z-*` scale (`--z-overlay` < `--z-banner` < `--z-toast`) via `var(--z-*)`.
- **Do** make it read like `custom-requests/page.tsx`. If it doesn't, reconcile.

### Don't:
- **Don't** add drop shadows for depth — raise the white overlay instead (The No-Shadow Rule).
- **Don't** use color as decoration; if a colored pixel doesn't encode state, category, or the one Action Blue voice, remove it (The Semantic-Only Rule).
- **Don't** hardcode a themeable hex — use the CSS variables / Tailwind tokens.
- **Don't** introduce another component library, hand-roll a primitive that exists in `src/components/ui`, or use icons outside `@tabler/icons-react` / `lucide-react`.
- **Don't** use a raw `<img>` — always `Avatar`.
- **Don't** reach for a modal first, drop a spinner into the middle of a layout, or ship an "illustration" empty state.
- **Don't** introduce a second font family, oversized display type (the sole exception is the time-tracking `Instrument` step — see § Typography), gradient text/heros, or glassmorphism — this is not a marketing site.
- **Don't** use a colored side-stripe as a decorative accent; the only left-border in the system is the kanban row's functional `border-l-2` overlay edge.
- **Don't** reach for a magic `z-[9999]`; use the semantic `--z-*` layer whose name matches the role (The Named-Layer Rule).

## 7. Creator Portal (external skin)

Everything above describes the **internal console** — the Electron app internal staff live in. The **creator portal** (`src/app/creator/`) is a separate surface for **external creators** in a normal browser, and it wears a deliberately warmer, friendlier skin. This is an **authored divergence**, not drift: it trades the console's monochrome restraint for a single Bluu-azure brand voice (sampled from the company logo), because the audience and context differ (a creator marking their own work done, not an operator scanning a data console).

**The skin is defined once, in code, in [`src/app/creator/theme.ts`](src/app/creator/theme.ts).** Import those tokens; never hardcode a portal color, gradient, badge map, or surface recipe inline. If the visual language changes, change `theme.ts` and this section together.

### What carries over from the console (unchanged)
- Near-black ground, translucent-white overlay surfaces, hairline borders. **No drop shadows** (the portal previously used `box-shadow` card lifts and glow shadows — both removed).
- **No gradient fills** on buttons or cards. Actions are solid: `PRIMARY_BTN` (full-strength azure), `COMPLETE_BTN` (emerald) and `ACCENT_BTN` (soft azure). The old green→emerald gradient CTA with a glow is gone.
- `tabular-nums` on every amount; `font-mono text-xs` on every CR code.
- Only `src/components/ui` primitives; only `Avatar` for images (the profile menu uses `Avatar`, never a raw `<img>` — the logo SVG is the sole non-Avatar image).
- `Skeleton`s shaped to the layout for loading (never a spinner mid-content); every mutation `toast`s its outcome.

### What differs (the authored part)
- **Brand voice is Bluu azure, not Action Blue.** `creator-accent` (`#00b8f5`, `ACCENT.hex`) — the bright cyan-azure sampled from the company logo, kept distinct from the console's royal Action Blue (`#3b82f6`) — marks CR codes, links, focus, the avatar fallback, and the single `PRIMARY_BTN` action — the portal's one non-semantic voice, used as sparingly as the console uses blue. In Tailwind it maps to the `sky-*` scale. Named category hues live in `HUES` (sky / blue / amber / emerald) for section icons and the customs/calls/items type accents (`TYPE_META`).
- **One signature brand glow.** A single `radial-gradient(... rgba(0,184,245,0.08) ...)` sits behind every portal page ground (`PAGE_GROUND_STYLE`). This is the portal's *one* decorative-color exception — the analogue of the console's single backdrop-blur — and it is the only place color is spent on mood. Do not add a second.
- **Dense badge caption size.** Content-type / status badges use `text-[10px]`, the established dense-caption step (see § Typography, Code) — legitimate here, not a new size.
- **Friendlier empty states.** A small icon-in-circle + one line ("All caught up!") instead of the console's single quiet line — a deliberate warmth for this audience.

### Components & interaction (portal-specific)
- **One dialog vocabulary.** Every detail view and confirmation uses shadcn `Dialog` via [`components/CreatorDialog.tsx`](src/app/creator/components/CreatorDialog.tsx) — which gives Esc-to-close, a focus trap, and `role="dialog"` for free. **Never hand-roll a `createPortal` overlay** (the portal used to have three; all replaced). The two typed detail views are `CustomRequestDialog` (customs/calls/items) and `ContentPlanDialog` (content planning); both are reused across the dashboard and the list pages so a record looks identical everywhere.
- **Completion is labelled and recoverable.** The action button reads **"Mark Completed"** (a verb), never the bare status word "Completed". Two safety models, by stakes:
  - **Customs (high-ticket):** completion is a **deliberate two-step** — open the detail dialog, then confirm — so a single stray tap can't vanish a card. A success `toast` offers **Undo**, which reverts the request to *Awaiting Approval* (`creator-complete` with `{ revert: true }`).
  - **Content planning (routine):** quick one-tap complete with an **Undo** `toast` that reverts to *Outstanding* (the content-planning `creator-complete` endpoint mirrors the campaign one's `revert` flag), so the card returns cleanly.
- **Lists, not carousels.** Outstanding items render as responsive grids / vertical lists (`repeat(auto-fit, …)` / stacked cards), so a creator sees everything at once — no horizontal paging.

### Portal rules (in addition to everything in §1–6)
1. **Import the skin from `theme.ts`.** No inline portal hexes, gradients, or surface recipes. New portal color → add it to `theme.ts` **and** the `creator-*` palette entries in this file's frontmatter.
2. **Bluu azure is the portal's one voice**, exactly as Action Blue is the console's. It marks brand/interactive accent only — never decoration beyond the one signature page glow.
3. **Solid fills only** — no gradient or glow buttons/cards. `PRIMARY_BTN` / `COMPLETE_BTN` / `ACCENT_BTN` are the three action treatments, and they are a hierarchy, not a palette: **`PRIMARY_BTN` appears at most once per screen** — the azure is only loud because it is rare. Anything else that merely *can* be clicked takes `ACCENT_BTN`. Its ink is a brand-tinted near-black by necessity, not taste: white on `ACCENT.hex` measures 2.3:1 and fails AA outright, the near-black reads 7.2:1. Never re-ink it white.
4. **Detail & confirm = shadcn `Dialog`** through `CreatorDialog`. No bespoke overlays.
5. **"Mark Completed", never "Completed"**, and every completion is undoable via the `revert` flag.

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
- **`AZURE_INK` on azure.** White on `#00b8f5` measures 2.3:1 and fails AA outright; the brand-tinted near-black reads 7.2:1. Never re-ink it white. (Same rule as the portal's `ACCENT_BTN`.)
- **The thank-you screen celebrates.** It reuses the onboarding completion vocabulary (`.onboard-seal` / `.onboard-tick` / `.onboard-rise`) plus a `.stage-bloom` and a single confetti burst. §5 says not to extend that vocabulary to other screens; the exception is deliberate and narrow — this is the *same beat* (a once-ever completion) on a *different surface*, and sharing the primitives keeps one motion language rather than inventing a second. It is not licence for a third celebration.

### Surface rules (in addition to §1–6)
1. **Import the skin from `_lib/theme.ts`.** New colour → add it there **and** to this section.
2. **One glow, one voice.** Azure marks brand/interactive accent only; the stage wash is the sole decorative use.
3. **Mobile is the design target**, not a breakpoint: 16px inputs, ≥44px touch targets, a sticky action bar with `env(safe-area-inset-bottom)`, one question group per scroll.
4. **Every field goes through `Field`**, which owns the label / hint / error association. Pass `group` when the control is a radio set or composite — a `<label for>` pointing at a group is invalid.

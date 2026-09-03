/**
 * Creator Portal design tokens — the "Deep Ink" skin.
 *
 * The creator portal is a Telegram Mini App read by an EXTERNAL creator, on a
 * phone, usually late, one-handed, to answer one question: *what do I owe, and
 * is anything late?* It is a deliberately different surface from the internal
 * "Quiet Instrument" console in DESIGN.md §1–6, and this module is its single
 * source of truth: import these tokens, never hardcode a portal colour, surface
 * recipe or badge map inline.
 *
 * ── What changed, and why ────────────────────────────────────────────────────
 * The portal used to be the console's neutral near-black with azure rationed to
 * a few marks. That made it read as the console with a different logo. The skin
 * is now **committed**: the ground is brand-tinted deep ink (not neutral black),
 * and the azure carries the *time axis* — a structure that runs the full height
 * of every screen — rather than a handful of accents.
 *
 * ── The one thing to understand before changing a colour ─────────────────────
 * Measured on this palette, `azure` against `ink2` is **1.14:1** and `late`
 * against `ink2` is **1.35:1**. Hue therefore CANNOT carry state here, on any
 * ground, ever. Every state cue in this portal is a **shape plus a hue** (a
 * filled node vs a hollow ring; a rail vs no rail; a runway measure). If you
 * find yourself distinguishing two states by colour alone, it is already broken
 * for a third of the people looking at it.
 *
 * See DESIGN.md § "Creator Portal (external skin)" for the full rationale.
 */

import type { CRStatus, CRPriority } from "@/lib/campaignTracking";

// ── Ground & ink ─────────────────────────────────────────────────────────────
/**
 * Derived from OKLCH at hue 250 with a low, deliberate chroma so the whole
 * surface is tinted toward the brand rather than being neutral grey. Contrast
 * against every ink below was measured, not estimated; the figures are in the
 * comments and in DESIGN.md §7.
 */
export const COLOR = {
  /** Page ground. oklch(0.145 0.020 250). */
  void: "#050b12",
  /** Header / nav / sidebar ground. oklch(0.180 0.022 250). */
  ground: "#0a121b",
  /** Panels and the reading plane. oklch(0.225 0.024 250). */
  surface: "#131d27",
  /** A row resting on a panel. oklch(0.275 0.026 250). */
  raised: "#1e2934",
  /** Every hairline. oklch(0.320 0.026 250). */
  line: "#293440",

  /** Primary text. 18.4:1 on void, 13.7:1 on raised. */
  ink: "#f4f7fa",
  /** The de-emphasis step for text. 9.9:1 on void, 7.4:1 on raised. */
  ink2: "#b1b8c0",
  /**
   * The third step. 5.4:1 on void / 5.2:1 on ground / 4.7:1 on surface — legal
   * body text on those three, but **4.1:1 on `raised`, where it fails AA**.
   * Use it for meta on the page ground; never inside a raised row.
   */
  ink3: "#80878e",

  /** Bluu azure, sampled from the company logo. The brand voice and "today". */
  azure: "#00b8f5",
  /** Logo shadow azure — borders and the pressed step. */
  azureDeep: "#0090c8",
  /** Azure ink for text sitting ON an azure *tint* (never on a fill). The tint
   *  is dark enough that the azure itself would read as a link on a link. */
  azureText: "#7ddcfb",
  /** The brighter step, for the hovered form of `azureText` and for an avatar
   *  fallback on an azure tint. */
  azureSoft: "#a5e8fc",
  /**
   * The ink that goes ON filled azure. Brand-tinted near-black by necessity,
   * not taste: white on `azure` measures **2.29:1** and fails AA outright,
   * this reads **7.20:1**. Never re-ink an azure fill white.
   */
  azureInk: "#04222e",
} as const;

// ── Urgency: the portal's one closed colour vocabulary ───────────────────────
/**
 * Four states, and colour is spent on nothing else. This replaces the old
 * portal's split personality where `text-rose-300` painted every due date
 * unconditionally *and* red separately meant "late" — red meaning two things in
 * one scroll (a documented DESIGN.md defect).
 *
 * `soon`, `later` and `undated` all resolve to the neutral step on purpose: a
 * thing that is not due yet is not a state worth spending a hue on.
 */
export type Urgency = "late" | "today" | "soon" | "later" | "undated";

export const URGENCY: Record<
  Urgency,
  { hex: string; label: string; /** Rank for sorting; lower is more urgent. */ rank: number }
> = {
  late: { hex: "#f9746d", label: "Overdue", rank: 0 },
  today: { hex: COLOR.azure, label: "Today", rank: 1 },
  soon: { hex: COLOR.ink2, label: "Soon", rank: 2 },
  later: { hex: COLOR.ink2, label: "Upcoming", rank: 3 },
  undated: { hex: COLOR.ink3, label: "No date", rank: 4 },
};

/** Completion. Only ever used for a thing that has just been, or is, done. */
export const DONE_HEX = "#4bc680";
/** Attention that is not lateness (a load failure). */
export const WARN_HEX = "#edb345";

// ── Surfaces ─────────────────────────────────────────────────────────────────
/**
 * Opaque fills, not translucent white overlays. The console stacks white at low
 * alpha because its ground is neutral; on a tinted ground that desaturates the
 * brand out of every panel, which is precisely how the old portal lost its
 * colour the moment anything sat on top of the page.
 */
export const SURFACE = {
  /** Base interior panel. */
  panel: "bg-[#131d27] border border-[#293440]",
  /** A row resting on a panel. */
  card: "bg-[#1e2934] border border-[#293440]",
  /** Hover / press for an interactive surface on the page ground. */
  cardHover: "hover:bg-[#1e2934] active:bg-[#293440]",
  /** Hover / press for an interactive surface already on a panel. */
  raisedHover: "hover:bg-[#293440] active:bg-[#31404e]",
  /** Dialog / popover. */
  overlay: "bg-[#131d27] border border-[#293440]",
} as const;

/** The page ground. One flat, brand-tinted ink — the glow that used to sit here
 *  is gone: the spine is the portal's signature now, and a radial wash behind a
 *  time axis just made the axis harder to read. */
export const PAGE_GROUND_STYLE = {
  backgroundColor: COLOR.void,
  color: COLOR.ink,
} as const;

/** The sticky top bar. Translucent + blur is the one glass construction in the
 *  portal and it is functional (content scrolls under it), not decoration. */
export const HEADER_STYLE = {
  background: "rgba(10,18,27,0.82)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  borderBottom: `1px solid ${COLOR.line}`,
} as const;

/** The mobile tab bar. Mirrors HEADER_STYLE so the two edges of the screen
 *  match; `env()` keeps the tabs clear of the iOS home indicator and resolves
 *  to 0 everywhere else. */
export const TABBAR_STYLE = {
  background: "rgba(10,18,27,0.92)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  borderTop: `1px solid ${COLOR.line}`,
  paddingBottom: "env(safe-area-inset-bottom)",
} as const;

// ── Actions ──────────────────────────────────────────────────────────────────
// Solid fills. No gradients, no glow shadows.

/**
 * The primary action — azure at full strength, for the ONE action that is the
 * reason a screen exists. At most once per screen; the azure is only loud
 * because it is rare. Ink is `azureInk` (7.20:1), never white (2.29:1).
 * Hexes are inlined because Tailwind only scans static class strings.
 */
export const PRIMARY_BTN =
  "bg-[#00b8f5] text-[#04222e] hover:bg-[#3fc9fb] active:bg-[#0090c8] " +
  "focus-visible:ring-[3px] focus-visible:ring-[#00b8f5]/40 motion-safe:active:scale-[0.98]";

/** The completion action. Filled `done` with the page ground as ink (9.11:1). */
export const COMPLETE_BTN =
  "bg-[#4bc680] text-[#050b12] hover:bg-[#6ad297] active:bg-[#3aa96a] " +
  "focus-visible:ring-[3px] focus-visible:ring-[#4bc680]/40 motion-safe:active:scale-[0.98]";

/** Anything else that can be pressed: open Drive, external links, retry. */
/* Literal hexes below are `COLOR.azure` / `azureText` / `azureSoft`; Tailwind
 * only scans static class strings, so a token reference would not compile to a
 * class. This file remains the only place they may appear. */
export const ACCENT_BTN =
  "bg-[#00b8f5]/12 text-[#7ddcfb] border border-[#00b8f5]/30 " +
  "hover:bg-[#00b8f5]/20 hover:text-[#a5e8fc] active:bg-[#00b8f5]/28 " +
  "focus-visible:ring-[3px] focus-visible:ring-[#00b8f5]/40";

/** A quiet, bordered action — used where two actions sit side by side and only
 *  one of them may be loud. */
export const QUIET_BTN =
  "bg-transparent text-[#b1b8c0] border border-[#293440] " +
  "hover:bg-[#1e2934] hover:text-[#f4f7fa] active:bg-[#293440] " +
  "focus-visible:ring-[3px] focus-visible:ring-[#00b8f5]/40";

/** The focus treatment for a full-width interactive row. Inset so the row's own
 *  rounding cannot clip it. */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00b8f5]";

// ── The spine ────────────────────────────────────────────────────────────────
/** Width of the time-axis column, and the offset of the rule inside it. Shared
 *  by every component that draws on the spine so nodes, rule and day markers
 *  cannot drift apart. */
export const SPINE = {
  /** Total width of the rail column. */
  colWidth: "2rem",
  /** Distance from the column's left edge to the centre of the rule. */
  centre: "1rem",
  /** Node diameter. */
  node: "0.625rem",
} as const;

// ── Content-type badge (content planning) ────────────────────────────────────
export type ContentType = "SFW" | "NSFW" | "OF TL" | "PPV" | "Dripfeed";

/**
 * Content types are a **closed vocabulary carried by the record**, not a state,
 * so they take the greyscale attribute-chip treatment rather than a hue. The
 * old map spent five saturated hues here (blue / orange / purple / pink / teal),
 * which put a rainbow next to an urgency system that needs its four colours to
 * mean something. One exception: NSFW is worth telling apart at a glance when
 * filming, so it takes a border rather than a colour.
 */
const CONTENT_TYPE_BADGE: Record<ContentType, string> = {
  SFW: "bg-[#1e2934] text-[#b1b8c0] border border-[#293440]",
  NSFW: "bg-[#1e2934] text-[#f4f7fa] border border-[#4a5764]",
  "OF TL": "bg-[#1e2934] text-[#b1b8c0] border border-[#293440]",
  PPV: "bg-[#1e2934] text-[#b1b8c0] border border-[#293440]",
  Dripfeed: "bg-[#1e2934] text-[#b1b8c0] border border-[#293440]",
};

const CONTENT_TYPE_FALLBACK = "bg-[#1e2934] text-[#b1b8c0] border border-[#293440]";

/** Badge classes for a content type, safe for unknown values. */
export function contentTypeBadge(type: string): string {
  return CONTENT_TYPE_BADGE[type as ContentType] ?? CONTENT_TYPE_FALLBACK;
}

// ── Custom-request type ──────────────────────────────────────────────────────
export type CustomType = "CR" | "Call" | "Item";

/**
 * The three custom types. `hex` is no longer an accent hue — the portal spends
 * colour on urgency only — so these carry a **glyph** instead, which is what
 * actually distinguishes them at a glance on a phone.
 */
export const TYPE_META: Record<
  CustomType,
  { label: string; plural: string; infoText?: string }
> = {
  CR: {
    label: "Custom",
    plural: "Customs",
    infoText:
      "Please upload content to your Google Drive folder using the CR code as the name. For multiple files, create a folder with the CR code as the name.",
  },
  Call: { label: "Call", plural: "Calls" },
  Item: { label: "Item", plural: "Items" },
};

// ── Priority ─────────────────────────────────────────────────────────────────
/**
 * Priority is a manager's note about importance, not a deadline, so it must not
 * compete with the urgency palette. It renders as a greyscale chip whose weight
 * carries the rank — High is the only one that gets ink at full strength.
 */
export const PRIORITY_CHIP: Record<CRPriority, string> = {
  High: "bg-[#293440] text-[#f4f7fa] border border-[#4a5764] font-semibold",
  Medium: "bg-[#1e2934] text-[#b1b8c0] border border-[#293440]",
  Low: "bg-[#1e2934] text-[#80878e] border border-[#293440]",
};

export type { CRStatus, CRPriority };

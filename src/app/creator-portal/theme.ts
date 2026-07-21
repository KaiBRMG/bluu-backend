/**
 * Creator Portal design tokens — the authored "Bluu azure" skin.
 *
 * The creator portal is a deliberately friendlier, brand-forward surface for
 * EXTERNAL creators, distinct from the internal "Quiet Instrument" console in
 * DESIGN.md. This module is its single source of truth: import these tokens,
 * never hardcode a portal color, gradient, or badge map inline.
 *
 * See DESIGN.md § "Creator Portal (external skin)" for the rationale and rules.
 */

import type { CRStatus } from "@/lib/campaignTracking";

// ── Brand accent ──────────────────────────────────────────────────────────────
// The Bluu brand azure is the portal's one brand voice (the console's is Action
// Blue). Sampled from the company logo (`public/logo/bluu-logo.png`); a bright
// cyan-azure that stays distinct from the console's royal Action Blue (#3b82f6).
export const ACCENT = {
  hex: "#00b8f5", // Bluu azure (logo) — ~Tailwind sky
  deep: "#0090c8", // logo shadow azure
} as const;

/** The portal's named category hues (section icons, type accents). Documented in
 *  DESIGN.md § Creator Portal — import these; never inline a hue. */
export const HUES = {
  sky: "#00b8f5", // brand azure
  blue: "#3b82f6",
  amber: "#f59e0b",
  emerald: "#10b981",
} as const;

/** The single subtle brand glow behind portal page grounds (documented signature,
 *  the portal's one decorative-color exception — like the console's backdrop-blur). */
export const PAGE_GROUND_STYLE = {
  backgroundColor: "#09090b",
  backgroundImage:
    "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(0,184,245,0.08), transparent)",
  color: "white",
} as const;

/** The shared sticky top-bar surface used by every portal page header — one
 *  translucent recipe with a hairline underline. Import it; never re-inline the
 *  header background per page (that drift is how the opacity fell out of sync). */
export const HEADER_STYLE = {
  background: "rgba(9,9,11,0.85)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
} as const;

// ── Surfaces (translucent white on the near-black ground; no drop shadows) ────
export const SURFACE = {
  /** Base interior panel. */
  panel: "bg-white/[0.025] border border-white/[0.07]",
  /** A card/row resting on a panel. */
  card: "bg-white/[0.03] border border-white/[0.06]",
  /** Hover state for interactive surfaces. */
  cardHover: "hover:bg-white/[0.055]",
  /** Dialog / popover surface. */
  overlay: "bg-[#111113] border border-white/10",
} as const;

// ── Actions ───────────────────────────────────────────────────────────────────
// Solid fills — no gradients, no glow shadows (see DESIGN.md § Creator Portal).
/** The one "mark complete" success action. A subtle tactile press marks the
 *  portal's key moment (completing a task); gated `motion-safe` so reduced-motion
 *  users get no scale. Smooth via the shadcn Button's own `transition-all`. */
export const COMPLETE_BTN =
  "bg-emerald-600 hover:bg-emerald-700 text-white motion-safe:active:scale-[0.98]";
/** Soft accent action (open drive, upload, external links styled as buttons). */
export const ACCENT_BTN =
  "bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 border border-sky-500/30";

// ── Content-type badge (content-planning) ─────────────────────────────────────
export type ContentType = "SFW" | "NSFW" | "OF TL" | "PPV" | "Dripfeed";

const CONTENT_TYPE_BADGE: Record<ContentType, string> = {
  SFW: "bg-blue-500/15 text-blue-300",
  NSFW: "bg-orange-500/15 text-orange-300",
  "OF TL": "bg-purple-500/15 text-purple-300",
  PPV: "bg-pink-500/15 text-pink-300",
  Dripfeed: "bg-teal-500/15 text-teal-300",
};

const CONTENT_TYPE_FALLBACK = "bg-zinc-500/15 text-zinc-300";

/** Badge classes for a content type, safe for unknown values. */
export function contentTypeBadge(type: string): string {
  return CONTENT_TYPE_BADGE[type as ContentType] ?? CONTENT_TYPE_FALLBACK;
}

// ── Custom-request type accent (customs / calls / items) ──────────────────────
export type CustomType = "CR" | "Call" | "Item";

export const TYPE_META: Record<
  CustomType,
  { label: string; hex: string; infoText?: string }
> = {
  CR: {
    label: "Customs",
    hex: ACCENT.hex,
    infoText:
      "Please upload content to your Google Drive folder using the CR code as the name. For multiple files, create a folder with the CR code as the name.",
  },
  Call: { label: "Calls", hex: "#3b82f6" },
  Item: { label: "Items", hex: "#f59e0b" },
};

// ── Status pill (content-planning: Outstanding / Completed) ────────────────────
export function contentStatusBadge(status: "Outstanding" | "Completed"): string {
  return status === "Completed"
    ? "bg-emerald-500/15 text-emerald-300"
    : "bg-red-500/15 text-red-300";
}

/** Re-export of the shared campaign status colors so pages import status hues
 *  from one place alongside the portal tokens. */
export { STATUS_COLORS as CAMPAIGN_STATUS_COLORS } from "@/lib/campaignTracking";
export type { CRStatus };

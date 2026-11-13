/**
 * Chart hues for the BuddyX surfaces — validated, not picked.
 *
 * Both sets were run through the `dataviz` validator against the dark card
 * (`--card` ≈ #18181b) on 2026-10-07 and pass all five checks: lightness band,
 * chroma floor, CVD separation (tips/PPV ΔE 25.4; subs/tips/messages worst
 * adjacent 9.4), the normal-vision floor, and 3:1 contrast. They are steps of
 * the existing `DONUT_COLORS` family, so a tip is the same green on every chart
 * in the app. Identity is never colour alone: every chart carries a legend and
 * its figures sit in an adjacent table or tile row (DESIGN.md §2, Charts).
 *
 * Order is fixed. Never cycle them, never extend them with a generated hue.
 */
export const SALE_KIND_COLORS = {
  tip: '#00a86f',
  ppv: '#4176f6',
} as const;

export const SOURCE_MIX_COLORS = {
  subs: '#cb7f00',
  tips: '#00a86f',
  messages: '#4176f6',
} as const;

/** Single-hue sequential mark (histograms, a lone series). */
export const SEQUENTIAL_COLOR = '#4176f6';

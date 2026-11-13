/**
 * The app's raised-surface recipe, in one place.
 *
 * Depth in this product is a translucent white overlay plus a hairline, never a
 * shadow (DESIGN.md §1). That is two values — `border-white/[0.07]` and
 * `bg-white/[0.025]` — and they were hand-typed at roughly two dozen call sites
 * across the salary and shift surfaces alone, which is how an overlay scale
 * quietly forks: the same "card" turning up at 0.02, 0.025 and 0.03 with nothing
 * saying which was meant.
 *
 * Radius and padding stay at the call site on purpose. A panel and a popover
 * header are the same *material* at different sizes, and a component that took
 * both as props would just be a div with a worse name.
 *
 *     <section className={cn('rounded-xl p-5', SURFACE)}>
 */

/** Overlay fill + hairline border: the standard raised panel. */
export const SURFACE = 'border border-white/[0.07] bg-white/[0.025]';

/**
 * A checked `Checkbox`, inked Action Blue Deep. shadcn's checked state paints
 * `--primary`, which renders near-white in this theme (DESIGN.md §2) — so a
 * checked box reads as "disabled" rather than "on". Selection is exactly what
 * Action Blue is for (the One Voice Rule), and the trailing `!` is needed to beat
 * the primitive's own same-specificity rule.
 */
export const SELECT_BOX_CLASS =
  'data-[state=checked]:bg-[#2563eb]! data-[state=checked]:border-[#2563eb]! data-[state=checked]:text-white!';

/** The hairline on its own — dividers, section rules, table heads. */
export const HAIRLINE = 'border-white/[0.07]';

/**
 * The interactive step for a surface that is itself a control (a card that is a
 * link). Hover and press deepen the same overlay rather than introducing a new
 * colour, and focus uses the app's ring so it matches every shadcn primitive.
 */
export const SURFACE_INTERACTIVE =
  'transition-colors duration-[120ms] hover:bg-white/[0.055] active:bg-white/[0.08] ' +
  'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50';

/**
 * A selected `ToggleGroupItem`, inked Action Blue Deep — shadcn's `outline`
 * variant paints hover and selected identically, so a selected segment would be
 * indistinguishable from a hovered one. The trailing `!` beats the primitive's
 * own same-specificity `data-[state=on]` rule regardless of stylesheet order.
 * (Moved here from Growth Tracking; see DESIGN.md, Buttons.)
 */
export const SEGMENT_ITEM_CLASS =
  'text-xs data-[state=on]:bg-[#2563eb]! data-[state=on]:font-medium data-[state=on]:text-white!';

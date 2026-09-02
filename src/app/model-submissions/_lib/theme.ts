/**
 * The public application form's skin — "the stage".
 *
 * A third Bluu surface, alongside the internal console (DESIGN.md §1–6) and the
 * creator portal (§7). It shares their ground and their one-voice discipline —
 * near-black, Bluu azure as the single accent, hairline borders, no drop
 * shadows — but is louder in scale because it is a brand surface read once, on
 * a phone, by someone deciding whether to trust us.
 *
 * Import these tokens; never inline a hex on this surface.
 */

/** Bluu azure, sampled from the logo. Same voice as the creator portal. */
export const AZURE = '#00b8f5';
export const AZURE_DEEP = '#0090c8';
/**
 * Ink for anything sitting ON azure. White on `AZURE` measures 2.3:1 and fails
 * AA outright; this brand-tinted near-black reads 7.2:1. Never re-ink it white.
 */
export const AZURE_INK = '#04141c';

/**
 * The one decorative-colour exception on this surface: a single stage-light
 * wash falling from above. The console's analogue is its backdrop blur; the
 * portal's is its page glow. Do not add a second.
 */
export const STAGE_GROUND = {
  backgroundColor: '#08090b',
  backgroundImage:
    'radial-gradient(ellipse 110% 55% at 50% -10%, rgba(0,184,245,0.16), transparent 70%)',
} as const;

/** Interior surface recipe — translucent white on the dark ground. */
export const PANEL = 'border border-white/[0.08] bg-white/[0.025]';

/**
 * Field chrome. 16px text is deliberate, not a rounding error: anything smaller
 * makes iOS Safari zoom the viewport on focus and the applicant loses their
 * place in the form.
 */
export const FIELD =
  'w-full rounded-xl border border-white/[0.10] bg-white/[0.04] px-4 py-3 text-base text-white ' +
  'placeholder:text-white/50 transition-colors outline-none ' +
  'focus-visible:border-[#00b8f5] focus-visible:ring-2 focus-visible:ring-[#00b8f5]/25 ' +
  'aria-[invalid=true]:border-red-400/70';

/**
 * A `Select`'s dropdown on this surface.
 *
 * shadcn's `SelectContent`/`SelectItem` are sized for the **console** — 14px
 * rows about 30px tall — which is wrong twice over here: this form is 16px
 * throughout (see `FIELD`), and a 30px row is well under the 44px touch target
 * a phone needs. `FIELD_MENU_ITEM` puts a row at 44px and its text at 16px.
 *
 * `FIELD_MENU` also fixes the width. In `popper` mode the panel inherits
 * `min-width` from its trigger, so a narrow trigger — the dial-code picker is
 * 7.5rem — yields a 120px menu with every country name truncated. This gives it
 * a readable width that still fits a 320px viewport.
 */
export const FIELD_MENU =
  'max-h-[min(20rem,60vh)] w-[min(22rem,calc(100vw-2.5rem))] rounded-xl';

export const FIELD_MENU_ITEM = 'rounded-lg py-2.5 pr-9 pl-3 text-base';

/**
 * The front door's skin — "three doors".
 *
 * The fifth Bluu surface: what a browser sees at the bare domain, and at every
 * internal route it is not allowed into (`src/middleware.ts` rewrites them all
 * here). Three readers arrive and none of them outranks the others — a creator
 * looking for their portal, someone who wants to become one, and a member of
 * staff in the wrong window — so the page is a directory of three equal doors,
 * not a pitch with a hero action. A fourth door, last, is the way out to the
 * company site for anyone who is none of the three.
 *
 * It is a brand surface read by strangers, so it stands on the public ground and
 * borrows §8’s stage wash rather than inventing a new glow (DESIGN.md §10).
 * What it adds is the door row below.
 *
 * Import these tokens; never inline a hex on this surface.
 */

export { STAGE_GROUND } from '@/app/model-submissions/_lib/theme';

/**
 * Text selection: azure with `AZURE_INK`, the same pairing as any azure fill
 * (white on azure fails AA). Matches `/download` and `/update`.
 */
export const SELECTION = 'selection:bg-[#00b8f5] selection:text-[#04141c]';

/**
 * One door — the whole row is the link.
 *
 * A row rather than a button because the reader is choosing *who they are*, and
 * the question is the label; a 44px button under it would be a second target for
 * the same decision. On a phone the full row is the hit area.
 *
 * No door is filled: with three equal audiences, a filled azure on one of them
 * would tell the other two they came to the wrong place. Azure is spent on the
 * glyph tile and the action line instead — the same voice, three times, at the
 * same weight.
 */
export const DOOR =
  'group/door flex items-start gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 sm:p-6 ' +
  'transition-colors duration-150 hover:border-white/[0.14] hover:bg-white/[0.05] active:bg-white/[0.07] ' +
  '[-webkit-tap-highlight-color:transparent] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b8f5]/50 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-[#08090b]';

/** The glyph tile that opens each door. Azure on a `/10` azure tint. */
export const DOOR_GLYPH =
  'flex size-11 flex-none items-center justify-center rounded-xl bg-[#00b8f5]/10 text-[#00b8f5] ' +
  'transition-colors duration-150 group-hover/door:bg-[#00b8f5]/15';

/**
 * The action line under each door's copy. Azure lettering on the ground reads
 * well clear of AA; the arrow nudges on hover so the row answers the pointer
 * without a second colour.
 */
export const DOOR_ACTION =
  'mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#00b8f5]';
export const DOOR_ARROW =
  'size-4 transition-transform duration-150 motion-safe:group-hover/door:translate-x-0.5';
/** An off-site door's arrow points out of the page, so it moves that way too. */
export const DOOR_ARROW_OUT =
  'size-4 transition-transform duration-150 ' +
  'motion-safe:group-hover/door:translate-x-0.5 motion-safe:group-hover/door:-translate-y-0.5';

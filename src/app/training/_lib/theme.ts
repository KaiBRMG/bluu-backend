/**
 * The training surface's skin — DESIGN.md §11.
 *
 * It adds almost nothing. The ground, the azure voice, the panel recipe and the
 * 16px field all come from the public stage (§8), imported from where that skin
 * lives; the only new things are the clock's urgency states, because "time is
 * nearly up" is the one meaning this surface has that no other public page does.
 *
 * Import these; never inline a hex here.
 */
export { AZURE, AZURE_DEEP, AZURE_INK, PANEL, STAGE_GROUND, FIELD } from '@/app/model-submissions/_lib/theme';

/**
 * Azure as class recipes. Tailwind reads class strings statically, so a variable
 * cannot go inside `ring-[…]` or `bg-[…]`; the literal lives here, once, and the
 * components import the recipe. `AZURE` itself is the same value as an inline style.
 *
 * Azure is also the text colour on its own tint (8.7:1 on `#08090b`) — there is no
 * lighter "azure text" shade on this surface.
 */
/** The keyboard-focus ring on anything interactive. */
export const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-[#00b8f5]/70';
/** A selected or live chip: azure edge, /10 tint, azure text. */
export const AZURE_CHIP = 'border-[#00b8f5]/50 bg-[#00b8f5]/10 text-[#00b8f5]';
/** A chip that is a button: the selected look, and a firmer tint on hover. */
export const AZURE_CHIP_BUTTON = `${AZURE_CHIP} hover:bg-[#00b8f5]/20`;
/** An azure edge and /10 tint with no text colour (selection, drop target). */
export const AZURE_EDGE = 'border-[#00b8f5] bg-[#00b8f5]/10';
export const AZURE_EDGE_SOFT = 'border-[#00b8f5]/50';
export const AZURE_TEXT = 'text-[#00b8f5]';
/** A `Progress` fill. */
export const PROGRESS_AZURE = '[&>div]:bg-[#00b8f5]';
/** The browser's own selection colour, caret, and form-control/scrollbar scheme (autofill, the screen preview's chrome). */
export const BROWSER_SURFACE = 'selection:bg-[#00b8f5]/35 [caret-color:#00b8f5] [color-scheme:dark]';
/** A checked checkbox: azure fill, `AZURE_INK` tick. */
export const CHECKBOX_AZURE =
  'data-[state=checked]:border-[#00b8f5] data-[state=checked]:bg-[#00b8f5] data-[state=checked]:text-[#04141c]';
/** The 44px download button laid over a corner of an image: the stage ground at 90%, a hairline, no shadow. */
export const OVERLAY_BUTTON =
  'absolute top-2 right-2 grid size-11 place-items-center rounded-lg border border-white/20 bg-[#08090b]/90 text-white hover:bg-black';
/** A dialog or sheet panel (§11): the dark panel, hairline edge, and no shadow — §8 allows none. */
export const DIALOG_PANEL = 'border-white/10 bg-[#0d1014] text-white shadow-none';

export type ClockPhase = 'calm' | 'notice' | 'warn' | 'last' | 'over';

/**
 * Clock phases by remaining time. Colour is never the only signal: every phase
 * also changes the words under the numerals, and `warn`/`last` change the
 * border weight. Text colours are measured on `#08090b`: amber-200 ≈ 15.4:1,
 * red-300 ≈ 9.7:1, white 19.5:1.
 */
export const CLOCK_PHASE: Record<ClockPhase, { box: string; digits: string; label: string }> = {
  calm: { box: 'border-white/[0.10]', digits: 'text-white', label: 'Time left' },
  notice: { box: 'border-white/30', digits: 'text-white', label: 'Under 10 minutes left' },
  warn: { box: 'border-amber-300/70 border-2', digits: 'text-amber-200', label: 'Under 5 minutes left' },
  last: { box: 'border-red-400/80 border-2', digits: 'text-red-300', label: 'Last minute' },
  over: { box: 'border-red-400/80 border-2', digits: 'text-red-300', label: "Time's up" },
};

export function phaseFor(remainingMs: number): ClockPhase {
  if (remainingMs <= 0) return 'over';
  if (remainingMs <= 60_000) return 'last';
  if (remainingMs <= 5 * 60_000) return 'warn';
  if (remainingMs <= 10 * 60_000) return 'notice';
  return 'calm';
}

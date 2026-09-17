/**
 * The installer page's skin — "the lit bench".
 *
 * The fourth Bluu surface, alongside the internal console (DESIGN.md §1–6), the
 * creator portal (§7) and the public application form (§8). It shares the
 * public ground, the azure one-voice discipline and the panel recipe with §8 —
 * see `src/lib/publicSkin.ts`, which both import — and differs in two ways that
 * follow from the job:
 *
 * ▸ **It is a task surface, not a brand surface.** Someone is here to get a
 *   file onto a machine, usually the machine in front of them, usually at a
 *   desk. So the type scale sits between the console's and the form's, the
 *   measure is wider, and nothing animates on arrival.
 *
 * ▸ **The one decorative moment is placed, not ambient.** §8's stage light
 *   falls from the top of the page onto a masthead; here the glow sits *behind
 *   the install panel*, because the panel is the reason the page exists. One
 *   wash, same as every other surface gets exactly one.
 *
 * Import these tokens; never inline a hex on this surface.
 */

import { AZURE, AZURE_INK } from '@/lib/publicSkin';

export { AZURE, AZURE_DEEP, AZURE_INK, PANEL } from '@/lib/publicSkin';

/**
 * The ground: near-black with a single azure wash centred on the install panel
 * rather than on the masthead. `26%` down the viewport is where the panel's
 * upper edge lands at desktop widths; at `0.13` the composite still reads
 * 5.2:1 against the dimmest text on it (`text-white/55`).
 */
export const BENCH_GROUND = {
  backgroundColor: '#08090b',
  backgroundImage:
    'radial-gradient(ellipse 85% 42% at 50% 24%, rgba(0,184,245,0.13), transparent 72%)',
  backgroundRepeat: 'no-repeat',
} as const;

/**
 * One platform choice.
 *
 * Built on shadcn's `TabsTrigger`, which ships a centred, single-line, fixed-
 * height pill and a `dark:data-[state=active]:` rule of its own. Every override
 * below carries `!` deliberately: the primitive's own rules are `.dark .x`
 * (specificity 0,2,0) and would otherwise win against these.
 *
 * The selected state is carried by **three** signals — border, fill and the
 * azure label — so it never depends on hue alone (WCAG 1.4.11), and it is
 * unmistakable next to the hover step.
 */
export const OPTION =
  'group/opt relative flex h-auto! w-full flex-col items-start justify-start gap-0.5 ' +
  'rounded-xl border border-white/[0.08] bg-white/[0.025] px-4 py-3.5 text-left whitespace-normal ' +
  'transition-colors duration-150 hover:bg-white/[0.055] ' +
  'data-[state=active]:border-[#00b8f5]/55! data-[state=active]:bg-[#00b8f5]/[0.10]! ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b8f5]/50 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-[#08090b]';

/** The primary action. 48px tall and 16px — this is a phone target too. */
export const PRIMARY_BTN =
  'h-12 w-full self-start rounded-xl px-6 text-base font-semibold shadow-none ' +
  'transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.99] sm:w-auto ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b8f5]/50 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-[#08090b]';

/** Inline fill for `PRIMARY_BTN` — the one place azure carries ink. */
export const PRIMARY_BTN_STYLE = { background: AZURE, color: AZURE_INK } as const;

/**
 * The same button, unfilled — a real action that is not *this* step's action.
 * On Windows the two download buttons are both live from the first paint; which
 * one is filled is the whole instruction, so the other has to stay legible
 * rather than disabled. Azure-lettered on the bare ground.
 */
export const STEP_BTN_QUIET =
  'h-12 w-full self-start rounded-xl border border-[#00b8f5]/35 bg-transparent px-6 text-base font-semibold ' +
  'text-[#00b8f5] shadow-none transition-colors duration-150 hover:bg-[#00b8f5]/10 sm:w-auto ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b8f5]/50 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-[#08090b]';

/**
 * The version rider inside a download button. Measured, not eyeballed: on the
 * azure fill `AZURE_INK` at 75% reads 5.1:1, and on the unfilled button azure at
 * 80% reads 4.6:1 — both clear AA for this size.
 */
export const BTN_VERSION = 'font-medium opacity-75 tabular-nums';

/** One step in the Windows sequence. The number is the instruction, so it leads. */
export const STEP_MARK =
  'flex size-7 flex-none items-center justify-center rounded-full text-[13px] font-semibold tabular-nums';
export const STEP_MARK_CURRENT = 'bg-[#00b8f5] text-[#04141c]';
export const STEP_MARK_DONE = 'bg-[#00b8f5]/15 text-[#00b8f5]';
export const STEP_MARK_UPCOMING = 'bg-white/[0.08] text-white/55';

/** The secondary action — outlined, azure-lettered, same height class family. */
export const SECONDARY_BTN =
  'h-11 w-fit rounded-xl border-[#00b8f5]/40 bg-transparent px-5 text-sm font-semibold shadow-none ' +
  'text-[#00b8f5] transition-colors duration-150 hover:bg-[#00b8f5]/10 hover:text-[#00b8f5] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b8f5]/50 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-[#08090b]';

/**
 * A literal on-screen label the reader has to find and click in Windows' own
 * dialogs. Greyscale on purpose — it quotes an interface, it does not encode a
 * state (DESIGN.md §5, Attribute chip).
 */
export const UI_CHIP =
  'rounded bg-white/[0.07] px-1.5 py-0.5 text-[13px] font-medium whitespace-nowrap text-white/90';

/** A filename or path the reader has to recognise on disk. */
export const FILE_CHIP =
  'rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[12.5px] font-medium whitespace-nowrap text-white/90';

/** An inline azure link inside running text. */
export const INLINE_LINK =
  'font-medium text-[#00b8f5] underline underline-offset-[3px] decoration-[#00b8f5]/40 ' +
  'transition-colors hover:decoration-[#00b8f5] focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-[#00b8f5]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090b] rounded-sm';

/** A muted link in the footer rail. */
export const FOOTER_LINK =
  'rounded-sm underline underline-offset-[3px] decoration-white/25 transition-colors ' +
  'hover:text-white hover:decoration-white/60 focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-[#00b8f5]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090b]';

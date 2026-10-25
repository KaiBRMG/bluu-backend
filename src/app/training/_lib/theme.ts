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

'use client';

import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconNote, IconX } from '@tabler/icons-react';
import { ArrowLeft } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import {
  LIMITS_INTRO,
  LIMIT_EXTRA_KEY,
  LIMIT_ITEMS,
  limitKey,
  limitNoteKey,
  limitTally,
  type Answers,
} from '@/lib/creatorOnboarding';
import { cn } from '@/lib/utils';
import { AZURE, AZURE_INK, FIELD, PANEL } from '@/app/model-submissions/_lib/theme';

interface LimitsDeckProps {
  answers: Answers;
  onChange: (id: string, value: string) => void;
  /** Deck position: 0..LIMIT_ITEMS.length-1 are cards, LIMIT_ITEMS.length is the wrap-up. */
  position: number;
  onPosition: (next: number) => void;
}

/**
 * Part II as a deck, not a 25-row table.
 *
 * The source form was a Y/N grid with a notes column — the single most tedious
 * block of the old onboarding. Here each kind of content is one card with two
 * large answers; tapping one records it and moves on, so the whole part is 25
 * taps. `Y` / `N` answer from the keyboard and `←` steps back. A note is one tap
 * away on every card but never in the way.
 *
 * The tally rail under the card is the progress bar AND the navigation: one
 * tick per item, filled by answer (azure = yes, white = no, hollow = not yet),
 * and any tick jumps straight to its card — which is how someone changes their
 * mind about item 4 from item 20 without paging back.
 */
export function LimitsDeck({ answers, onChange, position, onPosition }: LimitsDeckProps) {
  const [noteOpen, setNoteOpen] = useState(false);
  const advanceTimer = useRef<number | null>(null);
  const onWrapUp = position >= LIMIT_ITEMS.length;
  const item = LIMIT_ITEMS[Math.min(position, LIMIT_ITEMS.length - 1)];
  const answer = answers[limitKey(item.id)] ?? '';
  const note = answers[limitNoteKey(item.id)] ?? '';

  const { yes: yesCount, no: noCount, open: openCount } = limitTally(answers);

  const go = (next: number) => {
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    setNoteOpen(false);
    onPosition(Math.max(0, Math.min(LIMIT_ITEMS.length, next)));
  };

  const choose = (v: 'Yes' | 'No') => {
    onChange(limitKey(item.id), v);
    // A beat to see the choice land, then the next card — unless a note is
    // open, in which case they are clearly not done with this one.
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    if (!noteOpen) advanceTimer.current = window.setTimeout(() => go(position + 1), 220);
  };

  // Keyboard: Y / N answer, ← back, → forward (only past answered cards).
  useEffect(() => {
    if (onWrapUp) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'y') choose('Yes');
      else if (k === 'n') choose('No');
      else if (e.key === 'ArrowLeft') go(position - 1);
      else if (e.key === 'ArrowRight' && answer) go(position + 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(
    () => () => {
      if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    },
    [],
  );

  const rail = (
    <div className="flex flex-col gap-2">
      <div className="flex gap-[3px]" role="group" aria-label="Your answers so far — pick one to change it">
        {LIMIT_ITEMS.map((it, i) => {
          const a = answers[limitKey(it.id)];
          const current = !onWrapUp && i === position;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => go(i)}
              aria-label={`${it.label}${it.detail ? `, ${it.detail}` : ''}: ${a ?? 'not answered'}`}
              aria-current={current ? 'step' : undefined}
              className="group relative h-6 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-[#00b8f5]/50"
            >
              <span
                className={cn(
                  'absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full transition-all duration-150',
                  current ? 'h-2.5' : 'h-1.5',
                )}
                style={{
                  backgroundColor: a === 'Yes' ? AZURE : a === 'No' ? 'rgba(255,255,255,0.55)' : 'transparent',
                  boxShadow: a ? undefined : 'inset 0 0 0 1px rgba(255,255,255,0.22)',
                  outline: current ? '2px solid rgba(255,255,255,0.9)' : undefined,
                  outlineOffset: current ? 2 : undefined,
                }}
              />
            </button>
          );
        })}
      </div>
      <p className="flex items-center gap-3 text-xs text-white/60 tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full" style={{ backgroundColor: AZURE }} aria-hidden />
          {yesCount} yes
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-white/55" aria-hidden />
          {noCount} no
        </span>
        <span className="ml-auto">{openCount} to go</span>
      </p>
    </div>
  );

  if (onWrapUp) {
    return (
      <div className="flex flex-col gap-8">
        {rail}
        <div className="flex flex-col gap-2">
          <label htmlFor="lim-extra" className="text-sm font-medium text-white">
            Any other kinks or content you’re happy to create?{' '}
            <span className="ml-1 font-normal text-white/60">Optional</span>
          </label>
          <p className="text-sm leading-snug text-white/60">Anything the list above didn’t cover.</p>
          <Textarea
            id="lim-extra"
            rows={4}
            maxLength={1500}
            className={cn(FIELD, 'min-h-28 resize-y')}
            value={answers[LIMIT_EXTRA_KEY] ?? ''}
            onChange={(e) => onChange(LIMIT_EXTRA_KEY, e.target.value)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-7">
      {position === 0 && !answer && (
        <p className="max-w-[60ch] text-[15px] leading-relaxed text-white/70">{LIMITS_INTRO}</p>
      )}

      {rail}

      <section
        key={item.id}
        aria-live="polite"
        className={cn(PANEL, 'flex flex-col gap-6 rounded-2xl p-5 sm:p-7')}
      >
        {/* Only once there is somewhere to go back to — an empty row here
            would pad the first card's top. */}
        {position > 0 && (
          <div className="-mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => go(position - 1)}
              className="-my-2 inline-flex min-h-11 items-center gap-1.5 text-sm text-white/60 transition-colors hover:text-white"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Previous
            </button>
          </div>
        )}

        <div>
          <h2 className="text-[1.65rem] leading-tight font-semibold tracking-[-0.02em] text-balance sm:text-3xl">
            {item.label}
          </h2>
          {item.detail && <p className="mt-1.5 text-base text-white/65">{item.detail}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={`${item.label}${item.detail ? `, ${item.detail}` : ''}`}>
          {(['Yes', 'No'] as const).map((v) => {
            const on = answer === v;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => choose(v)}
                className={cn(
                  'flex h-16 items-center justify-center gap-2 rounded-xl border text-lg font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#00b8f5]/50',
                  on
                    ? v === 'Yes'
                      ? 'border-transparent'
                      : 'border-white/70 bg-white/[0.14] text-white'
                    : 'border-white/[0.12] bg-white/[0.03] text-white/85 hover:bg-white/[0.07]',
                )}
                style={on && v === 'Yes' ? { backgroundColor: AZURE, color: AZURE_INK } : undefined}
              >
                {v === 'Yes' ? <IconCheck className="size-5" aria-hidden /> : <IconX className="size-5" aria-hidden />}
                {v}
                <kbd className="ml-1 hidden rounded border border-current/30 px-1.5 text-[11px] font-medium opacity-60 sm:inline">
                  {v[0]}
                </kbd>
              </button>
            );
          })}
        </div>

        {noteOpen || note ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`note-${item.id}`} className="text-xs font-medium text-white/60">
              Note for the chat team
            </label>
            <input
              id={`note-${item.id}`}
              autoFocus={noteOpen && !note}
              maxLength={300}
              placeholder="e.g. only with a mask on, only clean, extra cost…"
              className={FIELD}
              value={note}
              onChange={(e) => onChange(limitNoteKey(item.id), e.target.value)}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            className="-my-2 inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium text-white/65 transition-colors hover:text-white"
          >
            <IconNote className="size-4" aria-hidden />
            Add a note
          </button>
        )}
      </section>
    </div>
  );
}

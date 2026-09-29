'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconAlertTriangle, IconCloudCheck, IconCloudOff, IconLock, IconRefresh } from '@tabler/icons-react';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  CHAPTERS,
  LIMIT_ITEMS,
  PERSONA_INTRO,
  chapterProgress,
  TOTAL_MINUTES,
  completionErrors,
  isVisible,
  limitKey,
  stripAt,
  locate,
  progressOf,
  screenErrors,
  screensFor,
} from '@/lib/creatorOnboarding';
import { cn } from '@/lib/utils';
import type { PublicOnboarding } from '@/types/creatorOnboarding';
import { AZURE, AZURE_INK } from '@/app/model-submissions/_lib/theme';
import { useAutosave, type SaveState } from '../_lib/useAutosave';
import { Done } from './Done';
import { LimitsDeck } from './LimitsDeck';
import { Pass } from './Pass';
import { PersonaCard, PersonaStrip } from './PersonaCard';
import { QuestionField } from './QuestionField';
import { Review } from './Review';
import { Welcome } from './Welcome';

type Phase = 'welcome' | 'form' | 'review' | 'done';

const LIMITS = CHAPTERS.findIndex((c) => c.id === 'limits');
const PERSONA = CHAPTERS.findIndex((c) => c.id === 'persona');

/**
 * The whole personal onboarding experience, one client component deep.
 *
 * The form is long (≈50 questions on the OnlyFans track) and the design's job
 * is to stop it FEELING long. Four devices do that, in order of effect:
 *
 *   1. **Three sets, not one scroll.** "You · Your limits · Your persona", each
 *      with an honest time estimate, shown as a setlist on the welcome and as a
 *      strip at the top of every screen. Nobody is ever looking at question 34
 *      of 50 — they are on screen 3 of set 1.
 *   2. **Small screens.** 2–7 related questions per screen, one heading each.
 *   3. **A different shape per set.** Set 2 is a tap-through deck (25 taps),
 *      set 3 builds a live persona card as it is answered.
 *   4. **Set breaks.** Finishing a set gets its own beat — "that's You done;
 *      next is 3 minutes" — a milestone rather than a page turn.
 *
 * Navigation state is `{ chapter, screen }`, mirrored to the server as the
 * resume cursor. In a question set, `screen === screens.length` is that set's
 * break; in the limits set, `screen` is the deck position.
 */
export function OnboardingApp({ token, initial }: { token: string; initial: PublicOnboarding }) {
  const { track } = initial;
  const firstName = initial.name.trim().split(/\s+/)[0] || initial.name;
  const { answers, setAnswer, setCursor, state, pendingSnapshot, markSubmitted } = useAutosave(
    token,
    initial.answers,
    initial.cursor,
  );

  const chapters = useMemo(
    () => CHAPTERS.map((c) => ({ ...c, screens: screensFor(c, track) })),
    [track],
  );

  const [phase, setPhase] = useState<Phase>(initial.status === 'completed' ? 'done' : 'welcome');
  const [chapter, setChapter] = useState(() => Math.min(initial.cursor?.chapter ?? 0, chapters.length - 1));
  const [screen, setScreen] = useState(() => initial.cursor?.screen ?? 0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [completedAt, setCompletedAt] = useState<string | null>(initial.completedAt);
  const [justCompleted, setJustCompleted] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // One pass per change of answers, not several per render.
  const { progress, missing, chapterStats } = useMemo(
    () => ({
      progress: progressOf(track, answers),
      missing: Object.keys(completionErrors(track, answers)).length,
      chapterStats: chapters.map((c) => chapterProgress(c, answers)),
    }),
    [track, answers, chapters],
  );
  const current = chapters[chapter];
  const isDeck = chapter === LIMITS;
  const onBreak = !isDeck && screen >= current.screens.length;
  const currentScreen = !isDeck && !onBreak ? current.screens[screen] : null;

  const focusTop = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'auto' });
      headingRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const moveTo = useCallback(
    (c: number, s: number) => {
      setErrors({});
      setSubmitError(null);
      setChapter(c);
      setScreen(s);
      setCursor({ chapter: c, screen: s });
      focusTop();
    },
    [focusTop, setCursor],
  );

  // "A real browser opened this link." An empty autosave stamps `openedAt`
  // once server-side. Sent from here, not from the server render, because mail
  // scanners pre-fetch links and would otherwise mark everyone "opened".
  useEffect(() => {
    if (initial.status !== 'invited') return;
    void fetch(`/api/join/${token}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: {} }),
    }).catch(() => {});
  }, [initial.status, token]);

  // A different tab submitted the form: stop editing here, show the ending.
  useEffect(() => {
    if (state === 'locked') setPhase('done');
  }, [state]);

  const onChange = useCallback(
    (id: string, value: string) => {
      setAnswer(id, value);
      setErrors((prev) => (prev[id] ? { ...prev, [id]: '' } : prev));
    },
    [setAnswer],
  );

  const next = () => {
    if (currentScreen) {
      const errs = screenErrors(currentScreen, answers);
      if (Object.keys(errs).length > 0) {
        setErrors(errs);
        // Land on the first problem rather than leaving them to hunt for it.
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
        });
        return;
      }
    }
    if (isDeck && screen < LIMIT_ITEMS.length) {
      if (!answers[limitKey(LIMIT_ITEMS[screen].id)]) {
        setErrors({ deck: 'Choose yes or no to carry on.' });
        return;
      }
      moveTo(chapter, screen + 1);
      return;
    }
    // Past the last screen of a question set is its break; past a break (or
    // the deck's wrap-up) is the next set — or the review after the last one.
    const atEnd = isDeck ? screen >= LIMIT_ITEMS.length : onBreak;
    if (!atEnd) {
      moveTo(chapter, screen + 1);
      return;
    }
    if (chapter + 1 < chapters.length) moveTo(chapter + 1, 0);
    else {
      setPhase('review');
      setCursor({ chapter: chapters.length, screen: 0 });
      focusTop();
    }
  };

  const back = () => {
    if (screen > 0) return moveTo(chapter, screen - 1);
    if (chapter > 0) {
      const prev = chapter - 1;
      return moveTo(prev, prev === LIMITS ? LIMIT_ITEMS.length : chapters[prev].screens.length);
    }
    setPhase('welcome');
    focusTop();
  };

  const begin = () => {
    const c = initial.cursor;
    if (c && c.chapter >= chapters.length) {
      setPhase('review');
    } else {
      setPhase('form');
      moveTo(chapter, screen);
    }
    focusTop();
  };

  const submit = async () => {
    const errs = completionErrors(track, answers);
    const firstMissing = Object.keys(errs)[0];
    if (firstMissing) {
      const at = locate(track, firstMissing);
      setPhase('form');
      if (at) moveTo(at.chapter, at.screen);
      setErrors(errs);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      // No flush first: /complete folds in every unacknowledged key itself.
      const res = await fetch(`/api/join/${token}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: pendingSnapshot() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        markSubmitted();
        setPhase('done');
        return;
      }
      if (!res.ok) {
        if (data.fields) setErrors(data.fields);
        throw new Error(data.error || 'Could not submit. Please try again.');
      }
      markSubmitted();
      setCompletedAt(new Date().toISOString());
      setJustCompleted(true);
      setPhase('done');
      focusTop();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Phases ────────────────────────────────────────────────────────────────

  if (phase === 'done') {
    return (
      <Done
        firstName={firstName}
        name={initial.name}
        passNo={initial.passNo}
        issuedAt={initial.approvedAt}
        completedAt={completedAt}
        telegram={stripAt(answers.telegram ?? '')}
        celebrate={justCompleted}
      />
    );
  }

  if (phase === 'welcome') {
    return (
      <Welcome
        name={initial.name}
        firstName={firstName}
        passNo={initial.passNo}
        issuedAt={initial.approvedAt}
        chapters={chapters}
        chapterStats={chapterStats}
        // `started` is stamped by the first save — opening the link alone is not a visit.
        returning={initial.status === 'started'}
        ratio={progress.ratio}
        totalMinutes={TOTAL_MINUTES}
        onBegin={begin}
      />
    );
  }

  const chapterStrip = (
    <nav aria-label="Onboarding sets" className="grid grid-cols-3 gap-2">
      {chapters.map((c, i) => {
        const p = chapterStats[i];
        const isCurrent = phase === 'form' && i === chapter;
        const fill = p.total ? p.done / p.total : 0;
        const reachable = p.done > 0 || i <= chapter || phase === 'review';
        return (
          <button
            key={c.id}
            type="button"
            disabled={!reachable}
            aria-current={isCurrent ? 'step' : undefined}
            onClick={() => {
              setPhase('form');
              moveTo(i, 0);
            }}
            className="group flex min-h-11 flex-col justify-end gap-1.5 text-left outline-none disabled:cursor-default focus-visible:ring-2 focus-visible:ring-[#00b8f5]/40 rounded-md"
          >
            <span
              className={cn(
                'text-xs transition-colors',
                isCurrent ? 'font-semibold text-white' : 'font-medium text-white/60 group-enabled:group-hover:text-white/85',
              )}
            >
              {c.title}
              {p.complete && <span className="sr-only"> (complete)</span>}
            </span>
            <span className="relative h-1 overflow-hidden rounded-full bg-white/[0.12]">
              <span
                className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out"
                style={{ width: `${Math.round(fill * 100)}%`, backgroundColor: AZURE }}
              />
            </span>
          </button>
        );
      })}
    </nav>
  );

  const header = (
    <header className="flex flex-col gap-5 pt-6 pb-8 sm:pt-9">
      <div className="flex items-center justify-between gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo/HQ2.webp" alt="Bluu Rock" width={1374} height={868} className="h-8 w-auto" />
        <SaveIndicator state={state} />
      </div>
      {chapterStrip}
    </header>
  );

  // ── Review ────────────────────────────────────────────────────────────────

  if (phase === 'review') {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 sm:px-8">
        {header}
        <div className="flex flex-1 flex-col pb-44">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="onboard-rise text-3xl leading-[1.12] font-semibold tracking-[-0.02em] text-balance outline-none sm:text-4xl"
          >
            Last look, {firstName}
          </h1>
          <p className="mt-3 max-w-[46ch] leading-relaxed text-white/65">
            Check anything you want to, then send it over. You can’t edit it after sending — if something
            changes later, just tell us on Telegram.
          </p>
          <Review
            chapters={chapters}
            answers={answers}
            onJump={(c, s) => {
              setPhase('form');
              moveTo(c, s);
            }}
          />
        </div>
        <ActionBar>
          {submitError && (
            <p role="alert" className="text-sm font-medium text-red-300">
              {submitError}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPhase('form');
                moveTo(PERSONA, chapters[PERSONA].screens.length - 1);
              }}
              className="h-12 shrink-0 px-4 text-white/65 hover:bg-white/[0.06] hover:text-white"
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>
            <PrimaryButton onClick={submit} disabled={submitting || state === 'invalid'}>
              {submitting ? (
                <>
                  <Loader2 className="activity-spinner size-4 animate-spin" />
                  Sending…
                </>
              ) : missing > 0 ? (
                // Says what the button will actually do: take them to what's left.
                `Finish ${missing} more answer${missing === 1 ? '' : 's'}`
              ) : (
                'Send to Bluu Rock'
              )}
            </PrimaryButton>
          </div>
        </ActionBar>
      </div>
    );
  }

  // ── A set ─────────────────────────────────────────────────────────────────

  const isPersona = chapter === PERSONA;
  const nextChapter = chapters[chapter + 1];

  const heading = onBreak
    ? `That’s ${current.title === 'You' ? 'the first set' : current.title.toLowerCase()} done.`
    : isDeck
      ? screen >= LIMIT_ITEMS.length
        ? 'Anything we missed?'
        : 'Your limits'
      : currentScreen!.title;

  const blurb = onBreak
    ? nextChapter
      ? `Next: ${nextChapter.title.toLowerCase()} — ${nextChapter.blurb.charAt(0).toLowerCase()}${nextChapter.blurb.slice(1)} About ${nextChapter.minutes} minutes.`
      : 'That was the last set. One quick look over everything, then you’re done.'
    : isDeck
      ? null
      : isPersona && screen === 0
        ? PERSONA_INTRO
        : currentScreen!.blurb;

  return (
    <div
      className={cn(
        'mx-auto flex min-h-dvh w-full flex-col px-5 sm:px-8',
        isPersona && !onBreak ? 'max-w-5xl' : 'max-w-xl',
      )}
    >
      <div className={cn(isPersona && !onBreak && 'mx-auto w-full max-w-xl lg:max-w-none')}>{header}</div>

      <div
        className={cn(
          'flex flex-1 flex-col pb-44',
          isPersona && !onBreak && 'lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-12',
        )}
      >
        {isPersona && !onBreak && <PersonaStrip answers={answers} />}
        <div key={`${chapter}-${onBreak ? 'break' : isDeck ? 'deck' : screen}`} className="onboard-rise flex flex-col">
          {/* Position lives in the set strip above — no step kicker here. On a
              limits card the card's own item is the visible heading, so the
              page heading is for screen readers only (it would repeat the
              strip's "Your limits"). */}
          <h1
            ref={headingRef}
            tabIndex={-1}
            className={cn(
              'text-3xl leading-[1.12] font-semibold tracking-[-0.02em] text-balance outline-none sm:text-4xl',
              screen < LIMIT_ITEMS.length && isDeck && 'sr-only',
            )}
          >
            {heading}
          </h1>
          {blurb && <p className="mt-3 max-w-[52ch] leading-relaxed text-white/65">{blurb}</p>}

          {onBreak ? (
            <SetBreak
              done={chapter + 1}
              of={chapters.length}
              name={initial.name}
              passNo={initial.passNo}
              issuedAt={initial.approvedAt}
            />
          ) : isDeck ? (
            <div className={screen < LIMIT_ITEMS.length ? '' : 'mt-7'}>
              <LimitsDeck
                answers={answers}
                onChange={onChange}
                position={screen}
                onPosition={(p) => moveTo(chapter, p)}
              />
              {errors.deck && (
                <p role="alert" className="mt-4 text-sm font-medium text-red-300">
                  {errors.deck}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-9 grid gap-7 sm:grid-cols-2">
              {currentScreen!.questions
                .filter((q) => isVisible(q, answers))
                .map((q) => (
                  <div key={q.id} className={q.half ? 'sm:col-span-1' : 'sm:col-span-2'}>
                    <QuestionField q={q} answers={answers} error={errors[q.id]} onChange={onChange} />
                  </div>
                ))}
            </div>
          )}
        </div>

        {isPersona && !onBreak && (
          <PersonaCard answers={answers} className="mt-10 lg:sticky lg:top-8 lg:mt-[3.25rem]" />
        )}
      </div>

      <ActionBar wide={isPersona && !onBreak}>
        {state === 'invalid' && (
          <p role="alert" className="text-sm font-medium text-red-300">
            This link has been replaced by a newer one — open the latest “Welcome to BLUU ROCK” email to carry on.
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={back}
            className="h-12 shrink-0 px-4 text-white/65 hover:bg-white/[0.06] hover:text-white"
          >
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <PrimaryButton onClick={next}>
            {onBreak ? (nextChapter ? `Start ${nextChapter.title.toLowerCase()}` : 'Review and send') : 'Continue'}
            <ArrowRight className="size-4" />
          </PrimaryButton>
        </div>
      </ActionBar>
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

export function ActionBar({
  children,
  wide = false,
  className,
}: {
  children: React.ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn('fixed inset-x-0 bottom-0 border-t border-white/[0.08] px-5 pt-4 sm:px-8', className)}
      style={{
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        background: 'rgba(8,9,11,0.9)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {/* On the wide persona layout the actions line up under the questions
          column, not under the centre of the page. */}
      <div className={cn('mx-auto w-full', wide ? 'max-w-[60rem]' : 'max-w-xl')}>
        <div className={cn('flex flex-col gap-3', wide && 'max-w-xl lg:max-w-[calc(100%-23rem)]')}>{children}</div>
      </div>
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'h-12 flex-1 rounded-xl text-base font-semibold hover:brightness-110 disabled:opacity-70',
        className,
      )}
      style={{ backgroundColor: AZURE, color: AZURE_INK }}
    >
      {children}
    </Button>
  );
}

/**
 * The beat between sets. The pass comes back — the object they were handed on
 * arrival — punched once for every set finished, the way a ticket is.
 */
function SetBreak({
  done,
  of,
  name,
  passNo,
  issuedAt,
}: {
  done: number;
  of: number;
  name: string;
  passNo: string;
  issuedAt: string | null;
}) {
  return (
    <div className="mt-8 flex flex-col items-start gap-5">
      <div className="w-[min(58vw,14rem)]">
        <Pass name={name} passNo={passNo} issuedAt={issuedAt} arrive={false} punches={done} punchSlots={of} />
      </div>
      <p className="text-sm text-white/65 tabular-nums">
        {done} of {of} sets done. Everything is saved.
      </p>
    </div>
  );
}

type SaveCopy = { label: string; tone: 'quiet' | 'warn'; Icon: React.ComponentType<{ className?: string }> };
const SAVE_COPY: Record<SaveState, SaveCopy | null> = {
  idle: null,
  saving: { label: 'Saving…', tone: 'quiet', Icon: Loader2 },
  saved: { label: 'Saved', tone: 'quiet', Icon: IconCloudCheck },
  offline: { label: 'Offline — kept on this device', tone: 'warn', Icon: IconCloudOff },
  error: { label: 'Retrying save…', tone: 'warn', Icon: IconRefresh },
  locked: { label: 'Already sent', tone: 'quiet', Icon: IconLock },
  invalid: { label: 'Link replaced', tone: 'warn', Icon: IconAlertTriangle },
};

/**
 * Where the reassurance lives. Always in the same corner, always one short
 * phrase — "Saved" is the line that lets someone close the tab mid-form.
 */
function SaveIndicator({ state }: { state: SaveState }) {
  const copy = SAVE_COPY[state];
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex min-h-6 items-center gap-1.5 text-xs font-medium transition-opacity',
        copy ? 'opacity-100' : 'opacity-0',
        copy?.tone === 'warn' ? 'text-amber-200' : 'text-white/60',
      )}
    >
      {copy && (
        <>
          <copy.Icon
            className={cn('size-3.5', state === 'saving' && 'activity-spinner animate-spin')}
            aria-hidden
          />
          {copy.label}
        </>
      )}
    </p>
  );
}

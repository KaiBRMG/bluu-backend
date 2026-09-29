'use client';

import { IconBrandTelegram, IconBrandWhatsapp, IconMail } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CHAPTERS,
  LIMIT_EXTRA_KEY,
  LIMIT_ITEMS,
  ONBOARDING_STAGE_META,
  ageFrom,
  isVisible,
  limitKey,
  limitNoteKey,
  onboardingStage,
  stripAt,
  screensFor,
  telegramUrl,
  whatsappUrl,
} from '@/lib/creatorOnboarding';
import { cn } from '@/lib/utils';
import type { OnboardingDetail } from '@/types/creatorOnboarding';

interface AnswersSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: OnboardingDetail | null;
  loading: boolean;
}

/**
 * One applicant's onboarding, read back for the team.
 *
 * A side sheet, so the list stays behind it and moving between people is a peek
 * rather than a departure. Laid out the way the answers will be USED:
 *   - contact first (the Telegram handle is why anyone opens this);
 *   - "You" as label → value pairs, in form order;
 *   - limits as two columns — what they will and won't make — with notes inline,
 *     because a chatter scans for "can I offer this?", not for item 17;
 *   - the persona as the card the chat team works from.
 * Every label comes from the question model, so this can never drift from what
 * the creator was actually asked.
 */
export function AnswersSheet({ open, onOpenChange, detail, loading }: AnswersSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto border-[#2a2a2a] bg-[#171717] p-0 sm:max-w-xl">
        {loading || !detail ? (
          <div className="flex flex-col gap-4 p-6">
            <SheetHeader className="p-0">
              <SheetTitle className="sr-only">Loading answers</SheetTitle>
              <SheetDescription className="sr-only">Fetching this applicant’s onboarding.</SheetDescription>
            </SheetHeader>
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <Detail detail={detail} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Detail({ detail: d }: { detail: OnboardingDetail }) {
  const stage = onboardingStage(d.status, d.lastActivityAt ?? d.openedAt);
  const meta = ONBOARDING_STAGE_META[stage];
  const a = d.answers;
  const handle = stripAt(a.telegram ?? d.telegram);
  const age = a.dob ? ageFrom(a.dob) : null;
  const you = CHAPTERS.find((c) => c.id === 'you')!;
  const persona = CHAPTERS.find((c) => c.id === 'persona')!;
  const yes = LIMIT_ITEMS.filter((i) => a[limitKey(i.id)] === 'Yes');
  const no = LIMIT_ITEMS.filter((i) => a[limitKey(i.id)] === 'No');
  const unanswered = LIMIT_ITEMS.filter((i) => !a[limitKey(i.id)]);

  return (
    <div className="flex flex-col">
      <SheetHeader className="gap-3 border-b border-[#2a2a2a] p-6">
        <div className="flex items-center gap-2 pr-8">
          <SheetTitle className="text-lg font-semibold">{d.name}</SheetTitle>
          <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', meta.classes)}>{meta.label}</span>
        </div>
        <SheetDescription className="text-sm text-zinc-400">
          {[a.stageName && `“${a.stageName}”`, age !== null && `${age}`, [a.city || d.city, a.country || d.country].filter(Boolean).join(', '), d.track === 'of' ? 'Has OnlyFans' : 'New to OnlyFans']
            .filter(Boolean)
            .join(' · ')}
        </SheetDescription>
        <div className="flex flex-wrap gap-2">
          {handle && (
            <Button asChild size="sm" className="h-8 gap-1.5">
              <a href={telegramUrl(handle)} target="_blank" rel="noopener noreferrer">
                <IconBrandTelegram className="size-4" aria-hidden />
                Message @{handle}
              </a>
            </Button>
          )}
          {d.whatsapp && (
            <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
              <a href={whatsappUrl(d.whatsapp)} target="_blank" rel="noopener noreferrer">
                <IconBrandWhatsapp className="size-4" aria-hidden />
                {d.whatsapp}
              </a>
            </Button>
          )}
          <Button asChild size="sm" variant="ghost" className="h-8 gap-1.5 text-zinc-300">
            <a href={`mailto:${d.email}`}>
              <IconMail className="size-4" aria-hidden />
              {d.email}
            </a>
          </Button>
        </div>
        {d.status !== 'completed' && (
          <p className="text-xs text-zinc-400 tabular-nums">
            Still in progress — {d.requiredAnswered} of {d.requiredTotal} required answers so far. What’s below is their
            draft.
          </p>
        )}
      </SheetHeader>

      <Section title="You">
        <dl className="flex flex-col divide-y divide-white/[0.06]">
          {screensFor(you, d.track)
            .flatMap((s) => s.questions)
            .filter((q) => isVisible(q, a))
            .map((q) => (
              <div key={q.id} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-4 py-2.5">
                <dt className="text-xs leading-snug text-zinc-400">{q.label}</dt>
                <dd className={cn('text-sm whitespace-pre-wrap break-words', a[q.id] ? 'text-zinc-100' : 'text-zinc-400')}>
                  {q.id === 'telegram' && a[q.id] ? `@${a[q.id]}` : q.prefix && a[q.id] ? `${q.prefix}${a[q.id]}` : a[q.id] || '—'}
                  {q.id === 'dob' && age !== null && <span className="text-zinc-400"> ({age})</span>}
                </dd>
              </div>
            ))}
        </dl>
      </Section>

      <Section title="Limits" meta={`${yes.length} yes · ${no.length} no${unanswered.length ? ` · ${unanswered.length} unanswered` : ''}`}>
        <div className="grid gap-5 sm:grid-cols-2">
          <LimitColumn title="Will make" items={yes} answers={a} tone="yes" />
          <LimitColumn title="Won’t make" items={no} answers={a} tone="no" />
        </div>
        {a[LIMIT_EXTRA_KEY] && (
          <div className="mt-4">
            <p className="text-xs text-zinc-400">Anything else they’re happy to create</p>
            <p className="mt-1 text-sm whitespace-pre-wrap text-zinc-100">{a[LIMIT_EXTRA_KEY]}</p>
          </div>
        )}
      </Section>

      <Section title="Persona">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          {screensFor(persona, d.track)
            .flatMap((s) => s.questions)
            .filter((q) => isVisible(q, a) && a[q.id])
            .map((q) => (
              <div key={q.id} className={cn(q.kind === 'textarea' && 'col-span-2')}>
                <dt className="text-xs text-zinc-400">{q.label}</dt>
                <dd className="mt-0.5 text-sm whitespace-pre-wrap break-words text-zinc-100">{a[q.id]}</dd>
              </div>
            ))}
        </dl>
      </Section>
    </div>
  );
}

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[#2a2a2a] p-6 last:border-b-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {meta && <span className="text-xs text-zinc-400 tabular-nums">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

function LimitColumn({
  title,
  items,
  answers,
  tone,
}: {
  title: string;
  items: typeof LIMIT_ITEMS;
  answers: Record<string, string>;
  tone: 'yes' | 'no';
}) {
  return (
    <div>
      <p className={cn('mb-2 text-xs font-medium', tone === 'yes' ? 'text-green-400' : 'text-red-400')}>{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-400">None</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((i) => (
            <li key={i.id} className="text-sm text-zinc-100">
              {i.label}
              {i.detail && <span className="text-zinc-400"> — {i.detail}</span>}
              {answers[limitNoteKey(i.id)] && (
                <span className="block text-xs text-zinc-400">“{answers[limitNoteKey(i.id)]}”</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

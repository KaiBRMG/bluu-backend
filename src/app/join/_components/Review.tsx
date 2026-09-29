'use client';

import { IconCheck, IconPencil } from '@tabler/icons-react';
import {
  LIMIT_ITEMS,
  isRequired,
  isVisible,
  limitKey,
  limitTally,
  screenErrors,
  type Answers,
  type Chapter,
} from '@/lib/creatorOnboarding';
import { cn } from '@/lib/utils';
import { AZURE, AZURE_INK, PANEL } from '@/app/model-submissions/_lib/theme';

interface ReviewProps {
  chapters: Chapter[];
  answers: Answers;
  onJump: (chapter: number, screen: number) => void;
}

/**
 * The last look before sending. Not a wall of every answer read back — a
 * creator skimming 50 of their own answers finds nothing and learns nothing —
 * but one row per screen, each saying whether it is complete and taking them
 * straight back into it. What still needs them is said in words, never only by
 * a mark.
 */
export function Review({ chapters, answers, onJump }: ReviewProps) {
  return (
    <div className="mt-9 flex flex-col gap-8">
      {chapters.map((chapter, c) => {
        if (chapter.id === 'limits') {
          const { answered, yes, open: missing } = limitTally(answers);
          const firstOpen = LIMIT_ITEMS.findIndex((i) => !answers[limitKey(i.id)]);
          return (
            <Section key={chapter.id} title={chapter.title}>
              <Row
                title={`${answered} of ${LIMIT_ITEMS.length} answered`}
                detail={missing === 0 ? `${yes} yes · ${answered - yes} no` : `${missing} still to answer`}
                complete={missing === 0}
                onEdit={() => onJump(c, firstOpen === -1 ? 0 : firstOpen)}
              />
            </Section>
          );
        }
        return (
          <Section key={chapter.id} title={chapter.title}>
            {chapter.screens.map((screen, s) => {
              const needed = Object.keys(screenErrors(screen, answers)).length;
              const visible = screen.questions.filter((q) => isVisible(q, answers));
              const filled = visible.filter((q) => (answers[q.id] ?? '').trim()).length;
              const requiredCount = visible.filter((q) => isRequired(q, answers)).length;
              return (
                <Row
                  key={screen.id}
                  title={screen.title}
                  detail={
                    needed > 0
                      ? `${needed} still needed`
                      : requiredCount === 0 && filled === 0
                        ? 'All optional — skipped'
                        : `${filled} of ${visible.length} answered`
                  }
                  complete={needed === 0}
                  onEdit={() => onJump(c, s)}
                />
              );
            })}
          </Section>
        );
      })}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <div className={cn(PANEL, 'flex flex-col divide-y divide-white/[0.07] overflow-hidden rounded-xl')}>{children}</div>
    </section>
  );
}

function Row({
  title,
  detail,
  complete,
  onEdit,
}: {
  title: string;
  detail: string;
  complete: boolean;
  onEdit: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex min-h-14 items-center gap-3 px-4 py-3 text-left transition-colors outline-none hover:bg-white/[0.04] focus-visible:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-[#00b8f5]/40 focus-visible:ring-inset"
    >
      <span
        aria-hidden
        className={cn('grid size-6 shrink-0 place-items-center rounded-full', !complete && 'ring-1 ring-red-300/70')}
        style={complete ? { backgroundColor: AZURE, color: AZURE_INK } : undefined}
      >
        {complete && <IconCheck className="size-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium text-white">{title}</span>
        <span className={cn('block text-sm', complete ? 'text-white/60' : 'font-medium text-red-300')}>{detail}</span>
      </span>
      <IconPencil className="size-4 shrink-0 text-white/60" aria-hidden />
      <span className="sr-only">Edit</span>
    </button>
  );
}

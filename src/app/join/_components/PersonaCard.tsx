'use client';

import type { Answers } from '@/lib/creatorOnboarding';
import { cn } from '@/lib/utils';
import { PASS_EDGE, PASS_SURFACE } from '@/app/model-submissions/_lib/theme';

interface PersonaCardProps {
  answers: Answers;
  className?: string;
}

const LOOKS: [string, string][] = [
  ['pHair', 'Hair'],
  ['pEyes', 'Eyes'],
  ['pHeight', 'Height'],
  ['pWeight', 'Weight'],
  ['pWaist', 'Waist'],
  ['pShoe', 'Shoe'],
];

/**
 * "Who your fans meet" — the persona, assembled live as Part III is answered.
 *
 * It exists to make Part III feel like building something rather than filling
 * boxes: every answer lands on the card the moment it is typed. It also tells
 * the truth about what the answers are FOR — this is roughly what the chat
 * team reads before speaking as them.
 *
 * Unanswered facts render as a quiet dash rather than disappearing, so the card
 * holds its shape and shows what is still blank.
 */
export function PersonaCard({ answers, className }: PersonaCardProps) {
  const a = (k: string) => (answers[k] ?? '').trim();
  const name = a('stageName') || 'Your stage name';
  const line = [a('pAge'), a('pSex'), a('pSexuality'), a('pPosition')].filter(Boolean).join(' · ');
  const place = [a('pLocation'), a('pTimezone')].filter(Boolean).join(' · ');
  const looks = LOOKS.filter(([k]) => a(k));

  return (
    <aside
      aria-label="Persona preview"
      className={cn('flex flex-col gap-5 rounded-2xl p-5', className)}
      style={{ backgroundColor: PASS_SURFACE, boxShadow: `inset 0 0 0 1px ${PASS_EDGE}` }}
    >
      <h2 className="text-sm font-semibold text-white/80">Who your fans meet</h2>

      <div>
        <p className={cn('text-2xl leading-tight font-semibold tracking-[-0.02em]', !a('stageName') && 'text-white/40')}>
          {name}
        </p>
        <p className="mt-1 min-h-5 text-sm text-white/70">{line || '—'}</p>
        <p className="min-h-5 text-sm text-white/60">{place || '—'}</p>
      </div>

      <div className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: PASS_EDGE }}>
        <Row label="Personality" value={a('pPersonality')} />
        <Row label="Into" value={a('pInterests')} />
        {a('pOccupation') && <Row label="Does" value={a('pOccupation')} />}
        {a('pTurnOns') && <Row label="Turned on by" value={a('pTurnOns')} />}
      </div>

      {looks.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-4" style={{ borderColor: PASS_EDGE }}>
          {looks.map(([k, label]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] text-white/60">{label}</dt>
              <dd className="text-sm font-medium break-words text-white">{a(k)}</dd>
            </div>
          ))}
        </dl>
      )}
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-white/60">{label}</p>
      <p className={cn('line-clamp-3 text-sm leading-snug', value ? 'text-white/90' : 'text-white/40')}>
        {value || '—'}
      </p>
    </div>
  );
}

/**
 * The phone version of the live preview: a slim strip pinned to the top while
 * the persona set is open, so answers visibly land as they are typed instead of
 * in a card eleven fields further down.
 */
export function PersonaStrip({ answers }: { answers: Answers }) {
  const a = (k: string) => (answers[k] ?? '').trim();
  const line = [a('pAge'), a('pSex'), a('pSexuality'), a('pLocation')].filter(Boolean).join(' · ');
  return (
    <div
      aria-hidden
      className="sticky top-0 z-10 -mx-5 mb-6 flex items-baseline gap-2 border-b px-5 py-2.5 backdrop-blur-md sm:-mx-8 sm:px-8 lg:hidden"
      style={{ backgroundColor: 'rgba(8,9,11,0.88)', borderColor: PASS_EDGE }}
    >
      <span className={cn('shrink-0 text-sm font-semibold', a('stageName') ? 'text-white' : 'text-white/60')}>
        {a('stageName') || 'Your persona'}
      </span>
      <span className="min-w-0 truncate text-xs text-white/65">{line}</span>
    </div>
  );
}

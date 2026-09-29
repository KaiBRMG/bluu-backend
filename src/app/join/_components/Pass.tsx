'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { AZURE, AZURE_INK, PASS_EDGE, PASS_EMBOSS, PASS_SURFACE, STAGE_GROUND } from '@/app/model-submissions/_lib/theme';

interface PassProps {
  name: string;
  passNo: string;
  /** ISO date the application was approved — "Issued" on the pass. */
  issuedAt: string | null;
  /** Stamped "Onboarded" — the completion state. */
  stamped?: boolean;
  /** ISO date printed in the stamp. Defaults to now (the moment of submitting). */
  stampedAt?: string | null;
  /** Sets finished, shown as punched holes (the set-break beat). Omit for none. */
  punches?: number;
  /** How many punch positions the pass has — one per set. */
  punchSlots?: number;
  /** Plays the arrival (drop + sheen). Off when the pass is re-shown. */
  arrive?: boolean;
  className?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function formatDate(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The welcome pass: the creator's name on a credential, handed over on arrival.
 *
 * Every field on it is TRUE — their name as they applied, the day they were
 * approved, a reference derived from their record — because a pass that
 * printed an invented rank or "1 of 50" would be a claim, and the surface
 * earns exclusivity from facts only (PRODUCT.md, Evidence on Hand).
 *
 * Two layers so two transforms never fight: the OUTER element carries the
 * pointer tilt (set straight on the style, no re-render), the INNER carries the
 * resting rotation and the one-off drop animation.
 */
export function Pass({
  name,
  passNo,
  issuedAt,
  stamped = false,
  stampedAt = null,
  punches,
  punchSlots = 3,
  arrive = true,
  className,
}: PassProps) {
  const tiltRef = useRef<HTMLDivElement>(null);

  // Pointer tilt, fine pointers only: a hover-less phone gets the still card,
  // and reduced-motion users get no tilt at all.
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = tiltRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateY(${(x * 10).toFixed(2)}deg) rotateX(${(-y * 10).toFixed(2)}deg)`;
  };
  const onLeave = () => {
    if (tiltRef.current) tiltRef.current.style.transform = '';
  };

  return (
    <div
      ref={tiltRef}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={cn('transition-transform duration-200 ease-out will-change-transform', className)}
    >
      <div
        className={cn('relative', arrive && 'pass-drop')}
        style={{ transform: 'rotate(-2deg)' }}
      >
        <article
          aria-label={`Bluu Rock pass for ${name}`}
          className="@container relative flex aspect-[5/7] w-full flex-col overflow-hidden rounded-[22px]"
          style={{ backgroundColor: PASS_SURFACE, boxShadow: `inset 0 0 0 1px ${PASS_EDGE}` }}
        >
          {/* The punched lanyard slot. Filled with the page ground, so it reads
              as a hole through the laminate rather than a mark printed on it. */}
          <span
            aria-hidden
            className="mx-auto mt-4 h-2.5 w-14 shrink-0 rounded-full"
            style={{ ...STAGE_GROUND, boxShadow: `inset 0 1px 2px rgba(0,0,0,0.6), 0 0 0 1px ${PASS_EDGE}` }}
          />

          <div className="flex shrink-0 items-center justify-between px-[7cqw] pt-[5cqw]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo/HQ2.webp" alt="" width={1374} height={868} className="h-7 w-auto" />
            {punches === undefined ? (
              <span className="text-[11px] font-semibold tracking-[0.16em] text-white/60 uppercase">Talent</span>
            ) : (
              // Punched holes, like a ticket: filled with the page ground, so
              // each reads as a hole through the laminate.
              <span className="flex gap-1.5" role="img" aria-label={`${punches} of ${punchSlots} sets done`}>
                {Array.from({ length: punchSlots }).map((_, i) => (
                  <span
                    key={i}
                    className="size-3.5 rounded-full"
                    style={
                      i < punches
                        ? { ...STAGE_GROUND, boxShadow: `inset 0 1px 2px rgba(0,0,0,0.7), 0 0 0 1px ${PASS_EDGE}` }
                        : { boxShadow: `inset 0 0 0 1px ${PASS_EMBOSS}` }
                    }
                  />
                ))}
              </span>
            )}
          </div>

          {/* Their initials, embossed into the laminate — the space a photo
              would take on a real pass, filled with something that is theirs
              without putting their face on a link that can be forwarded. */}
          {/* The stamp takes this spot once onboarded — never both. */}
          {!stamped && (
            <span
              aria-hidden
              className="pointer-events-none absolute top-[17%] right-[5cqw] text-[40cqw] leading-none font-bold tracking-[-0.06em] select-none"
              style={{ color: 'transparent', WebkitTextStroke: `1.5px ${PASS_EMBOSS}` }}
            >
              {initials(name)}
            </span>
          )}

          <div className="relative flex min-h-0 flex-1 flex-col justify-end px-[7cqw] pb-[6cqw]">
            <p
              className="text-[11cqw] leading-[1.02] font-semibold tracking-[-0.03em] break-words text-white"
              style={{ textWrap: 'balance' }}
            >
              {name}
            </p>

            <dl className="mt-[6cqw] grid grid-cols-2 gap-x-4 gap-y-[3cqw] border-t pt-[4cqw]" style={{ borderColor: PASS_EDGE }}>
              <div>
                <dt className="text-[11px] font-medium text-white/60">Role</dt>
                <dd className="text-[max(0.8125rem,4.4cqw)] font-semibold text-white">Creator</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-white/60">Status</dt>
                <dd className="text-[max(0.8125rem,4.4cqw)] font-semibold text-white">{stamped ? 'Onboarded' : 'Approved'}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-white/60">Issued</dt>
                <dd className="text-[max(0.8125rem,4.4cqw)] font-semibold text-white tabular-nums">{formatDate(issuedAt)}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-white/60">Pass no.</dt>
                <dd className="text-[max(0.8125rem,4.4cqw)] font-semibold text-white tabular-nums">{passNo}</dd>
              </div>
            </dl>
          </div>

          <div
            className="flex shrink-0 items-center justify-between gap-3 px-[7cqw] py-[3.5cqw] text-[max(9px,3cqw)] font-bold tracking-[0.14em] uppercase"
            style={{ backgroundColor: AZURE, color: AZURE_INK }}
          >
            <span>Onboarding</span>
            <span className="font-semibold tracking-[0.08em] whitespace-nowrap normal-case">Non-transferable</span>
          </div>

          {arrive && <span aria-hidden className="pass-sheen pointer-events-none absolute inset-0" />}

          {stamped && (
            <span
              className="pass-stamp pointer-events-none absolute top-[22%] right-5 grid place-items-center rounded-lg border-[3px] px-3 py-1.5 text-center"
              style={{ borderColor: AZURE, color: AZURE, transform: 'rotate(-9deg)' }}
            >
              <span className="text-lg leading-none font-black tracking-[0.12em] uppercase">Onboarded</span>
              <span className="mt-1 text-[10px] font-bold tracking-[0.1em] tabular-nums">
                {formatDate(stampedAt)}
              </span>
            </span>
          )}
        </article>
      </div>
    </div>
  );
}

'use client';

import { cn } from '@/lib/utils';
import { ACTION_BLUE } from '@/lib/actionBlue';

/**
 * The facet-rail primitives — a count-bearing row and a labelled group —
 * shared by every faceted index (Resources, Tasks). See DESIGN.md → The faceted
 * index for why the rail is greyscale with one Action Blue voice.
 */


export interface Facet {
  value: string;
  label: string;
  count: number;
}

export function FacetButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left',
        'text-sm transition-colors focus-visible:outline-none focus-visible:ring-2',
        active
          ? 'font-semibold text-white'
          : 'font-medium text-zinc-400 hover:bg-white/[0.055] hover:text-zinc-100',
      )}
      style={{
        backgroundColor: active ? `${ACTION_BLUE}26` : undefined,
        // Tailwind's ring colour token is neutral here; the focus ring is the
        // one Action Blue voice, same as every other focusable row in the app.
        ['--tw-ring-color' as string]: ACTION_BLUE,
      }}
    >
      <span className="truncate">{label}</span>
      {count !== null && (
        <span
          className={cn(
            'shrink-0 text-xs tabular-nums',
            active ? 'text-zinc-200' : 'text-zinc-400',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function FacetSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {/* Not the sidebar eyebrow — that device is reserved for the nav rail
          (DESIGN §3). A plain label is the right weight for a facet group. */}
      <p className="px-2 pb-1.5 text-xs font-medium text-zinc-400">{title}</p>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  );
}

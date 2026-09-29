'use client';

import { cn } from '@/lib/utils';

export interface FilterChip<T extends string> {
  value: T;
  label: string;
  /** Status dot class (e.g. `bg-green-400`), when the facet has a hue. */
  dot?: string;
}

/**
 * The facet row both tabs of the Onboarding page filter with: a row of
 * `aria-pressed` buttons, each with a count. Selection is the Action Blue tint
 * plus a weight step (DESIGN.md — the faceted index), hover is the overlay.
 */
export function FilterChips<T extends string>({
  label,
  items,
  value,
  counts,
  onChange,
}: {
  label: string;
  items: FilterChip<T>[];
  value: T;
  counts: Record<T, number>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {items.map((item) => {
        const on = value === item.value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              on ? 'bg-action-blue/15 font-semibold text-white' : 'text-zinc-400 hover:bg-white/[0.055] hover:text-zinc-200',
            )}
          >
            {item.dot && <span className={cn('inline-block size-2 rounded-full', item.dot)} aria-hidden />}
            {item.label}
            <span className="text-xs text-zinc-400 tabular-nums">{counts[item.value]}</span>
          </button>
        );
      })}
    </div>
  );
}

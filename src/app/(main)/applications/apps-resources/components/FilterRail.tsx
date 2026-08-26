'use client';

import { cn } from '@/lib/utils';

/**
 * The faceted filter rail.
 *
 * Replaces the two rows of coloured filter pills that used to sit above the
 * table. Three reasons this is the better shape for the same job:
 *
 *  - **It carries counts.** A facet that says "Guide 12" tells you what is in
 *    the collection before you click it; a pill row told you nothing. Counts are
 *    computed against *every other* facet (see `page.tsx`), so a facet reading 0
 *    is honest and a click can never land you on an empty list by surprise.
 *  - **It stops growing the header.** Types are free-form, so the pill rows grew
 *    without bound and pushed the actual resources below the fold. A vertical
 *    rail scrolls in its own column instead.
 *  - **It is greyscale.** The old pills hashed each type string to one of ten
 *    hues, which is colour spent on nothing (DESIGN §2, The Semantic-Only Rule).
 *    Selection is the one Action Blue voice; everything else is the overlay
 *    recipe.
 */

/** Action Blue, inked here for the same reason OF Manager's Send button is —
 *  shadcn's `--primary` resolves to near-white in this theme (DESIGN §2). */
const ACTION_BLUE = '#3b82f6';

export interface Facet {
  value: string;
  label: string;
  count: number;
}

function FacetButton({
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

function Section({
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

export function FilterRail({
  typeFacets,
  activeTypes,
  onToggleType,
  onClearTypes,
  groupFacets,
  activeGroups,
  onToggleGroup,
  onClearGroups,
  showStatus,
  statusFacets,
  status,
  onSetStatus,
  totalCount,
  className,
}: {
  typeFacets: Facet[];
  activeTypes: string[];
  onToggleType: (value: string) => void;
  onClearTypes: () => void;
  /** Empty when the viewer only ever reads one group — the facet would be a no-op. */
  groupFacets: Facet[];
  activeGroups: string[];
  onToggleGroup: (value: string) => void;
  onClearGroups: () => void;
  /** Managers only: readers are never sent a non-Active resource. */
  showStatus: boolean;
  statusFacets: Facet[];
  status: 'all' | 'Active' | 'Unlisted';
  onSetStatus: (value: 'all' | 'Active' | 'Unlisted') => void;
  /** Count behind the "All types" / "All groups" rows. */
  totalCount: number;
  className?: string;
}) {
  return (
    <nav aria-label="Filter resources" className={cn('flex flex-col gap-5', className)}>
      {typeFacets.length > 0 && (
        <Section title="Type">
          <FacetButton
            label="All types"
            count={totalCount}
            active={activeTypes.length === 0}
            onClick={onClearTypes}
          />
          {typeFacets.map(f => (
            <FacetButton
              key={f.value}
              label={f.label}
              count={f.count}
              active={activeTypes.includes(f.value)}
              onClick={() => onToggleType(f.value)}
            />
          ))}
        </Section>
      )}

      {groupFacets.length > 1 && (
        <Section title="Shared with">
          <FacetButton
            label="All groups"
            count={totalCount}
            active={activeGroups.length === 0}
            onClick={onClearGroups}
          />
          {groupFacets.map(f => (
            <FacetButton
              key={f.value}
              label={f.label}
              count={f.count}
              active={activeGroups.includes(f.value)}
              onClick={() => onToggleGroup(f.value)}
            />
          ))}
        </Section>
      )}

      {showStatus && (
        <Section title="Status">
          {statusFacets.map(f => (
            <FacetButton
              key={f.value}
              label={f.label}
              count={f.count}
              active={status === f.value}
              onClick={() => onSetStatus(f.value as 'all' | 'Active' | 'Unlisted')}
            />
          ))}
        </Section>
      )}
    </nav>
  );
}

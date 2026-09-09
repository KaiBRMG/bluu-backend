'use client';

import { cn } from '@/lib/utils';

/**
 * The registry's faceted filter rail.
 *
 * This replaces both the row of three `Select`s *and* the four-tab bar above
 * it. The tabs were a filter promoted to navigation: three of the four panels
 * rendered the same component with booleans, and those booleans collapsed to
 * two predicates — `isArchived` and `isInvitedUser` — that already existed as
 * filter values inside it. Worse, the page's primary action lived *inside* two
 * of the four panels, so "add an employee" vanished on half the surface.
 *
 * Three things the rail does that neither shape did:
 *
 *  - **It carries faceted counts.** Every count is computed with that one facet
 *    cleared, so the number beside a facet is what clicking it will actually
 *    produce. The old Selects showed no count at all, which DESIGN.md §5 names
 *    as the weaker of the two acceptable options ("Counts are faceted, or they
 *    are lies").
 *  - **It is one surface.** Archived and Not-set-up are facets beside Group and
 *    Employment type, so "archived contractors" and "unassigned people who
 *    never signed in" are now askable. Under tabs they were mutually exclusive
 *    destinations.
 *  - **It is greyscale.** Selection is the one Action Blue voice; everything
 *    else rides the overlay recipe (DESIGN.md §2, §4).
 *
 * Shape and behaviour follow the Resources page's `FilterRail`, which is the
 * documented reference for a faceted index.
 */

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
  count: number;
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
        ['--tw-ring-color' as string]: ACTION_BLUE,
      }}
    >
      <span className="truncate">{label}</span>
      <span
        className={cn(
          'shrink-0 text-xs tabular-nums',
          active ? 'text-zinc-200' : 'text-zinc-400',
        )}
      >
        {count}
      </span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      {/* A plain label, not the sidebar eyebrow — that device is reserved for
          the nav rail (DESIGN.md §3). */}
      <p className="px-2 pb-1.5 text-xs font-medium text-zinc-400">{title}</p>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  );
}

export function RegistryRail({
  stageFacets,
  stage,
  onSetStage,
  groupFacets,
  activeGroups,
  onToggleGroup,
  employmentFacets,
  activeEmployment,
  onToggleEmployment,
  className,
}: {
  stageFacets: Facet[];
  /** Empty string = every stage except archived; archived is opt-in. */
  stage: string;
  onSetStage: (value: string) => void;
  groupFacets: Facet[];
  activeGroups: string[];
  onToggleGroup: (value: string) => void;
  employmentFacets: Facet[];
  activeEmployment: string[];
  onToggleEmployment: (value: string) => void;
  className?: string;
}) {
  return (
    <nav aria-label="Filter employees" className={cn('flex flex-col gap-5', className)}>
      <Section title="Status">
        {stageFacets.map((f) => (
          <FacetButton
            key={f.value}
            label={f.label}
            count={f.count}
            active={stage === f.value}
            // Clicking the active facet clears it — the rail is its own way out.
            onClick={() => onSetStage(stage === f.value ? '' : f.value)}
          />
        ))}
      </Section>

      {groupFacets.length > 0 && (
        <Section title="Group">
          {groupFacets.map((f) => (
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

      <Section title="Employment">
        {employmentFacets.map((f) => (
          <FacetButton
            key={f.value}
            label={f.label}
            count={f.count}
            active={activeEmployment.includes(f.value)}
            onClick={() => onToggleEmployment(f.value)}
          />
        ))}
      </Section>
    </nav>
  );
}

'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useCreatorMap } from '@/hooks/useCreators';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';

/**
 * The house pattern for showing a creator.
 *
 * Wherever a creator appears — a shift's assigned accounts, a coverage offer, a
 * sales breakdown — it renders through here: the real `Avatar` component with
 * the creator's profile picture, falling back to initials on a colour hashed
 * from their stage name.
 *
 * Two rules it exists to enforce (CLAUDE.md rule 7):
 *
 * - **Never an `<img>`.** `Avatar` handles the load failure, the rounding and
 *   the fallback swap; a bare `<img>` shows a broken-image glyph the first time
 *   a Storage URL expires.
 * - **The fallback is always seeded from the displayed name**, here the stage
 *   name. `getAvatarColor` hashes that string, so seeding it from an id instead
 *   would give the same creator a different colour on every screen.
 *
 * ## Rendering cost
 *
 * A month calendar draws thirty-odd of these, so the read path matters:
 *
 * - Ids resolve through `useCreatorMap`, a **module-level shared store** — one
 *   fetch, one `sessionStorage` parse and one `Map` for the whole page, not one
 *   per chip (see `useCreators.ts`).
 * - Lookup is O(1) against that Map rather than a `.find()` per chip.
 * - The component is `memo`ised, so a parent re-render (a month change, a claim
 *   landing) re-renders only the chips whose props actually moved. Pass a
 *   **stable** `creatorIds` array to `CreatorChipList` — an inline `.map()` in
 *   the parent defeats it.
 * - The image is cached by the browser for a week: creator photos are written
 *   with `Cache-Control: private, max-age=604800, immutable`, and the download
 *   URL rotates on re-upload so a cached copy can never be the wrong one.
 *   Before that header existed Firebase served them `max-age=0` and every
 *   avatar was re-fetched on every page load.
 */

type ChipSize = 'xs' | 'sm';

interface CreatorChipProps {
  /** The creator's document id. */
  creatorId: string;
  /** Overrides the looked-up name — for surfaces that already hold it. */
  name?: string;
  photoURL?: string | null;
  size?: ChipSize;
  /** Renders just the avatar, with the name as a tooltip. For very dense rows. */
  avatarOnly?: boolean;
  className?: string;
}

const AVATAR_SIZE: Record<ChipSize, string> = {
  xs: 'size-4',
  sm: 'size-5',
};

const TEXT_SIZE: Record<ChipSize, string> = {
  xs: 'text-[10px]',
  sm: 'text-[11px]',
};

/**
 * Just the avatar — no chip chrome.
 *
 * For the many places that render a creator's face beside their own layout
 * (a table cell, a column header, a compact row) and only need the picture.
 * Going through here rather than hand-rolling `Avatar` + `AvatarFallback` is
 * what keeps the seed rule (CLAUDE.md rule 7) actually applied: several call
 * sites used to do `stageName.charAt(0)` on a plain grey circle, which is
 * neither the right initials nor the right colour.
 *
 * Pass `creatorId` to resolve from the shared store, or `name`/`photoURL`
 * directly when the caller already holds the creator.
 */
export const CreatorAvatar = memo(function CreatorAvatar({
  creatorId,
  name,
  photoURL,
  className,
}: {
  creatorId?: string;
  name?: string;
  photoURL?: string | null;
  className?: string;
}) {
  const byId = useCreatorMap();

  const hit = name === undefined && creatorId ? byId.get(creatorId) : undefined;
  const stageName = name ?? hit?.stageName ?? creatorId ?? '';
  const resolvedPhoto = (name !== undefined ? photoURL : hit?.photoURL) ?? null;

  return (
    <Avatar className={cn('shrink-0', className)}>
      {/* No `loading="lazy"`, deliberately: Radix's Avatar preloads through
          `new window.Image()` and forwards only `referrerPolicy`/`crossOrigin`,
          so the attribute would be inert and the comment beside it a lie. What
          actually saves the requests is the HTTP cache — see the header note. */}
      <AvatarImage src={resolvedPhoto ?? undefined} alt="" decoding="async" />
      <AvatarFallback
        className="font-medium text-white"
        style={{ backgroundColor: getAvatarColor(stageName) }}
      >
        {getInitials(stageName)}
      </AvatarFallback>
    </Avatar>
  );
});

export const CreatorChip = memo(function CreatorChip({
  creatorId,
  name,
  photoURL,
  size = 'sm',
  avatarOnly = false,
  className,
}: CreatorChipProps) {
  const byId = useCreatorMap();

  // No `useMemo`: this is two property reads off a Map the store already built.
  // Memoising it would cost more than it saves.
  const hit = name === undefined ? byId.get(creatorId) : undefined;
  // Falling back to the id keeps a deleted or not-yet-loaded creator visible
  // rather than rendering an empty chip that looks like a rendering bug.
  const stageName = name ?? hit?.stageName ?? creatorId;

  const avatar = (
    <CreatorAvatar
      creatorId={creatorId}
      name={name}
      photoURL={photoURL}
      className={cn(AVATAR_SIZE[size], TEXT_SIZE[size])}
    />
  );

  if (avatarOnly) {
    return (
      <span className={cn('inline-flex', className)} title={stageName}>
        {avatar}
        <span className="sr-only">{stageName}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full bg-white/[0.08] py-px pl-px pr-2',
        className,
      )}
      title={stageName}
    >
      {avatar}
      <span className={cn('truncate text-zinc-300', TEXT_SIZE[size])}>{stageName}</span>
    </span>
  );
});

/**
 * A row of creator chips with an overflow count.
 *
 * `max` keeps a dense cell from wrapping to four lines; the remainder collapses
 * into a `+N` whose tooltip names them, so nothing is hidden outright.
 */
export const CreatorChipList = memo(function CreatorChipList({
  creatorIds,
  max,
  size = 'sm',
  avatarOnly = false,
  emptyLabel,
  className,
}: {
  creatorIds: string[];
  max?: number;
  size?: ChipSize;
  avatarOnly?: boolean;
  /** Rendered when there are no creators. Omit to render nothing at all. */
  emptyLabel?: string;
  className?: string;
}) {
  const byId = useCreatorMap();

  if (creatorIds.length === 0) {
    return emptyLabel ? <span className={cn('text-[11px] text-zinc-500', className)}>{emptyLabel}</span> : null;
  }

  const shown = max ? creatorIds.slice(0, max) : creatorIds;
  const hidden = creatorIds.slice(shown.length);

  const nameOf = (id: string) => byId.get(id)?.stageName ?? id;

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {shown.map(id => (
        <CreatorChip key={id} creatorId={id} size={size} avatarOnly={avatarOnly} />
      ))}
      {hidden.length > 0 && (
        <span
          className={cn('rounded-full bg-white/[0.08] px-1.5 py-px text-zinc-400', TEXT_SIZE[size])}
          title={hidden.map(nameOf).join(', ')}
        >
          +{hidden.length}
        </span>
      )}
    </span>
  );
});

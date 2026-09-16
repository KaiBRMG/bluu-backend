'use client';

import { memo, useCallback, useState } from 'react';
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
 * - **The image is normally not fetched at all.** The roster carries a 64px
 *   WebP `data:` URI per creator (`photoThumb`), so a thirty-avatar calendar
 *   costs zero image requests instead of thirty round trips to Firebase
 *   Storage — which is not a CDN, validates the download token on every
 *   request, and was the whole of the "avatars take forever" problem.
 * - The 256px `photoURL` remains the fallback for a creator whose thumbnail has
 *   not been backfilled yet. Those are cached by the browser for a week
 *   (`Cache-Control: private, max-age=604800, immutable`, safe because the
 *   download URL rotates on re-upload), and a failed load is retried once —
 *   Radix gives up permanently otherwise, which is why an avatar could drop to
 *   initials and stay there.
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
  /**
   * Marks this account as overtime the agent works without extra pay.
   *
   * Rendered as an orange ring on the avatar — orange already means
   * "overtime / cover" everywhere in this subsystem, and a ring is the one
   * affordance that survives a ~90px calendar cell where the chip is a bare
   * face. The tooltip carries the meaning, because a ring on its own is a
   * decoration and DESIGN.md §2 forbids colour that encodes nothing.
   */
  overtime?: boolean;
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

  // The roster is consulted for the *picture* whenever an id resolves, even when
  // the caller overrode the name. `name` is a display override — several pages
  // hold their own creator list and pass the name they already show — but the
  // roster is the only place the inline thumbnail lives, and preferring a
  // caller's `photoURL` over it would put those pages back on one HTTP request
  // per avatar for no benefit.
  const hit = creatorId ? byId.get(creatorId) : undefined;
  const stageName = name ?? hit?.stageName ?? creatorId ?? '';

  // Order matters: the inlined thumbnail first (already in memory, no request),
  // then whatever the caller handed us, then the roster's 256px object.
  const src = hit?.photoThumb ?? (name !== undefined ? photoURL : null) ?? hit?.photoURL ?? null;

  // The retry is stored *with the src it belongs to*, rather than being cleared
  // by an effect when `src` changes. A retry for a previous creator is then
  // simply not current — no effect, no cascading render, and no window in which
  // one creator is briefly shown another's photo.
  const [retry, setRetry] = useState<{ of: string; url: string } | null>(null);
  const retriedSrc = retry && retry.of === src ? retry.url : null;

  /**
   * Retry a failed load exactly once.
   *
   * Radix's `Avatar.Image` preloads through `new window.Image()` and, on any
   * error, swaps to the fallback for the life of the mount with no retry. One
   * transient 5xx from Firebase Storage — entirely likely when thirty requests
   * leave at once — therefore stranded that creator on their initials, visually
   * indistinguishable from having no photo at all.
   *
   * A `data:` URI cannot fail for a network reason, so it is never retried; a
   * second attempt would just burn a render. The cache-busting parameter is
   * what makes the retry a real one — without it Chromium may serve the same
   * failed entry straight back.
   */
  const handleStatus = useCallback(
    (status: 'idle' | 'loading' | 'loaded' | 'error') => {
      if (status !== 'error' || !src || src.startsWith('data:') || retriedSrc) return;
      setRetry({ of: src, url: `${src}${src.includes('?') ? '&' : '?'}_retry=1` });
    },
    [src, retriedSrc],
  );

  return (
    <Avatar className={cn('shrink-0', className)}>
      {/* No `loading="lazy"`, deliberately: Radix's Avatar preloads through
          `new window.Image()` and forwards only `referrerPolicy`/`crossOrigin`,
          so the attribute would be inert and the comment beside it a lie. On
          the normal path there is no request to defer anyway — the src is an
          inlined `data:` URI. */}
      <AvatarImage
        src={retriedSrc ?? src ?? undefined}
        alt=""
        decoding="async"
        onLoadingStatusChange={handleStatus}
      />
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
  overtime = false,
  className,
}: CreatorChipProps) {
  const byId = useCreatorMap();

  // No `useMemo`: this is two property reads off a Map the store already built.
  // Memoising it would cost more than it saves.
  const hit = name === undefined ? byId.get(creatorId) : undefined;
  // Falling back to the id keeps a deleted or not-yet-loaded creator visible
  // rather than rendering an empty chip that looks like a rendering bug.
  const stageName = name ?? hit?.stageName ?? creatorId;
  const label = overtime ? `${stageName} — overtime, no extra pay` : stageName;

  const avatar = (
    <CreatorAvatar
      creatorId={creatorId}
      name={name}
      photoURL={photoURL}
      className={cn(
        AVATAR_SIZE[size],
        TEXT_SIZE[size],
        // `ring-offset` against the surface, so the ring reads as a border on
        // the face rather than merging into a neighbouring avatar in a dense row.
        overtime && 'ring-2 ring-orange-400 ring-offset-1 ring-offset-[#0A0A0A]',
      )}
    />
  );

  if (avatarOnly) {
    return (
      <span className={cn('inline-flex', className)} title={label}>
        {avatar}
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full bg-white/[0.08] py-px pl-px pr-2',
        className,
      )}
      title={label}
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
  overtimeIds,
  emptyLabel,
  className,
}: {
  creatorIds: string[];
  max?: number;
  size?: ChipSize;
  avatarOnly?: boolean;
  /**
   * Which of `creatorIds` are overtime the agent works unpaid. Pass a **stable**
   * array — an inline literal defeats the memo on every chip in the row.
   */
  overtimeIds?: string[];
  /** Rendered when there are no creators. Omit to render nothing at all. */
  emptyLabel?: string;
  className?: string;
}) {
  const byId = useCreatorMap();

  if (creatorIds.length === 0) {
    return emptyLabel ? <span className={cn('text-[11px] text-zinc-500', className)}>{emptyLabel}</span> : null;
  }

  // A Set per row, not a `.includes()` per chip. Cheap either way at these
  // sizes, but this row renders thirty-odd times on a month calendar.
  const overtime = overtimeIds && overtimeIds.length > 0 ? new Set(overtimeIds) : null;

  // Paid accounts first, so `max` truncates the overtime ones rather than the
  // ones that set the agent's rate — the count a reader is scanning for.
  const ordered = overtime
    ? [...creatorIds.filter(id => !overtime.has(id)), ...creatorIds.filter(id => overtime.has(id))]
    : creatorIds;

  const shown = max ? ordered.slice(0, max) : ordered;
  const hidden = ordered.slice(shown.length);

  const nameOf = (id: string) => byId.get(id)?.stageName ?? id;

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {shown.map(id => (
        <CreatorChip
          key={id}
          creatorId={id}
          size={size}
          avatarOnly={avatarOnly}
          overtime={overtime?.has(id) ?? false}
        />
      ))}
      {hidden.length > 0 && (
        <span
          className={cn('rounded-full bg-white/[0.08] px-1.5 py-px text-zinc-400', TEXT_SIZE[size])}
          title={hidden.map(id => (overtime?.has(id) ? `${nameOf(id)} (overtime)` : nameOf(id))).join(', ')}
        >
          +{hidden.length}
        </span>
      )}
    </span>
  );
});

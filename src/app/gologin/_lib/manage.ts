'use client';

import { useMemo } from 'react';
import { useUserData } from '@/hooks/useUserData';
import { SELECT_BOX_CLASS } from '@/lib/surfaces';
import {
  GOLOGIN_CAPABILITIES,
  usesMasterGoLoginToken,
  type GoLoginCapability,
  type GoLoginFolderRow,
} from '@/lib/gologin/types';

export type GoLoginCapabilities = Record<GoLoginCapability, boolean> & {
  isAdmin: boolean;
};

/**
 * Which management controls this person gets, from the live `users/{uid}`
 * snapshot — the same source `requireGoLoginCapability` checks on the server,
 * so a grant made on the Sharing page shows up here without a reload (rule 9c:
 * an ID-token claim would not).
 *
 * Client-side convenience only. Every route behind these re-checks (rule 3);
 * hiding a button is not the control.
 */
export function useGoLoginCapabilities(): GoLoginCapabilities {
  const { userData } = useUserData();
  const groups = userData?.groups;
  const permitted = userData?.permittedPageIds;
  return useMemo(() => {
    // Admins run the workspace on the master token, so they hold every
    // capability whatever the Sharing page says — revoking a row must never lock
    // out the only people who can administer the workspace.
    const isAdmin = usesMasterGoLoginToken({ groups });
    const has = (cap: GoLoginCapability) => isAdmin || permitted?.includes(GOLOGIN_CAPABILITIES[cap]) === true;
    return {
      isAdmin,
      members: has('members'),
      profiles: has('profiles'),
      folders: has('folders'),
      sharing: has('sharing'),
    };
  }, [groups, permitted]);
}

/**
 * Who has a profile open right now — derived once, in the page, from the local
 * session map and the live lock snapshot. `self` is a fact, not a display
 * string, so each surface words it for itself.
 */
export interface ProfileHolder {
  self: boolean;
  name: string;
}

/** "You have" / "Kai has" — the subject of every "…this profile open" sentence. */
export function holderHas(holder: ProfileHolder): string {
  return holder.self ? 'You have' : `${holder.name} has`;
}

/** A user-facing folder as the management routes return it. */
export type ManagedFolder = GoLoginFolderRow;

/** A checked `Checkbox` inked Action Blue Deep — the shared recipe (DESIGN.md §2). */
export const CHECKBOX_ON = SELECT_BOX_CLASS;

/** The house segmented-control on-state (DESIGN.md §5, ToggleGroup). */
export const SEGMENT_ITEM =
  'text-xs data-[state=on]:bg-[#2563eb]! data-[state=on]:font-medium data-[state=on]:text-white!';

/** The shared field recipe (DESIGN.md §5, Inputs). */
export const FIELD = 'border-zinc-700 bg-zinc-800';

/** A form label: 12px Ink Secondary above its control. */
export const LABEL = 'mb-1 block text-xs font-medium text-zinc-400';

/** Filled primary for a satellite window (DESIGN.md §2 — fill at #2563eb). */
export const PRIMARY_BUTTON = 'bg-[#2563eb] text-white hover:bg-[#1d4ed8]';

/** The one destructive fill. */
export const DANGER_BUTTON = 'bg-red-600 text-white hover:bg-red-700';

/** Local to this window; the salary and prompt-library `pluralise` helpers live in their own domains. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

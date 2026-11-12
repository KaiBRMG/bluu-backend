/**
 * OnlyMonster identity → Bluu identity. Pure.
 *
 * - **Account → creator or sub-account** by handle, against Bluu accounts whose
 *   `platform` is `'onlyfans'` **only** (decision 2026-11-11). A creator's
 *   handle is often the same on every platform (Noah Ryder is `@itsnoahryder`
 *   on OnlyFans and on Fansly), so without the filter that handle maps to two
 *   accounts and therefore to nobody. A Bluu account with no platform set is
 *   never a candidate either: that would be guessing.
 * - **Member → user** by email, folded exactly as login folds it.
 * - An admin's manual link wins over both and survives every sync.
 * - Anything else maps to nobody. Two candidates map to nobody.
 *
 * Archived users and creators still match: historical pay must still resolve.
 */
import { ONLYFANS_PLATFORM } from '../creators/accountPlatform';

/**
 * `@Handle`, `handle`, `onlyfans.com/handle`, `https://onlyfans.com/handle/` →
 * `handle`. The same fold as BuddyX's (`lib/buddyx/mapping.ts`), held here so
 * this module survives BuddyX's removal (migration plan §9.1).
 */
export function foldHandle(raw: string | null | undefined): string {
  let text = (raw ?? '').trim().toLowerCase();
  text = text.replace(/^https?:\/\//, '').replace(/^(www\.)?onlyfans\.com\//, '');
  text = text.replace(/^@+/, '').replace(/\/+$/, '');
  return text;
}

export type AccountMatch = 'handle' | 'manual' | 'none';
export type MemberMatch = 'email' | 'manual' | 'none';

export interface BluuAccountForMatch {
  /** A `creators` uid or a `creator-subaccounts` id (rule 9h). */
  id: string;
  stageName: string;
  OFID: string | null;
  platform: string | null;
}

/**
 * Handle → account id, OnlyFans accounts only. A handle claimed by two OnlyFans
 * accounts maps to `null`, so it resolves to nobody.
 */
export function buildOnlyFansHandleIndex(accounts: BluuAccountForMatch[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const a of accounts) {
    if (a.platform !== ONLYFANS_PLATFORM) continue;
    const key = foldHandle(a.OFID);
    if (!key) continue;
    out.set(key, out.has(key) ? null : a.id);
  }
  return out;
}

export interface ResolvedAccount {
  creatorId: string | null;
  creatorName: string | null;
  match: AccountMatch;
}

export function resolveAccount(
  account: { username: string | null; manualCreatorId?: string | null },
  handleIndex: Map<string, string | null>,
  accountsById: Map<string, BluuAccountForMatch>,
): ResolvedAccount {
  // A manual link to an account that has since been deleted is not a link.
  if (account.manualCreatorId && accountsById.has(account.manualCreatorId)) {
    const target = accountsById.get(account.manualCreatorId)!;
    return { creatorId: target.id, creatorName: target.stageName, match: 'manual' };
  }
  const id = handleIndex.get(foldHandle(account.username)) ?? null;
  if (!id) return { creatorId: null, creatorName: null, match: 'none' };
  return { creatorId: id, creatorName: accountsById.get(id)?.stageName ?? null, match: 'handle' };
}

/**
 * `resolveAccount`, plus the **numeric-id pin** (plan §4.2). Handles change and
 * the numeric OnlyFans account id does not. So once an account has matched a
 * creator by handle, a later run that no longer finds that match **keeps the
 * creator** while it is still the same `platformAccountId` and the creator still
 * exists on OnlyFans. Typical cause: the creator renamed their OnlyFans handle
 * before Bluu's OFID was updated. Without the pin their account would silently
 * flip to "nobody" and, from Phase 3 on, their sales with it.
 *
 * Never a silent switch: if the handle now points at a *different* creator, the
 * pinned creator is kept and a warning says so. A manual link still overrides
 * everything.
 */
export function resolveAccountPinned(
  account: { username: string | null; platformAccountId: string; manualCreatorId?: string | null },
  prev: { creatorId: string | null; match: AccountMatch; platformAccountId: string } | undefined,
  handleIndex: Map<string, string | null>,
  accountsById: Map<string, BluuAccountForMatch>,
): ResolvedAccount & { warning: string | null } {
  const fresh = resolveAccount(account, handleIndex, accountsById);
  if (fresh.match === 'manual') return { ...fresh, warning: null };

  const pinned = prev?.match === 'handle' && prev.creatorId ? accountsById.get(prev.creatorId) : undefined;
  const pinHolds = pinned && prev!.platformAccountId === account.platformAccountId && pinned.platform === ONLYFANS_PLATFORM;
  if (!pinHolds || fresh.creatorId === pinned.id) return { ...fresh, warning: null };

  return {
    creatorId: pinned.id,
    creatorName: pinned.stageName,
    match: 'handle',
    warning:
      fresh.creatorId === null
        ? `@${account.username ?? '?'} no longer matches ${pinned.stageName}'s OFID; kept by OnlyFans account id. Update the OFID in Creator Management.`
        : `@${account.username ?? '?'} now matches ${fresh.creatorName ?? fresh.creatorId}, but is ${pinned.stageName}'s account by OnlyFans account id; kept ${pinned.stageName}. Link it manually if it really moved.`,
  };
}

export interface BluuUserForMatch {
  uid: string;
  workEmail: string;
}

/** Email → uid. An address two users share maps to `null` (nobody). */
export function buildMemberEmailIndex(users: BluuUserForMatch[], normalise: (email: string) => string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const u of users) {
    const key = normalise(u.workEmail ?? '');
    if (!key) continue;
    out.set(key, out.has(key) ? null : u.uid);
  }
  return out;
}

export function resolveMember(
  member: { email: string | null; manualUid?: string | null },
  emailIndex: Map<string, string | null>,
  normalise: (email: string) => string,
  knownUids: Set<string>,
): { uid: string | null; match: MemberMatch } {
  if (member.manualUid && knownUids.has(member.manualUid)) return { uid: member.manualUid, match: 'manual' };
  const key = member.email ? normalise(member.email) : '';
  const uid = key ? emailIndex.get(key) ?? null : null;
  return uid ? { uid, match: 'email' } : { uid: null, match: 'none' };
}

/**
 * Whether a directory list came back suspiciously empty. Run 1 of the Phase 0
 * probe once got 0 members where the next run got 9, so an empty list while
 * stored docs exist must never unmap anyone.
 */
export function isSuspectEmpty(fetched: number, stored: number): boolean {
  return fetched === 0 && stored > 0;
}

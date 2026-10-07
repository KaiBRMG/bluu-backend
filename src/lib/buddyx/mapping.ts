/**
 * BuddyX identity → Bluu identity. Pure, so it is tested without Firestore.
 *
 * Two joins, and neither ever guesses:
 *
 * - **Chatter → user** by email, folded exactly as login folds it
 *   (`normalizeEmail`). Never by name: two agents can share a first name, and a
 *   name match would pay one of them for the other's work.
 * - **Model → creator** by OnlyFans handle, against `creators.OFID` **and**
 *   `creator-subaccounts.OFID` — a sub-account can be an OnlyFans account in
 *   its own right (rule 9h).
 *
 * An admin's manual link wins over either match, and an unmatched identity
 * resolves to `null` and is reported on the mapping screen rather than dropped.
 * Archived users and creators still match: historical pay must still resolve.
 */

export type ChatterMatch = 'email' | 'manual' | 'none';
export type ModelMatch = 'handle' | 'manual' | 'none';

/**
 * `@Handle`, `handle`, `onlyfans.com/handle`, `https://onlyfans.com/handle/` →
 * `handle`. OFIDs are typed by hand in Creator Management, so every spelling
 * that has been seen there folds to one key.
 */
export function foldHandle(raw: string | null | undefined): string {
  let text = (raw ?? '').trim().toLowerCase();
  text = text.replace(/^https?:\/\//, '').replace(/^(www\.)?onlyfans\.com\//, '');
  text = text.replace(/^@+/, '').replace(/\/+$/, '');
  return text;
}

export interface UserForMatch {
  uid: string;
  workEmail: string;
}

/** Build the email → uid index once per run. */
export function buildEmailIndex(users: UserForMatch[], normalise: (email: string) => string): Map<string, string> {
  const out = new Map<string, string>();
  for (const user of users) {
    const key = normalise(user.workEmail ?? '');
    if (key) out.set(key, user.uid);
  }
  return out;
}

export function resolveChatter(
  chatter: { email: string | null; manualUid?: string | null },
  emailIndex: Map<string, string>,
  normalise: (email: string) => string,
  knownUids?: Set<string>,
): { uid: string | null; match: ChatterMatch } {
  // A manual link to a user who has since been deleted is not a link.
  if (chatter.manualUid && (!knownUids || knownUids.has(chatter.manualUid))) {
    return { uid: chatter.manualUid, match: 'manual' };
  }
  const key = chatter.email ? normalise(chatter.email) : '';
  const uid = key ? emailIndex.get(key) ?? null : null;
  return uid ? { uid, match: 'email' } : { uid: null, match: 'none' };
}

export interface CreatorForMatch {
  id: string;
  stageName: string;
  OFID?: string | null;
}

/**
 * Build the handle → creator index. A handle claimed by two records (a creator
 * and a sub-account both typed `@cole`) is **ambiguous** and maps to nobody:
 * resolving it either way would put one account's revenue on the other.
 */
export function buildHandleIndex(creators: CreatorForMatch[]): Map<string, CreatorForMatch | null> {
  const out = new Map<string, CreatorForMatch | null>();
  for (const creator of creators) {
    const key = foldHandle(creator.OFID);
    if (!key) continue;
    out.set(key, out.has(key) ? null : creator);
  }
  return out;
}

export function resolveModel(
  model: { handle: string | null; manualCreatorId?: string | null },
  handleIndex: Map<string, CreatorForMatch | null>,
  creatorsById: Map<string, CreatorForMatch>,
): { creatorId: string | null; creatorName: string | null; match: ModelMatch } {
  if (model.manualCreatorId) {
    const creator = creatorsById.get(model.manualCreatorId);
    if (creator) return { creatorId: creator.id, creatorName: creator.stageName, match: 'manual' };
  }
  const hit = handleIndex.get(foldHandle(model.handle));
  return hit
    ? { creatorId: hit.id, creatorName: hit.stageName, match: 'handle' }
    : { creatorId: null, creatorName: null, match: 'none' };
}

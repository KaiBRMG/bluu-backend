/**
 * GoLogin service — authorization, and the one place the provider is paged.
 *
 * What makes this worth a service rather than a route body is the **rate limit**,
 * which GoLogin enforces by permanently revoking the API token on a 429 (see the
 * header of `providers/gologinApi.ts`). Listing profiles is inherently N
 * requests, so every walk here is bounded, memoised, de-duplicated in flight,
 * and floor-limited even when the operator asks for a refresh.
 *
 * **The memo is keyed per operator now.** Each operator holds their own GoLogin
 * token and therefore their own request budget and their own visible set of
 * profiles; one shared cache would both leak another operator's profiles and
 * charge the wrong account. The master walk (admin surfaces only) is kept
 * separately, under its own key.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import {
  getMasterGoLoginClient,
  getUserGoLoginClient,
  GoLoginApiError,
  PROFILES_PER_PAGE,
  type GoLoginProfile,
  type IGoLoginClient,
} from '@/lib/gologin';
import {
  getGoLoginAccount,
  getGoLoginUserToken,
  getMasterAccount,
  getMembershipStatus,
  invalidateMasterAccount,
  isGoLoginAdmin,
  resolveFolder,
} from '@/lib/services/gologinAccountService';

/** Page permission that gates every GoLogin surface. */
export const GOLOGIN_PAGE_ID = 'apps-gologin';

/**
 * Tier-2 gate for every GoLogin route. Returns a 403 response when denied,
 * null when allowed — same contract as `checkPageAccess`.
 */
export function requireGoLoginAccess(uid: string): Promise<NextResponse | null> {
  return checkPageAccess(uid, GOLOGIN_PAGE_ID);
}

/**
 * The **second** gate, and the one that is specific to GoLogin.
 *
 * `apps-gologin` can be granted to anyone on `/admin-portal/sharing`, and that
 * grant says nothing about whether GoLogin will accept them — a free GoLogin
 * account cannot even generate an API token, only a paid workspace member can.
 * So holding the page is necessary and not sufficient: an admin must also have
 * granted a seat.
 *
 * Returns 403 with `code: 'not-a-member'`, which the window renders as "ask an
 * admin" rather than as a permissions error. **This gates the onboarding screen
 * too** — walking someone through fetching a token they cannot generate is a
 * worse experience than telling them they have not been added yet.
 *
 * **Admins are exempt, and it is not a shortcut.** A Bluu admin operates on the
 * master token — they run the workspace rather than holding a slice of it — so
 * there is no member record to find and nothing a seat would add. See
 * `usesMasterGoLoginToken`.
 */
export async function requireGoLoginMember(uid: string): Promise<NextResponse | null> {
  try {
    const { member } = await getMembershipStatus(uid);
    if (member) return null;
  } catch (err) {
    // A provider outage must not read as "you were removed from the workspace".
    console.error('[gologin] membership check failed', err);
    return NextResponse.json(
      { error: 'Could not check your GoLogin membership. Try again shortly.', code: 'member-check-failed' },
      { status: 503 },
    );
  }
  return NextResponse.json(
    {
      error: 'You have not been added to the GoLogin workspace yet. Ask an admin to add you.',
      code: 'not-a-member',
    },
    { status: 403 },
  );
}

/** Both gates, in the order their failures should be reported. */
export async function requireGoLogin(uid: string): Promise<NextResponse | null> {
  return (await requireGoLoginAccess(uid)) ?? (await requireGoLoginMember(uid));
}

/**
 * Tier-3 gate for the Management routes.
 *
 * **Why this is not a bare `token.admin` check.** `setCustomUserClaims` does not
 * reach an ID token that has already been issued, and the Electron renderer
 * routinely runs for weeks without a reload (CLAUDE.md rule 9c). Meanwhile the
 * Management button renders off `userData.groups`, which is live over
 * `onSnapshot`. The two therefore drift, and the drift is one-directional and
 * user-visible: the button appears and every route behind it answers
 * "Admins only". That was reported on 2026-09-11 with the claim correctly set
 * server-side the whole time.
 *
 * So the claim is kept as the **fast path** and the `admin` group is the
 * fallback. This is not a weakening: the claim is *derived* from that group by
 * `/api/auth/exchange-code`, so the group is the source of truth and
 * `getUserById` is cached for 60s. It also collapses the two definitions of
 * "admin" this feature had into one — `usesMasterGoLoginToken` already decided
 * master-token access from the group, so an admin could be handed the master
 * token and refused by the admin routes in the same session.
 */
export async function requireGoLoginAdmin(token: {
  uid: string;
  admin?: unknown;
}): Promise<NextResponse | null> {
  if (token.admin === true) return null;
  if (await isGoLoginAdmin(token.uid)) return null;
  return NextResponse.json({ error: 'Admins only.' }, { status: 403 });
}

/** How long a listing is served without touching the provider at all. */
const CACHE_TTL_MS = 60 * 1000;

/**
 * The floor under `?refresh=1`. A refresh costs one request per 30 profiles, so
 * a held-down button is the realistic way to reach 429 — and 429 here is not a
 * throttle, it is the token being destroyed. Inside this window a refresh
 * silently serves the memo.
 */
const FORCE_MIN_INTERVAL_MS = 15 * 1000;

/**
 * Hard stop on the walk: 40 pages × 30 = 1200 profiles. A bound is required, not
 * defensive dressing — a provider that kept returning full pages would otherwise
 * loop until the token is revoked.
 */
const MAX_PAGES = 40;

/**
 * Ceiling on the per-operator memo. A serverless instance serves a handful of
 * people, but an unbounded module-scope Map is a leak by construction.
 */
const MAX_CACHE_ENTRIES = 50;

export interface GoLoginProfileList {
  profiles: GoLoginProfile[];
  /** The provider's own count, which can exceed `profiles.length` at the cap. */
  total: number;
  /** True when MAX_PAGES stopped the walk before the provider ran out. */
  truncated: boolean;
  fetchedAtMs: number;
}

const cache = new Map<string, GoLoginProfileList>();
/** In-flight walks, so two requests for one key make one set of calls. */
const inFlight = new Map<string, Promise<GoLoginProfileList>>();

async function walkProfiles(client: IGoLoginClient): Promise<GoLoginProfileList> {
  const profiles: GoLoginProfile[] = [];
  const seen = new Set<string>();
  let total = 0;
  let truncated = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    // Strictly sequential. Fanning these out with Promise.all is what turns a
    // large workspace into a burst the provider counts against the minute.
    const result = await client.listProfiles(page);
    total = result.total;
    for (const profile of result.profiles) {
      // Ids repeat if a profile moves between pages mid-walk.
      if (seen.has(profile.id)) continue;
      seen.add(profile.id);
      profiles.push(profile);
    }
    if (result.profiles.length < PROFILES_PER_PAGE) break;
    if (page === MAX_PAGES) truncated = true;
  }

  return { profiles, total: Math.max(total, profiles.length), truncated, fetchedAtMs: Date.now() };
}

function readCache(key: string, force: boolean): GoLoginProfileList | null {
  const hit = cache.get(key);
  if (!hit) return null;
  const age = Date.now() - hit.fetchedAtMs;
  return (force ? age < FORCE_MIN_INTERVAL_MS : age < CACHE_TTL_MS) ? hit : null;
}

function memoise(key: string, client: IGoLoginClient, force: boolean): Promise<GoLoginProfileList> {
  const hit = readCache(key, force);
  if (hit) return Promise.resolve(hit);

  const running = inFlight.get(key);
  if (running) return running;

  const walk = walkProfiles(client)
    .then((result) => {
      // Oldest-first eviction. Map preserves insertion order, so the first key
      // is the least recently *written* — good enough for a bound this size.
      if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, result);
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, walk);
  return walk;
}

/** Thrown when an operator has not linked a personal GoLogin account yet. */
export class GoLoginNotLinkedError extends Error {
  constructor() {
    super('No GoLogin account is linked to this user.');
    this.name = 'GoLoginNotLinkedError';
  }
}

/**
 * The profiles **one operator** can see: everything shared into their own
 * GoLogin account, as GoLogin itself decides it.
 *
 * There is no `where` clause here and there must never be one. The operator's
 * own token is the filter, which means a bug in our code cannot widen what they
 * see — the worst it can do is fail closed.
 */
export async function listGoLoginProfilesForUser(
  uid: string,
  force = false,
): Promise<GoLoginProfileList> {
  const token = await getGoLoginUserToken(uid);
  if (!token) throw new GoLoginNotLinkedError();
  return memoise(`u:${uid}`, getUserGoLoginClient(token), force);
}

/**
 * Every profile in the master workspace. **Admin surfaces only** — this is the
 * assignment picker's source, and it is the whole company's profile list.
 */
export async function listGoLoginProfilesForMaster(force = false): Promise<GoLoginProfileList> {
  return memoise('master', getMasterGoLoginClient(), force);
}

/** Drops one operator's memo, so their next read reflects a just-changed assignment. */
export function invalidateGoLoginProfiles(uid?: string): void {
  if (uid) cache.delete(`u:${uid}`);
  else cache.clear();
}

// ─── Assignment (admin) ─────────────────────────────────────────────

export interface AssignmentChange {
  /** The Bluu uid whose folder is being changed. */
  uid: string;
  profileIds: string[];
  action: 'add' | 'remove';
}

/**
 * Add or remove profiles from an operator's shared folder — the entirety of
 * "grant/revoke access to a profile" under this model.
 *
 * The folder's **current** name is resolved from the master account first,
 * because `PATCH /folders/folder` is addressed by name and a human can rename a
 * folder in GoLogin's dashboard at any time. Using the stored name would target
 * a folder that no longer exists, or one that has since taken the old name.
 */
export async function changeAssignment({ uid, profileIds, action }: AssignmentChange): Promise<void> {
  const ids = [...new Set(profileIds.filter((id) => typeof id === 'string' && id.length >= 6))];
  if (!ids.length) return;

  if (await isGoLoginAdmin(uid)) {
    // Admins have no folder because they see every profile already. Silently
    // doing nothing would let one admin believe they had revoked another's
    // access to something, which is not a thing that can happen.
    throw new GoLoginApiError(
      'Admins see every profile; there is nothing to assign or revoke.',
      409,
    );
  }

  const account = await getGoLoginAccount(uid);
  if (!account?.folderId) throw new GoLoginNotLinkedError();

  // `force` on a miss only: the folder is almost always in the 60s memo, and a
  // rename is rare enough not to justify a provider request per assignment.
  const folder = (await resolveFolder(account.folderId)) ?? (await resolveFolder(account.folderId, true));
  if (!folder) {
    throw new GoLoginApiError(
      'That operator\'s folder no longer exists in GoLogin. Ask them to re-link their account.',
      409,
    );
  }

  await getMasterGoLoginClient().setFolderProfiles(folder.name, ids, action);

  // Membership just changed, so both the folder tree and that operator's own
  // listing are stale. Everyone else's is untouched.
  invalidateMasterAccount();
  invalidateGoLoginProfiles(uid);
}

/** The folder tree as the master sees it, for the Management surface. */
export async function getAssignmentOverview(force = false) {
  return getMasterAccount(force);
}

/**
 * Assign (or unassign) **every profile in a source folder** at once.
 *
 * ⚠ **This is a copy, not a subscription, and the UI must not imply otherwise.**
 * It expands the folder to its current members and adds those profiles to the
 * operator's own folder. A profile added to the source folder *afterwards* does
 * not reach them: GoLogin offers no webhook, so keeping the two in step would
 * mean polling, and polling is the one thing that reliably destroys the API
 * token (rule 9e).
 *
 * The **server** expands the folder rather than the client sending a list of
 * ids. Two reasons: the expansion is read from the already-memoised master
 * account, so it costs nothing; and it keeps a 90-profile folder from tripping
 * the per-request batch cap that exists to bound hand-picked selections.
 */
export async function changeAssignmentFromFolder(params: {
  uid: string;
  sourceFolderId: string;
  action: 'add' | 'remove';
}): Promise<{ moved: number }> {
  const { uid, sourceFolderId, action } = params;

  // `force` on a miss only — the folder is almost always in the 60s memo.
  const folder =
    (await resolveFolder(sourceFolderId)) ?? (await resolveFolder(sourceFolderId, true));
  if (!folder) {
    throw new GoLoginApiError('That folder no longer exists in GoLogin.', 409);
  }
  if (!folder.profileIds.length) return { moved: 0 };

  await changeAssignment({ uid, profileIds: folder.profileIds, action });
  return { moved: folder.profileIds.length };
}

/**
 * Maps an adapter error onto the response the route should send.
 *
 * `context` names the operation, and it is not decoration. This helper is shared
 * by every GoLogin route, and its fallback message used to be "Could not load
 * GoLogin profiles." regardless of caller — so a failure while *adding a member*
 * reported a profile-loading problem, which is the kind of wrong that sends
 * someone debugging the wrong subsystem entirely. Pass what the route was doing.
 *
 * An unrecognised error also carries its own message through now. These routes
 * are staff-only and admin-gated, and the alternative is what happened here: a
 * Firestore `FAILED_PRECONDITION` (a missing index, with the fix in its text)
 * flattened into six generic words.
 */
export function goLoginErrorResponse(err: unknown, context = 'complete that GoLogin request'): NextResponse {
  if (err instanceof GoLoginNotLinkedError) {
    // 428 Precondition Required: the client's move is to run onboarding, which is
    // a different thing from "forbidden" and must not read as one.
    return NextResponse.json({ error: err.message, code: 'not-linked' }, { status: 428 });
  }
  if (err instanceof GoLoginApiError) {
    console.error('[gologin]', err.status, err.message);
    // The one provider failure with a remedy the operator owns: their key is no
    // longer accepted. 401 is a rejected token; 429 is the rate limit, which
    // GoLogin answers by *revoking* the token, so both end in the same place —
    // a new key. Coded rather than left as prose, because the client's response
    // is a different screen (Replace key), not a Retry button that cannot work.
    const code = err.status === 401 || err.status === 429 ? 'invalid-token' : undefined;
    return NextResponse.json(
      code ? { error: err.message, code } : { error: err.message },
      { status: err.status },
    );
  }
  console.error(`[gologin] unexpected error while trying to ${context}:`, err);
  const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
  return NextResponse.json({ error: `Could not ${context}.${detail}` }, { status: 500 });
}

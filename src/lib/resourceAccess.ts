/**
 * Who may read and who may manage a resource in the `app-resources` collection.
 *
 * This is the single source of truth for the resource access matrix. It is
 * deliberately client-safe (no server-only imports) so the merged Resources page
 * can gate the "New" button and the per-row options menu with exactly the same
 * rules the API enforces. **The UI copy of these checks is cosmetic — the server
 * check in `/api/resources` is the real one.**
 *
 * ```
 * group   reads                writes
 * CA      CA                   —
 * SMM     SMM                  —
 * OFAM    CA, SMM, OFAM        CA, SMM
 * admin   everything           everything
 * ```
 *
 * A group not named here (`unassigned`, or any group added later) keeps the
 * pre-merge behaviour: it reads its own group's resources and writes nothing.
 */
import type { ResourceDocument } from '@/types/resource';

/** The caller, reduced to the only three things access depends on. */
export interface ResourceActor {
  uid: string;
  groups: string[];
  /** `token.admin` claim, or `admin` group membership. */
  isAdmin: boolean;
}

/** Groups whose resources each group may read, beyond its own. */
const READ_SCOPE: Record<string, string[]> = {
  CA: ['CA'],
  SMM: ['SMM'],
  OFAM: ['CA', 'SMM', 'OFAM'],
};

/** Groups whose resources each group may create, edit and delete. */
const WRITE_SCOPE: Record<string, string[]> = {
  OFAM: ['CA', 'SMM'],
};

/**
 * Every group an admin can tag a resource with. `admin` is included so an
 * admin-only resource stays expressible, as it was before the merge.
 */
export const ADMIN_WRITABLE_GROUPS = ['CA', 'SMM', 'OFAM', 'admin'];

export function buildResourceActor(
  uid: string,
  groups: string[] | undefined | null,
  hasAdminClaim: boolean
): ResourceActor {
  const list = groups ?? [];
  return { uid, groups: list, isAdmin: hasAdminClaim || list.includes('admin') };
}

/**
 * Group ids whose resources the actor may see. Meaningless for an admin — check
 * `actor.isAdmin` first, they bypass group filtering entirely.
 */
export function getReadableGroups(actor: ResourceActor): Set<string> {
  const out = new Set<string>();
  for (const g of actor.groups) {
    for (const target of READ_SCOPE[g] ?? [g]) out.add(target);
  }
  return out;
}

/** Group ids whose resources the actor may create, edit and delete. */
export function getWritableGroups(actor: ResourceActor): Set<string> {
  if (actor.isAdmin) return new Set(ADMIN_WRITABLE_GROUPS);
  const out = new Set<string>();
  for (const g of actor.groups) {
    for (const target of WRITE_SCOPE[g] ?? []) out.add(target);
  }
  return out;
}

/** True when the actor may manage at least one group's resources. */
export function canManageResources(actor: ResourceActor): boolean {
  return actor.isAdmin || getWritableGroups(actor).size > 0;
}

/**
 * Strict subset rule: a non-admin may only write a resource when **every** group
 * on it falls inside their writable set.
 *
 * This is what stops an OFAM user editing (or re-tagging themselves into) a
 * resource that carries `OFAM`, `admin`, or no group at all. It is applied to
 * both the stored groups and the incoming ones on an update, so a permitted
 * resource cannot be escalated out of reach on the way through.
 */
export function canWriteGroups(groups: string[], actor: ResourceActor): boolean {
  if (actor.isAdmin) return true;
  const writable = getWritableGroups(actor);
  if (writable.size === 0) return false;
  // An untagged resource is admin-only — there is no scope to check it against.
  if (groups.length === 0) return false;
  return groups.every(g => writable.has(g));
}

/** Whether the actor may edit or delete this stored resource. */
export function canWriteResource(
  doc: Pick<ResourceDocument, 'groups'>,
  actor: ResourceActor
): boolean {
  return canWriteGroups(doc.groups, actor);
}

/**
 * Whether the actor may see this resource at all, ignoring status.
 * Group overlap **or** an explicit uid grant, as before the merge.
 */
export function canReadResource(
  doc: Pick<ResourceDocument, 'groups' | 'users'>,
  actor: ResourceActor
): boolean {
  if (actor.isAdmin) return true;
  const readable = getReadableGroups(actor);
  return doc.groups.some(g => readable.has(g)) || doc.users.includes(actor.uid);
}

/** The one status that readers are ever shown. */
export const ACTIVE_STATUS = 'Active';

export function isUnlisted(doc: Pick<ResourceDocument, 'status'>): boolean {
  return doc.status !== ACTIVE_STATUS;
}

/**
 * **Write access is the only thing that reveals an `Unlisted` resource.**
 *
 * Read access — group overlap or an explicit `users[]` grant — never does, no
 * matter how the resource is tagged. An OFAM user therefore sees Unlisted CA and
 * SMM resources (they manage those) but not Unlisted OFAM ones (they only read
 * those), which is the whole point of keeping the two scopes separate.
 */
export function canSeeUnlistedResource(
  doc: Pick<ResourceDocument, 'groups'>,
  actor: ResourceActor
): boolean {
  return canWriteResource(doc, actor);
}

/**
 * What the merged Resources page lists for this actor: Active resources within
 * their read scope, plus the resources they can manage at any status.
 */
export function isResourceVisible(doc: ResourceDocument, actor: ResourceActor): boolean {
  if (isUnlisted(doc)) return canSeeUnlistedResource(doc, actor);
  // Every writable scope sits inside its readable one today; the `canWrite` arm
  // is there so a future matrix row cannot hide a resource from the person
  // responsible for it.
  return canReadResource(doc, actor) || canWriteResource(doc, actor);
}

/**
 * Apply the visibility rule to a list.
 *
 * Run on the server (the real gate) **and** again on the client, because the
 * sessionStorage payload is not namespaced by uid and nothing clears it on
 * logout — a second user in the same tab must not inherit the first one's
 * Unlisted rows from a cache hit.
 */
export function filterVisibleResources(
  docs: ResourceDocument[],
  actor: ResourceActor
): ResourceDocument[] {
  return docs.filter(d => isResourceVisible(d, actor));
}

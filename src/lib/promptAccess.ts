/**
 * Prompt Library access resolution. Pure and client-safe — the server filters
 * with it and the Share dialog uses the same vocabulary.
 *
 * The organisation owns every prompt: an admin is an implicit owner of all of
 * them and is never stored as a grant. Everyone else holds a `view` or `edit`
 * grant, directly or through a group; the highest wins, and group grants are
 * resolved at read time so joining a group later grants access.
 */
import { buildResourceActor, type ResourceActor } from '@/lib/resourceAccess';
import type { PromptAccess, PromptRole } from '@/types/promptLibrary';

/** The same identity the Resources page resolves: admin = the `token.admin`
 *  claim OR membership of the `admin` group. One definition, never re-typed. */
export type PromptViewer = ResourceActor;
export const buildPromptViewer = buildResourceActor;

/**
 * The grants a caller may be shown: editors get the map, viewers get none —
 * who else holds a grant is not theirs to know. The ONE place that rule lives.
 */
export function visibleAccess(access: PromptAccess, role: PromptRole): PromptAccess | null {
  return role === 'edit' ? access : null;
}

/** The role granted to the viewer by an explicit grant, ignoring admin status. */
export function grantedRole(access: PromptAccess, viewer: PromptViewer): PromptRole | null {
  let role: PromptRole | null = access.users[viewer.uid]?.role ?? null;
  for (const g of viewer.groups) {
    const r = access.groups[g]?.role;
    if (r === 'edit') return 'edit';
    if (r === 'view' && role === null) role = 'view';
  }
  return role;
}

export interface ResolvedRole {
  role: PromptRole;
  /** Visible only because the viewer is an admin. */
  viaAdmin: boolean;
}

/** `null` means the prompt does not exist for this viewer. */
export function resolveRole(access: PromptAccess, viewer: PromptViewer): ResolvedRole | null {
  const granted = grantedRole(access, viewer);
  if (viewer.isAdmin) return { role: 'edit', viaAdmin: granted === null };
  return granted ? { role: granted, viaAdmin: false } : null;
}

const KEY_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** Map keys come from the client; keep them boring. */
export function isValidAccessKey(v: unknown): v is string {
  return typeof v === 'string' && KEY_RE.test(v);
}

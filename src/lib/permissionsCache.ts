import type { ResolvedAccess } from '@/types/firestore';
import type { TeamspaceDef } from '@/lib/definitions';

// Bumped to v2 with the Admin Portal / Creator Portal rename: a cached payload
// carries page `href`s and teamspace ids, so a warm v1 cache would keep serving
// the dead `/admin/*` and `/creators/*` links (and AppLayout's `startsWith(href)`
// access check would bounce the user off the new routes) for the full TTL.
// Bump this whenever a teamspace id or a page href changes in definitions.ts.
const CACHE_KEY = 'bluu_permissions_v2';
const PERMISSIONS_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface CachedPermissions {
  teamspaces: TeamspaceDef[];
  accessiblePages: ResolvedAccess[];
  permissionsVersion: number;
  cachedAt: number;
}

export function getCachedPermissions(): CachedPermissions | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPermissions;
    if (Date.now() - parsed.cachedAt > PERMISSIONS_TTL_MS) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setCachedPermissions(data: {
  teamspaces: TeamspaceDef[];
  accessiblePages: ResolvedAccess[];
  permissionsVersion: number;
}): void {
  try {
    const cached: CachedPermissions = {
      ...data,
      cachedAt: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch {
    // localStorage may be full or unavailable
  }
}

export function clearPermissionsCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

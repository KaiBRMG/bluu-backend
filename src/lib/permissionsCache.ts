import type { ResolvedAccess } from '@/types/firestore';
import type { TeamspaceDef } from '@/lib/definitions';

const CACHE_KEY = 'bluu_permissions_v1';

interface CachedPermissions {
  teamspaces: TeamspaceDef[];
  accessiblePages: ResolvedAccess[];
  cachedAt: number;
}

export function getCachedPermissions(): CachedPermissions | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedPermissions;
  } catch {
    return null;
  }
}

export function setCachedPermissions(data: { teamspaces: TeamspaceDef[]; accessiblePages: ResolvedAccess[] }): void {
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

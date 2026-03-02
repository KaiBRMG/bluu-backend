import type { ResolvedAccess } from '@/types/firestore';
import type { TeamspaceDef } from '@/lib/definitions';

const CACHE_KEY = 'bluu_permissions_v1';
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

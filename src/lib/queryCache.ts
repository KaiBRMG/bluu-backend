interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

export function getCache<T>(key: string, ttlMs: number): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - entry.cachedAt > ttlMs) {
      sessionStorage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function setCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, cachedAt: Date.now() };
    sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // QuotaExceededError or unavailable — cache miss on next read is safe
  }
}

export function invalidateCache(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function invalidateCacheByPrefix(prefix: string): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(prefix)) keysToRemove.push(k);
    }
    for (const k of keysToRemove) sessionStorage.removeItem(k);
  } catch {
    // ignore
  }
}

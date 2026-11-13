'use client';

import { useEffect, useState } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';

/**
 * The creators an OnlyFans account in OnlyMonster maps to — the dispute
 * dialog's picker (`/api/onlymonster/creators`). `null` while loading or after
 * a failed read; the picker then offers every creator.
 */
export function useMappedCreators(): string[] | null {
  const authFetch = useAuthFetch();
  const [ids, setIds] = useState<string[] | null>(null);
  useEffect(() => {
    authFetch('/api/onlymonster/creators')
      .then((body: { creatorIds: string[] }) => setIds(body.creatorIds))
      .catch(() => setIds(null));
  }, [authFetch]);
  return ids;
}

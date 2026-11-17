'use client';

import { useEffect, useState } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';

/**
 * Archived creator accounts that still belong in the sale pickers — their
 * archive month is not finalised, so their sales can still be disputed.
 * `[]` until loaded or on failure: the picker then behaves as it always did.
 */
export function useOpenArchivedCreators(): string[] {
  const authFetch = useAuthFetch();
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    authFetch('/api/ca-sales/archived-creators')
      .then((body: { creatorIds: string[] }) => setIds(body.creatorIds))
      .catch(() => setIds([]));
  }, [authFetch]);
  return ids;
}

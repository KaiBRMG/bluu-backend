'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import type { TrackPostsResult } from '@/hooks/useGrowthTracking';
import type { GrowthAccount } from '@/types/firestore';

/**
 * Opting an account into post discovery, with the copy that has to go with it.
 *
 * Post tracking is a **second, separate cost per account**: the nightly
 * discovery search pays the tweet scraper's 20-result floor for every opted-in
 * handle (RULE 1 in documentation/growth-tracking.md). The toast therefore says
 * what was armed rather than confirming silently — the discipline this feature
 * runs on is that the person switching it on sees what they switched on.
 *
 * Shared by the manage table and the account page because both offer the same
 * switch, and two copies of this wording is how one of them ends up describing a
 * schedule the system no longer runs.
 */
export function useTrackPosts(
  onSetTrackPosts: (id: string, trackPosts: boolean) => Promise<TrackPostsResult>,
) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const setTrackPosts = useCallback(async (account: GrowthAccount, trackPosts: boolean) => {
    setBusyId(account.id);
    try {
      const discovery = await onSetTrackPosts(account.id, trackPosts);

      if (!trackPosts) {
        toast.success(
          `Stopped finding new posts for @${account.handle}. Posts already tracked keep refreshing.`,
        );
      } else if (discovery?.error) {
        // The toggle saved; only the immediate search came up short. A warning,
        // not an error — nothing needs redoing and the nightly pass retries.
        toast.warning(discovery.error);
      } else if (discovery && discovery.created + discovery.refreshed > 0) {
        const found = discovery.created + discovery.refreshed;
        toast.success(`Tracking ${found} post${found === 1 ? '' : 's'} from @${account.handle}`, {
          description: 'New posts are picked up automatically from now on.',
        });
      } else {
        toast.success(`Finding new posts from @${account.handle} from tonight.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update that account.');
    } finally {
      setBusyId(null);
    }
  }, [onSetTrackPosts]);

  return { busyId, setTrackPosts };
}

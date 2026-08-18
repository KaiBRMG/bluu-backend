import { OnlyFansApiError } from '@/lib/onlyfans';
import { MediaNotCachedError } from '@/lib/services/onlyfansMediaCache';

/** What a failed media resolve is reported to the renderer as. */
export type MediaErrorCode = 'expired' | 'uncached' | 'failed';

/**
 * Distinguishes the three outcomes a tile renders differently: the source link
 * aged out (refresh the thread to get a fresh one), we have never cached this
 * file and were handed no link to fetch it with (show the metadata placeholder),
 * or something broke (offer a retry).
 *
 * Shared by both media routes so the two cannot drift — the renderer branches on
 * these strings in one place.
 */
export function mediaErrorCode(error: unknown): MediaErrorCode {
  if (error instanceof MediaNotCachedError) return 'uncached';
  if (error instanceof OnlyFansApiError && error.status === 403) return 'expired';
  return 'failed';
}

import { messageFlagHandler } from '@/app/api/onlyfans/_lib/messageFlagRoute';

/**
 * POST — pin a message to the top of its thread on OnlyFans.
 * DELETE — unpin it.
 *
 * Both mirror the provider's own verbs. See `_lib/messageFlagRoute.ts` for the
 * shared handler, and note the provider has **no unsend**: pin, unpin, like and
 * unlike are its entire per-message surface.
 */
export const POST = messageFlagHandler('pinned', true);
export const DELETE = messageFlagHandler('pinned', false);

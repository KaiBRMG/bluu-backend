import { messageFlagHandler } from '@/app/api/onlyfans/_lib/messageFlagRoute';

/**
 * POST — like a message. DELETE — unlike it.
 *
 * See `_lib/messageFlagRoute.ts` for the shared handler.
 */
export const POST = messageFlagHandler('liked', true);
export const DELETE = messageFlagHandler('liked', false);

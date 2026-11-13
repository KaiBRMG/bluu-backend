/**
 * GET /api/buddyx/creators — **compatibility alias, delete after 2026-11-30.**
 *
 * BuddyX is retired. A renderer loaded before that still asks here for the
 * dispute dialog's creator picker (rule 9c), so this answers with the same
 * shape from the OnlyMonster mapping (`/api/onlymonster/creators`).
 */
export { GET } from '@/app/api/onlymonster/creators/route';

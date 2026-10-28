/**
 * Fixed facts about the organization itself — not per-user, not configurable in
 * the app. Server-side readers only, so a change here reaches everyone on the
 * next deploy (no renderer-staleness concern, rule 9c).
 */

/**
 * The organization manager: receives the staff-lifecycle emails (a user added,
 * archived, access revoked or deleted) — see `lib/email/templates.ts`.
 */
export const ORGANIZATION_MANAGER_EMAIL = 'kai@bluurock.com';

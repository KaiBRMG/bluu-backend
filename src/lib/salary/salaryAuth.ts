/**
 * Authorisation tiers for the salary subsystem.
 *
 * Three tiers, deliberately not two (CLAUDE.md rule 3):
 *
 * | Tier | What it gates | Why |
 * |---|---|---|
 * | **Self** | An agent reading their own month | The whole point of the feature. Never widened by a query parameter. |
 * | **`ca-admin` page permission** | Running payroll: importing sales, editing a day, assigning cover | Day-to-day operations a CA manager does without being a full system admin. |
 * | **Admin claim** | Rate tables, finalising and reopening a month | Policy and money-locking. A rate change silently restates every agent's month; finalising decides what was paid. Neither should ride on a page permission an admin can grant in two clicks. |
 *
 * The claim tier reads `token.admin` rather than a Firestore document, which is
 * both the cheap check and the authoritative one (rule 9).
 */

import { NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { checkPageAccess } from '../middleware/apiHelpers';

/** The page permission that gates CA payroll operations. */
export const CA_ADMIN_PAGE_ID = 'ca-admin';

/** Operations tier. Returns a 403 response, or null when allowed. */
export async function requireCaAdmin(token: DecodedIdToken): Promise<NextResponse | null> {
  return checkPageAccess(token.uid, CA_ADMIN_PAGE_ID);
}

/** Policy tier. Returns a 403 response, or null when allowed. */
export function requireAdminClaim(token: DecodedIdToken): NextResponse | null {
  return token.admin === true
    ? null
    : NextResponse.json({ error: 'This action requires an administrator account.' }, { status: 403 });
}

/**
 * Self-or-CA-admin, for endpoints that serve both the agent and the payroll
 * screen.
 *
 * Defaults to the caller's own uid when `requestedUserId` is absent, so a
 * missing parameter can never widen the result — the failure mode of
 * `searchParams.get('userId')` returning null is "show me mine", not "show me
 * everyone's".
 */
export async function resolveSalarySubject(
  token: DecodedIdToken,
  requestedUserId: string | null,
): Promise<{ userId: string; isAdminView: boolean } | NextResponse> {
  if (!requestedUserId || requestedUserId === token.uid) {
    return { userId: token.uid, isAdminView: false };
  }
  const denied = await requireCaAdmin(token);
  if (denied) return denied;
  return { userId: requestedUserId, isAdminView: true };
}

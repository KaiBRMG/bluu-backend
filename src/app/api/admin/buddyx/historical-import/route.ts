/**
 * POST /api/admin/buddyx/historical-import  (multipart: `file`, `kind`, `dryRun?`)
 * GET  /api/admin/buddyx/historical-import  — recent import history
 *
 * The one-off Infloww import (documentation/buddyx.md §3.4): `kind=sales` for
 * the CA sales export, `kind=creator-stats` for the *Creator Statistics* export.
 * **Admin claim** (rule 3) — it rewrites pay history.
 *
 * This replaced `POST /api/ca-salary/import`, the `.xlsx` upload that used to
 * be the only source of sales. It refuses every row after the cutover, so it
 * can only ever fill in history BuddyX does not have. **Delete it** (with
 * `inflowwImportService.ts` and the "Historical import" block on CA Admin →
 * Sales) once the history has been imported and checked — §9 step 7.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireAdminClaim } from '@/lib/salary/salaryAuth';
import { getRecentImports } from '@/lib/services/caSalaryService';
import { getUserById } from '@/lib/services/userService';
import { importCreatorStats, importInflowwSales, XlsxError } from '@/lib/services/inflowwImportService';
import { announceTierCrossings } from '@/lib/services/tierNotices';
import type { DecodedIdToken } from 'firebase-admin/auth';

/** A year of sales is ~11k rows (~1.5MB); the stats export ~600KB. */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const maxDuration = 300;

export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = requireAdminClaim(token);
    if (denied) return denied;
    return NextResponse.json({ imports: await getRecentImports(20) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    return handleApiError(err, 'buddyx/historical-import GET');
  }
});

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = requireAdminClaim(token);
    if (denied) return denied;

    const form = await request.formData();
    const file = form.get('file');
    const kind = form.get('kind');
    const dryRun = form.get('dryRun') === 'true';

    if (kind !== 'sales' && kind !== 'creator-stats') {
      return NextResponse.json({ error: 'kind must be sales or creator-stats' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file was uploaded.' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'The uploaded file is empty.' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 15MB.` },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    try {
      if (kind === 'creator-stats') {
        return NextResponse.json({ dryRun, kind, stats: await importCreatorStats({ buffer, dryRun }) });
      }

      const actor = await getUserById(token.uid);
      const { result, touched } = await importInflowwSales({
        buffer,
        fileName: file.name,
        actorUid: token.uid,
        actorName: actor?.displayName ?? token.email ?? token.uid,
        dryRun,
      });
      // Pre-cutover history can still sit in an open month (October 1–4), so a
      // backfill can move a tier. After the response, never in front of it.
      if (touched.length > 0) after(() => announceTierCrossings(new Set(touched)));
      return NextResponse.json({ dryRun, kind, result });
    } catch (err) {
      if (err instanceof XlsxError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }
  } catch (err) {
    return handleApiError(err, 'buddyx/historical-import POST');
  }
});

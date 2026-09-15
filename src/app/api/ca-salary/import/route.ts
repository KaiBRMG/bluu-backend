/**
 * POST /api/ca-salary/import  (multipart/form-data: `file`, `dryRun?`)
 * GET  /api/ca-salary/import  — recent import history
 *
 * The manual bridge until sales come from OF Manager. An admin exports from the
 * third-party sales tool and uploads the `.xlsx`; this resolves each row to a
 * Bluu Backend account and writes it.
 *
 * ## Two properties worth stating plainly
 *
 * **Re-uploading is safe.** Sale ids are content hashes, so an export that
 * overlaps the last one rewrites the same documents. The response separates
 * `imported` from `duplicates` precisely so an admin can see that a re-upload
 * did nothing, rather than wondering whether it doubled a month.
 *
 * **Nothing is dropped silently.** A row that cannot be resolved is reported
 * with its reason, its count and sample row numbers. The known case is an agent
 * who has left the company and has no account — their rows skip, and the report
 * names the address so it is a decision rather than a mystery.
 *
 * `dryRun` runs the whole parse and reports what *would* happen without writing,
 * which is what the upload screen shows before an admin confirms.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireCaAdmin } from '@/lib/salary/salaryAuth';
import { readXlsxSheet, XlsxError } from '@/lib/salary/xlsx';
import { parseSalesSheet, buildUserResolver } from '@/lib/salary/salesImport';
import { normalizeEmail } from '@/lib/authEmail';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import {
  writeSales,
  recordImport,
  getRecentImports,
  getFinalizedMonthsFor,
} from '@/lib/services/caSalaryService';
import { round2 } from '@/lib/salary/salaryEngine';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { SalesImportResult } from '@/lib/salary/salaryTypes';

/** Generous for a month of sales, small enough that a wrong file fails fast. */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await requireCaAdmin(token);
    if (denied) return denied;

    const limit = Math.min(50, Math.max(1, Number(new URL(request.url).searchParams.get('limit') ?? 20)));
    return NextResponse.json({ imports: await getRecentImports(limit) });
  } catch (err) {
    return handleApiError(err, 'ca-salary/import GET');
  }
});

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await requireCaAdmin(token);
    if (denied) return denied;

    const form = await request.formData();
    const file = form.get('file');
    const dryRun = form.get('dryRun') === 'true';

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

    // ── Parse ──
    let parsed;
    let sheet;
    const importId = adminDb.collection('ca-sales-imports').doc().id;

    try {
      sheet = readXlsxSheet(buffer);

      // Registered users, for email resolution. One query; the roster is small.
      const usersSnap = await adminDb.collection('users').get();
      const users = usersSnap.docs
        .map(d => d.data())
        .filter(u => u.isArchived !== true && typeof u.workEmail === 'string')
        .map(u => ({ uid: u.uid, workEmail: u.workEmail, displayName: u.displayName ?? u.uid }));

      parsed = parseSalesSheet(sheet, buildUserResolver(users, normalizeEmail), importId);
    } catch (err) {
      if (err instanceof XlsxError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }

    // ── Refuse rows belonging to a finalised month ──
    // A finalised month is what was paid. Letting a late export quietly move it
    // would make the payout record a lie, so those rows are held back and the
    // months are named — the admin reopens if the correction is real.
    const affected = [...new Set(parsed.sales.map(s => `${s.userId}|${s.month}`))];
    const finalizedPairs = new Set<string>();
    const byMonth = new Map<string, string[]>();
    for (const pair of affected) {
      const [uid, month] = pair.split('|');
      const list = byMonth.get(month);
      if (list) list.push(uid);
      else byMonth.set(month, [uid]);
    }
    for (const [month, uids] of byMonth) {
      for (const uid of await getFinalizedMonthsFor(uids, month)) finalizedPairs.add(`${uid}|${month}`);
    }

    const writable = parsed.sales.filter(s => !finalizedPairs.has(`${s.userId}|${s.month}`));
    const blocked = parsed.sales.length - writable.length;
    const rejectedFinalizedMonths = [
      ...new Set([...finalizedPairs].map(p => p.split('|')[1])),
    ].sort();

    // ── Per-agent reconciliation ──
    const perUserMap = new Map<string, { userId: string; displayName: string; sourceEmail: string; gross: number; rows: number }>();
    for (const sale of writable) {
      const entry = perUserMap.get(sale.userId) ?? {
        userId: sale.userId,
        displayName: '',
        sourceEmail: sale.sourceEmail,
        gross: 0,
        rows: 0,
      };
      entry.gross = round2(entry.gross + sale.signedGross);
      entry.rows += 1;
      perUserMap.set(sale.userId, entry);
    }
    await Promise.all(
      [...perUserMap.values()].map(async entry => {
        entry.displayName = (await getUserById(entry.userId))?.displayName ?? entry.userId;
      }),
    );
    const perUser = [...perUserMap.values()].sort((a, b) => b.gross - a.gross);

    const skipped = [...parsed.skips];
    if (blocked > 0) {
      skipped.push({
        reason: 'unmapped-email',
        detail: `${blocked} row${blocked === 1 ? '' : 's'} belong to a finalised month (${rejectedFinalizedMonths.join(', ')}) and were not written. Reopen the month to accept them.`,
        rowCount: blocked,
        sampleRows: [],
      });
    }

    // ── Write ──
    const { written, duplicates } = dryRun
      ? { written: writable.length, duplicates: 0 }
      : await writeSales(writable);

    const result: SalesImportResult = {
      importId,
      fileName: file.name,
      uploadedBy: token.uid,
      uploadedAt: new Date().toISOString(),
      totalRows: parsed.totalRows,
      imported: written,
      duplicates,
      skipped,
      skippedRows: skipped.reduce((sum, s) => sum + s.rowCount, 0),
      monthsTouched: [...new Set(writable.map(s => s.month))].sort(),
      perUser,
      rejectedFinalizedMonths,
    };

    if (!dryRun) {
      const actor = await getUserById(token.uid);
      await recordImport({
        ...result,
        uploadedByName: actor?.displayName ?? token.email ?? token.uid,
      });
    }

    return NextResponse.json({ dryRun, result });
  } catch (err) {
    return handleApiError(err, 'ca-salary/import POST');
  }
});

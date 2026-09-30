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
 * **A sale belongs to the shift it was made on.** Every row is stamped with the
 * start day of the agent's shift that contains it, not its own calendar day,
 * so a 23:00–07:00 shift's post-midnight sales are paid with the shift — and on
 * the last night of a month, in the month finalised on the 1st.
 *
 * `dryRun` runs the whole parse and reports what *would* happen without writing,
 * which is what the upload screen shows before an admin confirms.
 */

import { NextRequest, NextResponse, after } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireCaAdmin } from '@/lib/salary/salaryAuth';
import { readXlsxSheet, XlsxError } from '@/lib/salary/xlsx';
import { parseSalesSheet, buildUserResolver, attributeSalesToShifts } from '@/lib/salary/salesImport';
import { normalizeEmail } from '@/lib/authEmail';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import {
  writeSales,
  recordImport,
  getRecentImports,
  getFinalizedMonthsFor,
  getExistingSaleStamps,
  getShiftWindowsForSales,
} from '@/lib/services/caSalaryService';
import { round2 } from '@/lib/salary/salaryEngine';
import { buildSalaryMonthForUsers } from '@/lib/services/caSalaryService';
import { notifications } from '@/lib/notificationContent';
import { getChatAgentUids, notifyUsers, syncCommissionTierNotice } from '@/lib/services/caNotifications';
import { formatMonthLabel } from '@/lib/salary/salaryDate';
import { formatPercent } from '@/lib/salary/salaryFormat';
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

    // ── Attribute each sale to the shift it was made on ──
    // A shift is paid on the day it starts, so a sale made at 02:00 on an
    // overnight shift belongs to the previous day — and on the last night of a
    // month, to the month being paid on the 1st. See `attributeSalesToShifts`.
    const attribution = attributeSalesToShifts(parsed.sales, await getShiftWindowsForSales(parsed.sales));
    const sales = attribution.sales;

    // What is already stored, and where. Feeds the duplicate count, the
    // re-stamp count, and the finalised guard below.
    const existing = await getExistingSaleStamps(sales.map(s => s.saleId));
    /** The stored month when this upload would move the sale out of it, else null. */
    const movedFrom = (s: (typeof sales)[number]) => {
      const prev = existing.get(s.saleId)?.month;
      return prev && prev !== s.month ? prev : null;
    };

    // ── Refuse rows belonging to a finalised month ──
    // A finalised month is what was paid. Letting a late export quietly move it
    // would make the payout record a lie, so those rows are held back and the
    // months are named — the admin reopens if the correction is real. That
    // cuts both ways now that a sale's month follows its shift: a row moving
    // *into* a finalised month is refused, and so is a stored row moving *out*
    // of one, which would otherwise be paid twice — once in the frozen month,
    // again in the open one.
    const affected = new Set<string>();
    for (const s of sales) {
      affected.add(`${s.userId}|${s.month}`);
      const prev = movedFrom(s);
      if (prev) affected.add(`${s.userId}|${prev}`);
    }
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

    const rejectedMonths = new Set<string>();
    const writable = sales.filter(s => {
      let ok = true;
      for (const month of [s.month, movedFrom(s)]) {
        if (month && finalizedPairs.has(`${s.userId}|${month}`)) {
          rejectedMonths.add(month);
          ok = false;
        }
      }
      return ok;
    });
    const blocked = sales.length - writable.length;
    const rejectedFinalizedMonths = [...rejectedMonths].sort();

    const shiftAttributed = writable.filter(s => attribution.moved.has(s.saleId)).length;
    const shiftAttributedToPreviousMonth = writable.filter(s => attribution.movedAcrossMonth.has(s.saleId)).length;
    const restamped = writable.filter(s => {
      const prev = existing.get(s.saleId);
      return prev !== undefined && prev.day !== s.day;
    }).length;

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
      : await writeSales(writable, new Set(existing.keys()));

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
      shiftAttributed,
      shiftAttributedToPreviousMonth,
      restamped,
    };

    if (!dryRun) {
      const actor = await getUserById(token.uid);
      await recordImport({
        ...result,
        uploadedByName: actor?.displayName ?? token.email ?? token.uid,
      });
    }

    // ── Notifications ──
    // Two of them, and both belong *after* the response: an admin waiting on an
    // upload should not also wait on a roster-wide fan-out and a month
    // recomputation. `after()` runs them once the response is flushed.
    //
    // Nothing fires on a dry run (nothing was written) or on an import that
    // wrote nothing (a re-upload of an overlapping export is the normal case,
    // and "your earnings were updated" would be a lie).
    if (!dryRun && (written > 0 || restamped > 0)) {
      const monthsTouched = result.monthsTouched;
      const affectedUserIds = [...perUserMap.keys()];

      after(async () => {
        try {
          const monthLabel =
            monthsTouched.length === 1 ? formatMonthLabel(monthsTouched[0]) : 'your open months';
          await notifyUsers(await getChatAgentUids(), notifications.salesImported(monthLabel), {
            label: 'salesImported',
          });
        } catch (err) {
          console.error('[ca-salary/import] earnings-updated notification failed', err);
        }

        // ── Commission tier crossings ──
        // A sales import is the only thing that moves month-to-date gross for a
        // whole roster at once, which makes it the moment a tier is actually
        // crossed. The month is recomputed (cheaply — one pass for every agent
        // in it) and each agent's band compared with what they were last told;
        // `syncCommissionTierNotice` owns that memory and the once-per-band gate.
        for (const month of monthsTouched) {
          try {
            const months = await buildSalaryMonthForUsers(affectedUserIds, month);
            const monthLabel = formatMonthLabel(month);
            for (const [userId, monthResult] of months) {
              const { crossedTo } = await syncCommissionTierNotice({
                userId,
                month,
                currentPercent: monthResult.tier.currentPercent,
              });
              if (crossedTo === null) continue;
              await notifyUsers(
                [userId],
                notifications.commissionTierUp(formatPercent(crossedTo), monthLabel),
                { label: 'commissionTierUp' },
              );
            }
          } catch (err) {
            console.error('[ca-salary/import] tier notification failed for', month, err);
          }
        }
      });
    }

    return NextResponse.json({ dryRun, result });
  } catch (err) {
    return handleApiError(err, 'ca-salary/import POST');
  }
});

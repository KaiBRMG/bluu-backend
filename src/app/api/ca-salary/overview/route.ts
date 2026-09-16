/**
 * GET /api/ca-salary/overview?month=YYYY-MM
 *
 * The whole month in one response: what every chat agent earned, which creator
 * they earned it on, and what the month cost to run.
 *
 * The payroll roster answers "what do I pay each agent"; this answers the two
 * questions that only exist above the roster — **where does the revenue come
 * from** and **is any of it concentrated in one place**. The agent × creator
 * matrix is the same `byCreator` fold the individual sales report already does
 * (`/api/ca-salary/sales`), lifted to the whole roster so it can be read across
 * agents rather than one agent at a time.
 *
 * Read budget (rule 9). The month's sales are read **once** and handed to
 * `buildSalaryMonthForUsers`, which would otherwise query them again — the
 * matrix and the totals are built from the same rows, so they cannot disagree
 * and they cost one query between them. The previous month adds exactly one
 * further query, for its sales only: the month-over-month figures here are
 * **gross**, never payroll, because a second `buildSalaryMonthForUsers` would
 * cost six more queries for a comparison nobody reconciles against.
 *
 * Every figure is derived on read, like everything else in this subsystem
 * (ca-salary.md §1). Nothing here is stored.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireCaAdmin } from '@/lib/salary/salaryAuth';
import { buildSalaryMonthForUsers, getSalesForMonthByUser } from '@/lib/services/caSalaryService';
import { adminDb } from '@/lib/firebase-admin';
import { round2 } from '@/lib/salary/salaryEngine';
import { addMonths, currentMonthKey, isMonthKey } from '@/lib/salary/salaryDate';
import type { SalarySale } from '@/lib/salary/salaryTypes';
import type { DecodedIdToken } from 'firebase-admin/auth';

/** creatorName → signed gross, for one agent or for the whole roster. */
function foldByCreator(sales: SalarySale[]): Map<string, { gross: number; count: number }> {
  const out = new Map<string, { gross: number; count: number }>();
  for (const sale of sales) {
    const name = sale.creatorName || 'Unattributed';
    const entry = out.get(name) ?? { gross: 0, count: 0 };
    entry.gross = round2(entry.gross + sale.signedGross);
    entry.count += 1;
    out.set(name, entry);
  }
  return out;
}

/** Fold a creator name for matching. Mirrors `normalise` in `AdminOverview.tsx`. */
function foldName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Sales creator **name** → creator document id.
 *
 * Sales carry a name typed into the export, never an id, while shift
 * assignments carry ids — so any question that spans the two needs this join.
 * The export's names are also routinely shorter than the stage name on the
 * roster ("Liam" for "Liam Heng", "Adam" for "Adam Horváth"), so an exact fold
 * alone resolves only some of them.
 *
 * Exact match wins outright. Failing that, a name is accepted as a prefix of a
 * stage name **at a word boundary** ("liam" → "liam heng"), and only when
 * exactly one creator matches: "noah" is a prefix of both Noah Green and Noah
 * Ryder, and guessing between them would silently attribute one creator's
 * coverage to another. An ambiguous or unmatched name resolves to `null` and is
 * reported as unmeasurable rather than quietly treated as uncovered.
 */
function buildCreatorIdResolver(
  creators: Array<{ id: string; stageName: string }>,
): (name: string) => string | null {
  const exact = new Map<string, string>();
  for (const creator of creators) exact.set(foldName(creator.stageName), creator.id);

  return (name: string) => {
    const folded = foldName(name);
    const hit = exact.get(folded);
    if (hit) return hit;

    const prefixed = creators.filter(c => foldName(c.stageName).startsWith(`${folded} `));
    return prefixed.length === 1 ? prefixed[0].id : null;
  };
}

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await requireCaAdmin(token);
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') ?? currentMonthKey();
    if (!isMonthKey(month)) {
      return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
    }
    const previousMonth = addMonths(month, -1);

    // Same roster query and the same archived-user handling as `/roster`: an
    // inequality filter on `isArchived` would drop every document that has
    // never had the field written (rule 6).
    const snap = await adminDb.collection('users').where('groups', 'array-contains', 'CA').get();
    const agents = snap.docs
      .map(d => d.data())
      .filter(u => u.isArchived !== true)
      .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''));
    const uids = agents.map(a => a.uid);

    const [salesByUser, previousSalesByUser, creatorSnap] = await Promise.all([
      getSalesForMonthByUser(month),
      getSalesForMonthByUser(previousMonth),
      // One further query, and the only way to answer the coverage question:
      // sales name creators, shifts id them, and nothing else joins the two.
      adminDb.collection('creators').select('creatorID', 'stageName').get(),
    ]);

    const resolveCreatorId = buildCreatorIdResolver(
      creatorSnap.docs.map(d => ({
        id: (d.data().creatorID as string | undefined) ?? d.id,
        stageName: (d.data().stageName as string | undefined) ?? '',
      })),
    );

    const months = await buildSalaryMonthForUsers(uids, month, { salesByUser });

    // ── The matrix, and the creator totals it rolls up to ──────────────
    //
    // Built from the sales rows rather than from the day results, because a
    // day result has already folded its creators away. A finalised month is
    // the one place these two can differ: its *totals* are frozen, while its
    // sales rows are still live — so an admin reading this tab after a late
    // import sees the revenue, and the payroll column still says what was
    // paid. That is the honest pairing, not a bug to reconcile.

    const rosterGross = new Map<string, { gross: number; count: number; agents: Set<string> }>();
    const previousGrossByCreator = new Map<string, number>();
    const previousGrossByAgent = new Map<string, number>();

    for (const [uid, sales] of previousSalesByUser) {
      previousGrossByAgent.set(uid, sales.reduce((sum, s) => round2(sum + s.signedGross), 0));
      for (const [name, entry] of foldByCreator(sales)) {
        previousGrossByCreator.set(name, round2((previousGrossByCreator.get(name) ?? 0) + entry.gross));
      }
    }

    // creatorId → the agents rostered onto that account this month. This is the
    // coverage graph, and it comes from shift assignments rather than from
    // sales: an agent who is scheduled on an account covers it whether or not
    // they happened to close anything. `creatorIds` is absent on shifts created
    // before assignment existed, so a creator with no entry here is *unknown*,
    // not uncovered — see `soloCreators`.
    const assignedAgents = new Map<string, Set<string>>();

    const agentRows = agents.map(agent => {
      const result = months.get(agent.uid);
      const sales = salesByUser.get(agent.uid) ?? [];
      const byCreator: Record<string, number> = {};

      // ── How many accounts this agent actually works ──
      //
      // A roster fact, and deliberately not the number of creators that produced
      // sales: an agent assigned four accounts of which one sold this month
      // works four accounts, and the matrix sub-label used to call that "1
      // creator". The two sets are kept apart for the same reason the wage
      // engine keeps them apart (ca-salary.md §6) — cover is somebody else's
      // account for a day, not part of this agent's standing roster:
      //
      //   own    — accounts that pay the agent's own wage tier
      //   cover  — an overtime shift, in-shift cover (`paysWage: false`), or any
      //            account marked overtime (`overtimeCreatorIds`), which is the
      //            same fact reached from Shift Management instead of the
      //            coverage board. Marked accounts count as cover whether or not
      //            they are paid: this split is about whose roster an account is
      //            on, not about what it pays.
      //
      // Counted as **ids**, never grouped: a sub-account is a peer, not a child,
      // and each one counts as one account toward its assignee (rule 9h). The
      // id spaces are disjoint, so a Set is the whole implementation.
      //
      // Month-scoped by construction — an account added mid-month is included,
      // which is the honest answer for a month view.
      const ownAccountIds = new Set<string>();
      const coverAccountIds = new Set<string>();

      for (const day of result?.days ?? []) {
        for (const shift of day.shifts) {
          const wholeShiftIsCover = shift.isOvertime || !shift.paysWage;
          const unpaidIds = new Set(shift.overtimeCreatorIds ?? []);
          for (const creatorId of shift.creatorIds) {
            if (wholeShiftIsCover || unpaidIds.has(creatorId)) coverAccountIds.add(creatorId);
            else ownAccountIds.add(creatorId);

            const covering = assignedAgents.get(creatorId) ?? new Set<string>();
            covering.add(agent.uid);
            assignedAgents.set(creatorId, covering);
          }
        }
      }

      // An account covered *and* held is held — it must not be counted twice.
      for (const id of ownAccountIds) coverAccountIds.delete(id);

      for (const [name, entry] of foldByCreator(sales)) {
        byCreator[name] = entry.gross;
        const roster = rosterGross.get(name) ?? { gross: 0, count: 0, agents: new Set<string>() };
        roster.gross = round2(roster.gross + entry.gross);
        roster.count += entry.count;
        // A creator an agent worked but netted exactly zero on (a sale fully
        // reversed) still counts as covered — somebody was on that account.
        roster.agents.add(agent.uid);
        rosterGross.set(name, roster);
      }

      const previous = previousGrossByAgent.get(agent.uid);

      return {
        uid: agent.uid as string,
        displayName: (agent.displayName ?? agent.uid) as string,
        photoURL: (agent.photoURL ?? null) as string | null,
        gross: result?.totals.grossEarnings ?? 0,
        commission: result?.totals.commission ?? 0,
        wage: result?.totals.wage ?? 0,
        salary: result?.totals.salary ?? 0,
        hours: result?.totals.hours ?? 0,
        saleCount: sales.length,
        tierPercent: result?.tier.currentPercent ?? null,
        status: result?.status ?? ('open' as const),
        overriddenDays: result ? result.days.filter(d => Object.keys(d.overrides).length > 0).length : 0,
        missingShiftDays: result ? result.days.filter(d => d.missingShift).length : 0,
        byCreator,
        /** Accounts on the agent's own shifts this month — their roster. */
        accountCount: ownAccountIds.size,
        /** Accounts they covered for somebody else, and hold none of themselves. */
        coverAccountCount: coverAccountIds.size,
        previousGross: previous ?? null,
      };
    });

    const creatorRows = [...rosterGross.entries()]
      .map(([name, entry]) => {
        const creatorId = resolveCreatorId(name);
        const covering = creatorId ? assignedAgents.get(creatorId) : undefined;

        return {
          name,
          gross: entry.gross,
          count: entry.count,
          /** Agents who recorded a sale on this creator — a revenue fact. */
          agentCount: entry.agents.size,
          /**
           * Agents rostered onto this creator — a coverage fact. `null` when it
           * cannot be determined: the name matched no creator, or no shift this
           * month carried an assignment for them.
           */
          assignedAgentCount: covering ? covering.size : null,
          previousGross: previousGrossByCreator.get(name) ?? null,
        };
      })
      .sort((a, b) => b.gross - a.gross);

    // ── Totals ────────────────────────────────────────────────────────

    const sum = (pick: (row: (typeof agentRows)[number]) => number) =>
      round2(agentRows.reduce((total, row) => total + pick(row), 0));

    const gross = sum(r => r.gross);
    const payroll = sum(r => r.salary);
    const previousGross = round2([...previousGrossByAgent.values()].reduce((t, v) => t + v, 0));

    // ── What is worth interrupting for ────────────────────────────────
    //
    // Three ways a month is quietly wrong, each naming its rows rather than
    // reporting a count the reader then has to go hunting for.

    const attention = {
      /** On the roster, no revenue recorded. Either idle, or their export rows failed to map. */
      agentsWithoutSales: agentRows
        .filter(r => r.saleCount === 0)
        .map(r => ({ uid: r.uid, displayName: r.displayName })),

      /** Earned last month, nothing this month — an account that has gone quiet. */
      lapsedCreators: [...previousGrossByCreator.entries()]
        .filter(([name, previous]) => previous > 0 && !rosterGross.has(name))
        .map(([name, previousGross]) => ({ name, previousGross }))
        .sort((a, b) => b.previousGross - a.previousGross),

      /**
       * Exactly one agent **rostered** on an earning account — a real single
       * point of failure.
       *
       * This deliberately reads shift assignments rather than sales. It used to
       * count agents who had recorded a sale, which is a different fact and
       * produced a claim the data did not support: a creator worked by three
       * agents, one of whom happened to close a single sale, was reported as
       * having "nobody to fall back on". At low revenue the sales version
       * inverts entirely — it fires hardest on the accounts where a lone seller
       * means least.
       *
       * A creator whose coverage cannot be determined is omitted rather than
       * assumed solo, and surfaces in `unmeasuredCreators` instead.
       */
      soloCreators: creatorRows
        .filter(row => row.assignedAgentCount === 1 && row.gross > 0)
        .map(row => {
          const creatorId = resolveCreatorId(row.name);
          const onlyUid = creatorId ? [...(assignedAgents.get(creatorId) ?? [])][0] : undefined;
          const only = agentRows.find(a => a.uid === onlyUid);
          return { name: row.name, gross: row.gross, agentName: only?.displayName ?? '—' };
        }),

      /**
       * Earning creators whose coverage could not be read at all — the name did
       * not resolve to a creator on the roster, or no shift this month carried
       * an assignment for them. Reported because the alternative is a coverage
       * check that silently skips rows and looks complete.
       */
      unmeasuredCreators: creatorRows
        .filter(row => row.assignedAgentCount === null && row.gross > 0)
        .map(row => ({ name: row.name, gross: row.gross, matched: resolveCreatorId(row.name) !== null })),
    };

    return NextResponse.json({
      month,
      previousMonth,
      agents: agentRows.sort((a, b) => b.gross - a.gross),
      creators: creatorRows,
      totals: {
        gross,
        previousGross,
        commission: sum(r => r.commission),
        wage: sum(r => r.wage),
        payroll,
        hours: sum(r => r.hours),
        saleCount: agentRows.reduce((total, row) => total + row.saleCount, 0),
        agentCount: agentRows.length,
        earningAgentCount: agentRows.filter(r => r.saleCount > 0).length,
        creatorCount: creatorRows.length,
        finalizedCount: agentRows.filter(r => r.status === 'finalized').length,
        overriddenDays: agentRows.reduce((total, row) => total + row.overriddenDays, 0),
        missingShiftDays: agentRows.reduce((total, row) => total + row.missingShiftDays, 0),
      },
      attention,
    });
  } catch (err) {
    return handleApiError(err, 'ca-salary/overview GET');
  }
});

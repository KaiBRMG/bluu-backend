"use client";

import { useState, useCallback, useEffect, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import AppLayout from "@/components/AppLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { currentMonthKey, isMonthKey } from '@/lib/salary/salaryDate';
import { useAuth } from '@/components/AuthProvider';

// `salaries` is the Payroll tab's id — kept so existing `?tab=salaries` links
// still land, while the label says Payroll everywhere it is read.
const ADMIN_TABS = ['overview', 'salaries', 'sales', 'coverage', 'rates'];
const noopSubscribe = () => () => {};
/**
 * `?tab=disputes` predates the merge (2026-10-19): disputes are a view of
 * Sales now, so an old link lands there, on the Disputed view.
 */
function readRequestedTab(): string | null {
  const requested = new URLSearchParams(window.location.search).get('tab');
  if (requested === 'payroll') return 'salaries';
  if (requested === 'disputes') return 'sales';
  return requested && ADMIN_TABS.includes(requested) ? requested : null;
}
function readArrivedForDisputes(): boolean {
  return new URLSearchParams(window.location.search).get('tab') === 'disputes';
}
function readRequestedAgent(): string | null {
  return new URLSearchParams(window.location.search).get('agent');
}

/**
 * Mirror the tab and open agent into the URL without a navigation.
 *
 * `history.replaceState`, not `router.replace`: a router navigation is an RSC
 * round-trip through middleware for state the page already holds (rule 9i), and
 * it would remount the app shell (CLAUDE.md, the app-shell known issue). This
 * only makes the current view linkable and survive a reload.
 */
function writeUrlState(tab: string, agent: string | null) {
  try {
    const url = new URL(window.location.href);
    if (tab === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    if (agent && tab === 'salaries') url.searchParams.set('agent', agent);
    else url.searchParams.delete('agent');
    window.history.replaceState(window.history.state, '', url);
  } catch {
    /* a URL that cannot be written is only a lost deep link */
  }
}

// ─── Lazily-loaded tab panels ─────────────────────────────────────────
// Each panel is a substantial tree with its own data fetching, and an admin
// opens one of them at a time. Loading all five on every visit to this page
// would be the single heaviest route in the portal.

function PanelSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48 rounded-md" />
        <Skeleton className="h-8 w-40 rounded-md" />
      </div>
      <Skeleton className="h-[480px] w-full rounded-xl" />
    </div>
  );
}

const AdminOverview = dynamic(() => import('@/components/ca-admin/AdminOverview'), {
  loading: () => <PanelSkeleton />,
});
const AdminSalaries = dynamic(() => import('@/components/ca-admin/AdminSalaries'), {
  loading: () => <PanelSkeleton />,
});
const AdminSales = dynamic(() => import('@/components/ca-admin/AdminSales'), {
  loading: () => <PanelSkeleton />,
});
const AdminCoverage = dynamic(() => import('@/components/ca-admin/AdminCoverage'), {
  loading: () => <PanelSkeleton />,
});
const AdminRates = dynamic(() => import('@/components/ca-admin/AdminRates'), {
  loading: () => <PanelSkeleton />,
});

// ─── Page ─────────────────────────────────────────────────────────────

/**
 * CA Admin — everything a CA manager runs that is not the roster itself.
 *
 * The split with Shift Management is by object, not by team: shift CRUD and
 * creator assignment stay there because that page already owns the calendar, the
 * modal and recurrence. Money and the absence pipeline live here.
 *
 * Overview is the default tab: the month read whole — revenue by creator, what
 * payroll cost against it, and anything that needs looking at — before Payroll
 * asks what to pay any one agent. Payroll is the tab with the deadline on it,
 * and it is one click away.
 *
 * The **month is owned here**, shared by Overview and Payroll, because those two
 * are read together and a month that only moved on one of them is how a figure
 * gets quoted from the wrong one (ca-salary.md §10).
 *
 * It **opens on the month payroll still owes**, not the calendar month: last
 * month while any agent has it unfinalised (`/api/ca-salary/payroll-month`).
 * Both panels wait for that answer rather than mounting on the calendar month
 * and refetching — a flash of October's roster is how September gets skipped.
 */
export default function CaAdminPage() {
  const { user } = useAuth();
  // `null` until the server says which month payroll is on.
  const [month, setMonth] = useState<string | null>(null);

  useEffect(() => {
    if (!user || month) return;
    let cancelled = false;
    (async () => {
      let resolved: string = currentMonthKey();
      try {
        const res = await fetch('/api/ca-salary/payroll-month', {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        });
        if (res.ok) {
          const body = (await res.json()) as { month?: unknown };
          if (isMonthKey(body.month)) resolved = body.month;
        }
      } catch {
        // The calendar month is a safe fallback — the picker still reaches the
        // previous one — so a failure here must not block the page.
      }
      if (!cancelled) setMonth(m => m ?? resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, month]);

  const { timezone: userTimezone } = useViewerTimezone();

  // `?tab=sales` is where the BuddyX sync-failing alert points. Read as an
  // external value (server: none) rather than through `useSearchParams`, which
  // would suspend the page; the reader's own pick then wins.
  const requestedTab = useSyncExternalStore(noopSubscribe, readRequestedTab, () => null);
  const requestedAgent = useSyncExternalStore(noopSubscribe, readRequestedAgent, () => null);
  const arrivedForDisputes = useSyncExternalStore(noopSubscribe, readArrivedForDisputes, () => false);
  const [pickedTab, setPickedTab] = useState<string | null>(null);
  const tab = pickedTab ?? requestedTab ?? 'overview';
  // `undefined` = nothing picked yet this visit, so the URL's `?agent=` applies.
  const [pickedAgent, setPickedAgent] = useState<string | null | undefined>(undefined);
  const agent = pickedAgent === undefined ? requestedAgent : pickedAgent;

  const setTab = useCallback((next: string) => {
    setPickedTab(next);
    writeUrlState(next, agent);
  }, [agent]);
  const setAgent = useCallback((uid: string | null) => {
    setPickedAgent(uid);
    writeUrlState('salaries', uid);
  }, []);
  const openAgent = useCallback((uid: string) => {
    setPickedTab('salaries');
    setAgent(uid);
  }, [setAgent]);

  return (
    <AppLayout>
      <div className="max-w-7xl">
        <h1 className="text-2xl font-bold tracking-tight">CA Admin</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Payroll, sales and disputes, coverage and rates for every chat agent.
        </p>

        <div className="mt-6 rounded-lg border border-border-subtle bg-content-bg">
          <Tabs value={tab} onValueChange={setTab}>
            {/* pb-1.5: overflow-x:auto forces overflow-y to auto, so reserve room
                for the trigger focus ring instead of letting it clip. */}
            <div className="overflow-x-auto px-6 pb-1.5 pt-4">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="salaries">Payroll</TabsTrigger>
                <TabsTrigger value="sales">Sales</TabsTrigger>
                <TabsTrigger value="coverage">Coverage</TabsTrigger>
                <TabsTrigger value="rates">Rates</TabsTrigger>
              </TabsList>
            </div>

            <div className="min-h-[600px] p-6">
              <TabsContent value="overview">
                {month ? <AdminOverview month={month} onMonthChange={setMonth} onOpenAgent={openAgent} /> : <PanelSkeleton />}
              </TabsContent>
              <TabsContent value="salaries">
                {month ? (
                  <AdminSalaries month={month} onMonthChange={setMonth} agentUid={agent} onAgentChange={setAgent} />
                ) : (
                  <PanelSkeleton />
                )}
              </TabsContent>
              <TabsContent value="sales">
                <AdminSales timezone={userTimezone} initialView={arrivedForDisputes ? 'disputed' : 'all'} />
              </TabsContent>
              <TabsContent value="coverage"><AdminCoverage /></TabsContent>
              <TabsContent value="rates"><AdminRates /></TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}

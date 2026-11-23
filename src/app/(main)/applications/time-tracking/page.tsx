"use client";

import dynamic from "next/dynamic";
import { memo, useEffect, useRef, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { useTimeTracking } from "@/hooks/useTimeTracking";
import { useUserData } from "@/hooks/useUserData";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SURFACE } from "@/lib/surfaces";
import { cn } from "@/lib/utils";
import { todayStr } from "@/lib/utils/timezone";
import { TimeInstrument } from "@/components/time-tracking/TimeInstrument";
import { TodaySessions } from "@/components/time-tracking/TodaySessions";
import { useTodayModel } from "@/components/time-tracking/useTodayModel";

/* ── Loading skeletons ───────────────────────────────────────────────
   Shaped to each tab's final layout (DESIGN.md § Loading & Empty States). */

function TimesheetSkeleton() {
  return (
    <div className={cn("rounded-xl p-6", SURFACE)}>
      <Skeleton className="mb-5 h-9 w-40 rounded-md" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}

function ScreenshotsSkeleton() {
  return (
    <div className={cn("rounded-xl p-6", SURFACE)}>
      <Skeleton className="mb-5 h-9 w-40 rounded-md" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-video w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}

/* Tab bodies are memoised: the clock ticks once a second, which re-renders this
   page, and without memo that tick cascades into whichever tab is mounted. */

const UserTimesheet = memo(
  dynamic(() => import("@/components/timesheet/UserTimesheet"), {
    loading: TimesheetSkeleton,
  })
);
const UserScreenshots = memo(
  dynamic(() => import("@/components/timesheet/UserScreenshots"), {
    loading: ScreenshotsSkeleton,
  })
);

/* ── Stale-page refresh ──────────────────────────────────────────────
   Every "today" on this page — the day total, Today's Timesheet, the
   Previous Timesheets range, the Screenshots date — is resolved once, on
   mount. The renderer is never reloaded (rule 9c), so a page left open
   overnight kept showing yesterday's timesheet, and a user could clock in
   against it. When the local day rolls over, or the page comes back into view
   after a long absence, the body is remounted so every one of those re-derives.

   Only while clocked out: a live session is attributed to the day it started
   (time-tracking.md §5), so remounting mid-shift would buy nothing but a
   skeleton flash. The day check is a pure clock read — no network — and a
   remount after STALE_AFTER_MS lands past the timesheet cache's 5-min TTL, so
   it refetches exactly once (rule 9). */

const STALE_AFTER_MS = 30 * 60 * 1000;
const DAY_CHECK_INTERVAL_MS = 60 * 1000;

function useStaleRefreshKey(timezone: string, canRefresh: boolean): number {
  const [refreshKey, setRefreshKey] = useState(0);
  const loadedAtRef = useRef(0);
  const loadedDayRef = useRef("");
  const canRefreshRef = useRef(canRefresh);
  useEffect(() => {
    canRefreshRef.current = canRefresh;
  }, [canRefresh]);

  useEffect(() => {
    // Anchored here, not in render (purity). A late-arriving or changed
    // timezone is not staleness — it only re-anchors the day.
    if (loadedAtRef.current === 0) loadedAtRef.current = Date.now();
    loadedDayRef.current = todayStr(timezone);

    const refresh = () => {
      loadedAtRef.current = Date.now();
      loadedDayRef.current = todayStr(timezone);
      setRefreshKey(k => k + 1);
    };

    const dayChanged = () => todayStr(timezone) !== loadedDayRef.current;

    // Day rollover — caught within a minute even if the window never loses focus.
    const id = setInterval(() => {
      if (canRefreshRef.current && dayChanged()) refresh();
    }, DAY_CHECK_INTERVAL_MS);

    // Returning to the page after a long absence — other devices may have
    // committed sessions in the meantime.
    const onReturn = () => {
      if (document.visibilityState !== "visible" || !canRefreshRef.current) return;
      if (dayChanged() || Date.now() - loadedAtRef.current > STALE_AFTER_MS) refresh();
    };

    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [timezone]);

  return refreshKey;
}

export default function TimeTrackingPage() {
  const { displayState, isLoading, isHydrating } = useTimeTracking();
  const { userData } = useUserData();
  const timezone = userData?.timezone || 'UTC';
  const refreshKey = useStaleRefreshKey(
    timezone,
    displayState === 'clocked-out' && !isLoading && !isHydrating,
  );

  return (
    <AppLayout>
      <TimeTrackingContent key={refreshKey} />
    </AppLayout>
  );
}

function TimeTrackingContent() {
  const { userData } = useUserData();
  const timezone = userData?.timezone || 'UTC';
  const model = useTodayModel(timezone);

  return (
    <div className="w-full max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight">Time Tracking</h1>
      <p className="mt-1 text-sm text-zinc-400">Track your time and attendance</p>

      <div className="mt-8">
        <TimeInstrument model={model} timezone={timezone} />
      </div>

      <Tabs defaultValue="sessions" className="mt-10">
        <div className="overflow-x-auto">
          <TabsList variant="line">
            <TabsTrigger value="sessions">Today&apos;s sessions</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="sessions" className="mt-5"><TodaySessions model={model} timezone={timezone} /></TabsContent>
        <TabsContent value="history" className="mt-5"><UserTimesheet /></TabsContent>
        <TabsContent value="screenshots" className="mt-5"><UserScreenshots /></TabsContent>
      </Tabs>
    </div>
  );
}

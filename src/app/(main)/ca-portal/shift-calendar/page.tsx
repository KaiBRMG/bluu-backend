'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDownIcon, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { useAssignableAccounts, useCreatorMap } from '@/hooks/useCreators';
import { useCaShiftCalendar, type CalendarPerson, type CalendarShift } from '@/hooks/useCaShiftCalendar';
import { getMondayOfWeek, todayStr, type ShiftUser, type CreateShiftPayload, type UpdateShiftPayload } from '@/hooks/useShifts';
import { addCalendarDays } from '@/lib/utils/timezone';
import { computeAccountWeek, formatDuration, indexShiftsByAccount, localDayStartMs, MINUTE_MS } from '@/lib/shiftCoverage';
import type { Creator } from '@/lib/campaignTracking';
import type { ExpandedShift } from '@/lib/utils/recurrence';
import { ShiftCalendarGrid, ShiftCalendarSkeleton, type GridRow } from '@/components/ca-shift-calendar/ShiftCalendarGrid';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// Editors only — readers never download the dialog.
const ShiftModal = dynamic(() => import('@/components/admin/shift-management/ShiftModal'));

/**
 * Shift Calendar — `/ca-portal/shift-calendar`.
 *
 * The Shift Management schedule with the axes swapped: creators (and their
 * sub-accounts) down the side, the week across. Same shifts, same roster
 * service; see `/api/ca-shift-calendar`. Agents read it; `shift-management`
 * holders also create and edit from it through the shared `ShiftModal`.
 *
 * Display only — coverage here never feeds pay (ca-salary.md §14).
 */

type ModalState =
  | { mode: 'create'; accountId: string; date: string }
  | { mode: 'edit'; shift: CalendarShift };

export default function ShiftCalendarPage() {
  const { user } = useAuth();
  const { timezone } = useViewerTimezone();
  const today = todayStr(timezone);
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(today));
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  const [gapsOnly, setGapsOnly] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);

  const { canEdit, shifts, users, loading, error, refetch, createShift, updateShift, deleteShift } = useCaShiftCalendar(weekStart);
  const accounts = useAssignableAccounts();
  const accountIndex = useCreatorMap();

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addCalendarDays(weekStart, i)), [weekStart]);
  // Held in state and ticked each minute: reading the clock in render is impure,
  // and "uncovered from now" should advance while the page is left open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const weekEndMs = localDayStartMs(addCalendarDays(weekStart, 7), timezone);

  const people = useMemo(() => new Map<string, CalendarPerson>(users.map(u => [u.uid, u])), [users]);

  const rows: GridRow[] = useMemo(() => {
    const byAccount = indexShiftsByAccount(shifts);

    // Every active account, plus an archived one that still holds a shift this
    // week — dropping it would hide hours somebody is paid for.
    const list: Creator[] = [...accounts];
    const seen = new Set(list.map(a => a.creatorID));
    for (const id of byAccount.keys()) {
      const hit = accountIndex.get(id);
      if (hit && !seen.has(id)) { list.push(hit); seen.add(id); }
    }

    // A week that is over has nothing left to fill; report its gaps whole.
    const from = weekEndMs <= now ? 0 : now;
    return list.map(account => {
      const week = computeAccountWeek(account.creatorID, byAccount.get(account.creatorID) ?? [], weekDays, timezone);
      let upcomingGapMs = 0;
      for (const d of week.days) {
        for (const g of d.gaps) upcomingGapMs += Math.max(0, g.end - Math.max(g.start, from));
      }
      return { account, week, upcomingGapMs };
    });
  }, [accounts, accountIndex, shifts, weekDays, timezone, weekEndMs, now]);

  const needsLook = useMemo(() => rows.filter(r => r.upcomingGapMs >= MINUTE_MS), [rows]);
  const visibleRows = gapsOnly ? needsLook : rows;

  const onAdd = useCallback((accountId: string, date: string) => setModal({ mode: 'create', accountId, date }), []);
  const onOpenShift = useCallback((shift: CalendarShift) => setModal({ mode: 'edit', shift }), []);

  const isCurrentWeek = weekStart === getMondayOfWeek(today);

  return (
    <AppLayout>
      <div className="max-w-[90rem]">
        <h1 className="mb-2 text-2xl font-bold tracking-tight">Shift Calendar</h1>
        <p className="text-sm text-zinc-400">
          Who is working each creator, and the hours nobody is. The same shifts as Shift Management, by creator.
          {canEdit && ' Click a cell to add a shift, or a shift to edit it.'}
        </p>

        {/* Toolbar */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" aria-label="Previous week" onClick={() => setWeekStart(addCalendarDays(weekStart, -7))}>←</Button>
            <Popover open={weekPickerOpen} onOpenChange={setWeekPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1 text-[13px] font-normal tabular-nums">
                  {weekStart}
                  <ChevronDownIcon className="size-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                <Calendar
                  mode="single"
                  selected={new Date(weekStart + 'T00:00:00')}
                  captionLayout="dropdown"
                  onSelect={(date: Date | undefined) => {
                    if (date) setWeekStart(getMondayOfWeek(date.toLocaleDateString('en-CA')));
                    setWeekPickerOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" aria-label="Next week" onClick={() => setWeekStart(addCalendarDays(weekStart, 7))}>→</Button>
            <Button variant="outline" size="sm" className="text-xs text-zinc-400" disabled={isCurrentWeek} onClick={() => setWeekStart(getMondayOfWeek(today))}>
              Today
            </Button>
          </div>

          <div className="h-5 w-px shrink-0 bg-white/[0.07]" />

          <div className="flex items-center gap-2">
            <Switch id="gaps-only" checked={gapsOnly} onCheckedChange={setGapsOnly} />
            <Label htmlFor="gaps-only" className="text-xs font-normal text-zinc-400">Hide fully covered</Label>
          </div>

          <Button
            variant="outline"
            size="icon"
            className="ml-auto"
            aria-label="Refresh"
            title="Refresh"
            onClick={() => { void refetch(); }}
          >
            <RefreshCcw className={loading ? 'size-3.5 animate-spin' : 'size-3.5 opacity-70'} />
          </Button>
        </div>

        {error && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>{error}</span>
              <Button size="sm" variant="outline" onClick={() => { void refetch(); }}>Try again</Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Gap band: static, attention-tinted, states its own empty. */}
        {!error && !(loading && shifts.length === 0) && (
          <div
            className={
              needsLook.length > 0
                ? 'mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-orange-500/20 bg-orange-500/[0.06] px-4 py-2.5'
                : 'mt-4 flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-2.5'
            }
            role="status"
          >
            <span aria-hidden className={needsLook.length > 0 ? 'size-2 shrink-0 rounded-full bg-orange-400' : 'size-2 shrink-0 rounded-full bg-white/30'} />
            <span className="text-sm text-zinc-300">
              {needsLook.length > 0 ? (
                <>
                  <span className="font-semibold tabular-nums text-white">{needsLook.length}</span>{' '}
                  {needsLook.length === 1 ? 'account has' : 'accounts have'} uncovered hours{' '}
                  {weekEndMs <= now ? 'this week' : isCurrentWeek ? 'for the rest of this week' : 'this week'}
                  <span className="text-zinc-400"> · {formatDuration(needsLook.reduce((n, r) => n + r.upcomingGapMs, 0))} in total</span>
                </>
              ) : (
                'Nothing needs a look.'
              )}
            </span>
            {needsLook.length > 0 && (
              <Button variant="ghost" size="xs" className="ml-auto text-xs" onClick={() => setGapsOnly(v => !v)}>
                {gapsOnly ? 'Show all accounts' : 'Show them'}
              </Button>
            )}
          </div>
        )}

        <div className="mt-4 min-h-[400px]">
          {loading && shifts.length === 0 && !error ? (
            <ShiftCalendarSkeleton />
          ) : visibleRows.length === 0 ? (
            <div className="rounded-xl border border-white/[0.07] px-6 py-12 text-center text-sm text-zinc-400">
              {rows.length === 0 ? 'No creator accounts to show yet.' : 'Every account is fully covered.'}
            </div>
          ) : (
            <ShiftCalendarGrid
              rows={visibleRows}
              weekDays={weekDays}
              today={today}
              now={now}
              timezone={timezone}
              people={people}
              viewerUid={user?.uid ?? null}
              canEdit={canEdit}
              onAdd={onAdd}
              onOpenShift={onOpenShift}
            />
          )}
        </div>
      </div>

      {canEdit && modal && (
        <ShiftModal
          mode={modal.mode}
          shift={modal.mode === 'edit' ? (modal.shift as unknown as ExpandedShift) : undefined}
          prefillCreatorId={modal.mode === 'create' ? modal.accountId : undefined}
          prefillDate={modal.mode === 'create' ? modal.date : undefined}
          users={users as ShiftUser[]}
          viewerTimezone={timezone}
          onSave={async (shiftId: string | null, payload: CreateShiftPayload | UpdateShiftPayload) => {
            if (shiftId && modal.mode === 'edit') {
              await updateShift(shiftId, payload as UpdateShiftPayload, modal.shift.userId);
            } else {
              await createShift(payload as CreateShiftPayload);
            }
            toast.success(shiftId ? 'Shift updated' : 'Shift created');
          }}
          onDelete={modal.mode === 'edit'
            ? async (shiftId: string, mode: 'single' | 'future' | 'series', overrideDate?: string) => {
                await deleteShift(shiftId, mode, modal.shift.userId, overrideDate);
                toast.success('Shift deleted');
              }
            : undefined}
          onClose={() => setModal(null)}
        />
      )}
    </AppLayout>
  );
}

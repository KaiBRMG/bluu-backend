'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useShifts, getMondayOfWeek, todayStr } from '@/hooks/useShifts';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { addCalendarDays, toLocalDateStr } from '@/lib/utils/timezone';
import type { CreateShiftPayload, UpdateShiftPayload } from '@/hooks/useShifts';
import type { ExpandedShift } from '@/lib/utils/recurrence';
import ShiftCard from '../ShiftCard';
import ShiftModal from '../ShiftModal';

type ModalState =
  | { mode: 'create'; date: string }
  | { mode: 'edit'; shift: ExpandedShift };

function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

/**
 * One person's week, as a column of days rather than the Schedule grid's row —
 * the grid's seven 130px columns do not fit a panel, and a person's week reads
 * top to bottom anyway. Same cards, same modal, same writes as the grid; the
 * week fetch is shared with the Schedule view through `useShifts`' cache.
 */
export function PersonShifts({ uid, date }: { uid: string; date?: string }) {
  const { timezone: tz } = useViewerTimezone();
  const today = todayStr(tz);
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(date ?? today));
  const [modal, setModal] = useState<ModalState | null>(null);
  const { shifts, users, loading, error, refetch, createShift, updateShift, deleteShift } = useShifts(weekStart);

  const user = users.find(u => u.uid === uid);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addCalendarDays(weekStart, i)), [weekStart]);
  const byDay = useMemo(() => {
    const map = new Map<string, ExpandedShift[]>();
    for (const s of shifts) {
      if (s.userId !== uid) continue;
      const key = toLocalDateStr(s.occurrenceStart, tz);
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    for (const list of map.values()) list.sort((a, b) => a.occurrenceStart - b.occurrenceStart);
    return map;
  }, [shifts, uid, tz]);

  const weekLabel = `${dayLabel(days[0])} – ${dayLabel(days[6])}`;

  return (
    <div>
      <div className="mb-3 flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="Previous week" onClick={() => setWeekStart(addCalendarDays(weekStart, -7))}>
          <ChevronLeft />
        </Button>
        <span className="min-w-44 text-center text-sm tabular-nums">{weekLabel}</span>
        <Button variant="ghost" size="icon-sm" aria-label="Next week" onClick={() => setWeekStart(addCalendarDays(weekStart, 7))}>
          <ChevronRight />
        </Button>
        {weekStart !== getMondayOfWeek(today) && (
          <Button variant="ghost" size="sm" className="text-zinc-400" onClick={() => setWeekStart(getMondayOfWeek(today))}>
            This week
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="space-y-2" aria-hidden>
          {days.map(d => <Skeleton key={d} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : !user ? (
        <p className="text-sm text-zinc-400">This person can&apos;t be scheduled — they don&apos;t have time tracking access.</p>
      ) : (
        <ul className="divide-y divide-white/[0.07]">
          {days.map(day => {
            const list = byDay.get(day) ?? [];
            const isToday = day === today;
            return (
              <li key={day} className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-start gap-3 py-2.5">
                <span className={`pt-1 text-sm tabular-nums ${isToday ? 'font-semibold text-white' : 'text-zinc-400'}`}>
                  {dayLabel(day)}{isToday && <span className="sr-only"> (today)</span>}
                </span>
                <div className="space-y-1.5">
                  {list.length === 0 ? (
                    <span className="block pt-1 text-sm text-zinc-400">No shift</span>
                  ) : (
                    list.map(s => (
                      <ShiftCard
                        key={s.shiftId + s.occurrenceStart}
                        shift={s}
                        user={user}
                        viewerTimezone={tz}
                        onClick={() => setModal({ mode: 'edit', shift: s })}
                        onLeaveAction={refetch}
                      />
                    ))
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-zinc-400 hover:text-white"
                  aria-label={`Add a shift on ${dayLabel(day)}`}
                  onClick={() => setModal({ mode: 'create', date: day })}
                >
                  <Plus /> Add
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {modal && (
        <ShiftModal
          mode={modal.mode}
          shift={modal.mode === 'edit' ? modal.shift : undefined}
          prefillUserId={modal.mode === 'create' ? uid : undefined}
          prefillDate={modal.mode === 'create' ? modal.date : undefined}
          users={users}
          viewerTimezone={tz}
          onSave={async (shiftId, payload) => {
            if (shiftId) await updateShift(shiftId, payload as UpdateShiftPayload);
            else await createShift(payload as CreateShiftPayload);
          }}
          onDelete={modal.mode === 'edit' ? deleteShift : undefined}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

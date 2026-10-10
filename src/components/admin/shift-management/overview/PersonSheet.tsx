'use client';

import { useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBasicUsers } from '@/hooks/useBasicUsers';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { formatClock, type LiveSession } from '@/lib/shiftOverview';
import { LiveStateLabel, PersonAvatar } from './personUi';
import type { PersonSection } from './ShiftOverview';

function SectionSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-8 w-64 rounded-md" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}

// Each section is loaded on first open — most visits read one.
const AdminTimesheets = dynamic(() => import('../AdminTimesheets'), { loading: () => <SectionSkeleton /> });
const AdminScreenshots = dynamic(() => import('../AdminScreenshots'), { loading: () => <SectionSkeleton /> });
const AdminAnalytics = dynamic(() => import('../analytics/AdminAnalytics'), { loading: () => <SectionSkeleton /> });
const PersonShifts = dynamic(() => import('./PersonShifts').then(m => m.PersonShifts), { loading: () => <SectionSkeleton /> });
const PersonLeave = dynamic(() => import('./PersonLeave').then(m => m.PersonLeave), { loading: () => <SectionSkeleton /> });
const PersonTrackingSettings = dynamic(
  () => import('../OrganizationSettings').then(m => m.PersonTrackingSettings),
  { loading: () => <SectionSkeleton /> },
);

export const PERSON_SECTIONS: Array<{ id: PersonSection; label: string }> = [
  { id: 'timeline', label: 'Timesheet' },
  { id: 'screenshots', label: 'Screenshots' },
  { id: 'shifts', label: 'Shifts' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'leave', label: 'Leave' },
  { id: 'settings', label: 'Tracking settings' },
];

interface PersonSheetProps {
  uid: string | null;
  /** The page's single `active_sessions` listener. */
  activeSessions: LiveSession[];
  section: PersonSection;
  date?: string;
  onSectionChange: (section: PersonSection) => void;
  onClose: () => void;
}

/**
 * Everything about one person, opened from any name on the page. The person is
 * chosen once, here, and every section is scoped to them — the old page asked
 * for the employee again on each of five tabs.
 *
 * A Sheet rather than a page so the dashboard stays behind it: opening someone
 * from the queue is a peek, and closing returns to the same place in the list.
 */
export function PersonSheet({ uid, activeSessions, section, date, onSectionChange, onClose }: PersonSheetProps) {
  // Names only matter once someone is open; the closed sheet fetches nothing.
  const { users, groups } = useBasicUsers(!!uid);
  const { timezone } = useViewerTimezone();
  const contentRef = useRef<HTMLDivElement>(null);

  const person = users.find(u => u.uid === uid);
  const name = person?.displayName || 'Employee';
  const groupNames = useMemo(() => {
    if (!person) return [];
    const byId = new Map(groups.map(g => [g.id, g.name]));
    return person.groups.map(id => byId.get(id)).filter((n): n is string => !!n);
  }, [person, groups]);

  const live = activeSessions.find(s => s.userId === uid);
  // The working state's lastUpdated is a heartbeat, not a transition — only
  // the other states have an exact "since".
  const since = live
    ? live.currentState === 'working'
      ? `clocked in ${formatClock(live.startTime.getTime(), timezone)}`
      : `since ${formatClock(live.lastUpdated.getTime(), timezone)}`
    : undefined;

  return (
    <Sheet open={!!uid} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent
        ref={contentRef}
        side="right"
        tabIndex={-1}
        className="dark flex w-full max-w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(60rem,calc(100vw-4rem))]"
        // Focus the panel, not its first tab trigger, so the title is what a
        // screen reader announces (DESIGN.md — the metric roster's panel).
        onOpenAutoFocus={e => { e.preventDefault(); contentRef.current?.focus(); }}
      >
        {/* One Tabs root spans header and body so each trigger stays wired to its panel. */}
        <Tabs
          value={section}
          onValueChange={v => onSectionChange(v as PersonSection)}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
        <SheetHeader className="shrink-0 gap-0 border-b border-white/[0.07] px-6 pt-5 pb-0 pr-12">
          <div className="flex items-center gap-3">
            <PersonAvatar displayName={name} photoURL={person?.photoURL} size="lg" />
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-base">{name}</SheetTitle>
              <SheetDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-400">
                <LiveStateLabel session={live} since={since} />
                {groupNames.length > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="truncate">{groupNames.join(', ')}</span>
                  </>
                )}
              </SheetDescription>
            </div>
          </div>

          <div className="mt-4">
            {/* pb-1.5: overflow-x:auto forces overflow-y to auto, so reserve room
                for the trigger focus ring instead of letting it clip. */}
            <div className="-mx-1 overflow-x-auto px-1 pb-1.5">
              <TabsList variant="line">
                {PERSON_SECTIONS.map(s => (
                  <TabsTrigger key={s.id} value={s.id}>{s.label}</TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {uid && (
            <>
              <TabsContent value="timeline">
                <AdminTimesheets key={`${uid}:${date}`} selectedUserId={uid} initialDate={date} />
              </TabsContent>
              <TabsContent value="screenshots">
                <AdminScreenshots key={`${uid}:${date}`} selectedUserId={uid} initialDate={date} />
              </TabsContent>
              <TabsContent value="shifts">
                <PersonShifts key={`${uid}:${date}`} uid={uid} date={date} />
              </TabsContent>
              <TabsContent value="analytics">
                <AdminAnalytics key={uid} lockedUserId={uid} />
              </TabsContent>
              <TabsContent value="leave">
                <PersonLeave key={uid} uid={uid} />
              </TabsContent>
              <TabsContent value="settings">
                <PersonTrackingSettings key={uid} uid={uid} />
              </TabsContent>
            </>
          )}
        </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

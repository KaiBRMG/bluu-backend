"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import AppLayout from "@/components/AppLayout";
import { useActiveUsers } from "@/hooks/useActiveUsers";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ShiftOverview, { type PersonSection } from "@/components/admin/shift-management/overview/ShiftOverview";
import { PersonSheet, PERSON_SECTIONS } from "@/components/admin/shift-management/overview/PersonSheet";

// Shaped loader for lazily-loaded views — a toolbar row + a body, sized so
// switching views doesn't flash or shift.
function ViewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48 rounded-md" />
        <Skeleton className="h-8 w-32 rounded-md" />
      </div>
      <Skeleton className="h-[520px] w-full rounded-xl" />
    </div>
  );
}

const AdminShifts = dynamic(
  () => import("@/components/admin/shift-management/AdminShifts"),
  { loading: () => <ViewSkeleton /> }
);
const AdminAnalytics = dynamic(
  () => import("@/components/admin/shift-management/analytics/AdminAnalytics"),
  { loading: () => <ViewSkeleton /> }
);
const SettingsView = dynamic(
  () => import("@/components/admin/shift-management/overview/SettingsView"),
  { loading: () => <ViewSkeleton /> }
);

type View = "overview" | "schedule" | "analytics" | "settings";
const VIEWS: Array<{ id: View; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "schedule", label: "Schedule" },
  { id: "analytics", label: "Analytics" },
  { id: "settings", label: "Settings" },
];

interface PersonState {
  uid: string;
  section: PersonSection;
  date?: string;
}

const isView = (v: string | null): v is View => VIEWS.some(x => x.id === v);
const isSection = (v: string | null): v is PersonSection => PERSON_SECTIONS.some(x => x.id === v);

/**
 * View and open person live in the query string (`?view=schedule&person=uid
 * &section=shifts&date=2026-10-08`) so a link can land on either. Written with
 * `history.replaceState`, not the router: changing a view must not issue an RSC
 * request (rule 9i), and the back button should leave the page, not step
 * through every tab someone clicked.
 */
function writeUrl(view: View, person: PersonState | null) {
  try {
    const params = new URLSearchParams();
    if (view !== "overview") params.set("view", view);
    if (person) {
      params.set("person", person.uid);
      params.set("section", person.section);
      if (person.date) params.set("date", person.date);
    }
    const qs = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  } catch {
    /* URL sync is a convenience; the page works without it */
  }
}

const noopSubscribe = () => () => {};
const readSearch = () => window.location.search;

function parseUrl(search: string | null): { view: View; person: PersonState | null } {
  const params = new URLSearchParams(search ?? "");
  const v = params.get("view");
  const uid = params.get("person");
  const section = params.get("section");
  const date = params.get("date");
  return {
    view: isView(v) ? v : "overview",
    person: uid
      ? {
          uid,
          section: isSection(section) ? section : "timeline",
          date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
        }
      : null,
  };
}

export default function ShiftManagementPage() {
  // The URL is read through useSyncExternalStore (server snapshot null), so the
  // server and the first client render agree and nothing is set in an effect.
  // Until someone picks a view or a person, the URL's value is the answer.
  // One `active_sessions` listener for the whole page (overview + person sheet).
  const { activeSessions, isLoading: liveLoading } = useActiveUsers();
  const search = useSyncExternalStore(noopSubscribe, readSearch, () => null);
  const fromUrl = useMemo(() => parseUrl(search), [search]);
  const [chosenView, setView] = useState<View | null>(null);
  const [chosenPerson, setPerson] = useState<PersonState | null | undefined>(undefined);
  const view = chosenView ?? fromUrl.view;
  const person = chosenPerson === undefined ? fromUrl.person : chosenPerson;

  useEffect(() => {
    if (search !== null) writeUrl(view, person);
  }, [view, person, search]);

  const openPerson = useCallback((uid: string, section: PersonSection = "timeline", date?: string) => {
    setPerson({ uid, section, date });
  }, []);

  return (
    <AppLayout>
      <div className="max-w-[90rem]">
        <h1 className="text-2xl font-bold tracking-tight mb-2">Shift Management</h1>
        <p className="text-sm text-zinc-400">
          Who&apos;s working, what needs a look, and everyone&apos;s hours. Click any name for that person&apos;s timesheet,
          screenshots, shifts and settings.
        </p>

        <Tabs value={view} onValueChange={v => setView(v as View)} className="mt-6">
          {/* pb-1.5: overflow-x:auto forces overflow-y to auto, so reserve room
              for the trigger focus ring instead of letting it clip. */}
          <div className="overflow-x-auto pb-1.5 border-b border-white/[0.07]">
            <TabsList variant="line">
              {VIEWS.map(v => (
                <TabsTrigger key={v.id} value={v.id}>{v.label}</TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="pt-6 min-h-[600px]">
            <TabsContent value="overview">
              <ShiftOverview activeSessions={activeSessions} liveLoading={liveLoading} onOpenPerson={openPerson} onOpenAnalytics={() => setView("analytics")} />
            </TabsContent>
            <TabsContent value="schedule">
              <AdminShifts onOpenPerson={uid => openPerson(uid, "shifts")} />
            </TabsContent>
            <TabsContent value="analytics">
              <AdminAnalytics onOpenPerson={uid => openPerson(uid, "analytics")} />
            </TabsContent>
            <TabsContent value="settings">
              <SettingsView onOpenScreenshots={uid => openPerson(uid, "screenshots")} />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <PersonSheet
        uid={person?.uid ?? null}
        activeSessions={activeSessions}
        section={person?.section ?? "timeline"}
        date={person?.date}
        onSectionChange={section => setPerson(person ? { ...person, section } : null)}
        onClose={() => setPerson(null)}
      />
    </AppLayout>
  );
}

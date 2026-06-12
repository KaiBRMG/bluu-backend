"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import LoadingScreen from "@/components/LoadingScreen";
import { LoadingGateProvider } from "@/contexts/LoadingGateContext";
import { useAuth } from "@/components/AuthProvider";
import { useUserData } from "@/hooks/useUserData";
import { usePermissions, getHighestGroupName } from "@/hooks/usePermissions";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

interface AppLayoutProps {
  children: React.ReactNode;
}

// Routes that are always accessible (no permission check needed)
const ALWAYS_ACCESSIBLE = ['/', '/applications/settings'];

// Minimum time the boot loader stays up so its animation plays at least one full
// cycle, even if data is ready sooner. Aesthetic floor, not a fixed duration —
// if data takes longer, the loader simply stays until it's ready.
const MIN_LOADER_MS = 3000;

// Whether the very first boot has finished. The loading screen waits on the
// home widgets' data only during this initial boot; after that, in-app navigation
// relies on each widget's own skeletons rather than the full-screen loader.
// Module-scoped so it survives AppLayout remounts on navigation but resets on a
// full app reload (a genuine new boot).
let appHasBooted = false;

export default function AppLayout({ children }: AppLayoutProps) {
  const { user } = useAuth();
  const { userData: firestoreUserData, loading: userDataLoading } = useUserData();
  const { teamspaces, accessiblePages, loading: permissionsLoading } = usePermissions();
  const pathname = usePathname();
  const router = useRouter();

  // Phase 1: the user doc (groups) and page permissions must resolve.
  const isDataLoading = userDataLoading || permissionsLoading;

  // Phase 2: widgets in the rendered page register loading gates (see
  // useLoadingGate). The screen stays up until every gate has cleared.
  const [hasPendingGates, setHasPendingGates] = useState(false);

  // Bridges the Phase-1 → Phase-2 handoff: while data is loading this is false,
  // so the loader stays up through the commit where data resolves and the
  // gated widgets first mount — preventing a one-frame flash before their gate
  // effects register. Initialised true on navigation (data already cached) so
  // the loader doesn't blink on every page change.
  const [gatesSettled, setGatesSettled] = useState(() => !isDataLoading);
  useEffect(() => {
    setGatesSettled(!isDataLoading);
  }, [isDataLoading]);

  // Minimum-display floor: keep the loader up for at least MIN_LOADER_MS from
  // when it first mounts, so the animation completes a full cycle on boot.
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  useEffect(() => {
    if (appHasBooted) return; // floor only applies to the initial boot
    const id = setTimeout(() => setMinTimeElapsed(true), MIN_LOADER_MS);
    return () => clearTimeout(id);
  }, []);

  const showLoader =
    isDataLoading ||
    (!appHasBooted && (!gatesSettled || hasPendingGates || !minTimeElapsed));

  // Latch the boot as complete the first time everything is ready.
  useEffect(() => {
    if (!showLoader) appHasBooted = true;
  }, [showLoader]);

  const userData = {
    name: firestoreUserData?.displayName || user?.displayName || "User",
    groupName: getHighestGroupName(firestoreUserData?.groups ?? []),
    photoURL: firestoreUserData?.photoURL || null,
  };

  // Route protection: redirect if user navigates to an inaccessible page
  // Only redirect after we have data (from cache or API)
  useEffect(() => {
    if (permissionsLoading) return;
    if (accessiblePages.length === 0 && teamspaces.length === 0) return;

    if (ALWAYS_ACCESSIBLE.some(r => pathname === r || pathname === r + '/')) return;
    if (pathname.startsWith('/auth/')) return;

    const hasAccess = accessiblePages.some(p => p.href && pathname.startsWith(p.href));
    if (!hasAccess) {
      router.replace('/');
    }
  }, [pathname, accessiblePages, teamspaces, permissionsLoading, router]);

  // Render the real layout underneath the loader so its widgets mount and start
  // fetching; LoadingScreen overlays on top until everything is ready.
  return (
    <LoadingGateProvider onPendingChange={setHasPendingGates}>
      {showLoader && <LoadingScreen />}
      <SidebarProvider>
        <Sidebar
          teamspaces={teamspaces}
          accessiblePages={accessiblePages}
          userData={userData}
        />
        <SidebarInset>
          <TopBar />
          <main className="flex-1 overflow-y-auto p-8">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </LoadingGateProvider>
  );
}

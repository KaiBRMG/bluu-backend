"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { useBootPhase } from "@/contexts/BootLoaderContext";
import { useAuth } from "@/components/AuthProvider";
import { useUserData } from "@/hooks/useUserData";
import { usePermissions, getHighestGroupName } from "@/hooks/usePermissions";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

interface AppLayoutProps {
  children: React.ReactNode;
}

// Routes that are always accessible (no permission check needed)
const ALWAYS_ACCESSIBLE = ['/', '/applications/settings'];

export default function AppLayout({ children }: AppLayoutProps) {
  const { user } = useAuth();
  const { userData: firestoreUserData, loading: userDataLoading } = useUserData();
  const { teamspaces, accessiblePages, loading: permissionsLoading } = usePermissions();
  const pathname = usePathname();
  const router = useRouter();

  // The user doc (groups) and page permissions must resolve before the UI is
  // meaningful (otherwise the sidebar is empty and the home page shows the
  // "Unassigned" group card).
  const isDataLoading = userDataLoading || permissionsLoading;

  // Bridge the data → widgets hand-off: keep the data phase pending for one extra
  // commit after data resolves, so the home widgets mount and register their own
  // boot phases before this one clears — preventing a one-frame flash of the UI
  // before their gates take over.
  const [gatesSettled, setGatesSettled] = useState(() => !isDataLoading);
  useEffect(() => {
    setGatesSettled(!isDataLoading);
  }, [isDataLoading]);

  useBootPhase('app-data', isDataLoading || !gatesSettled);

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

  // The real layout renders underneath the persistent boot loader (provided by
  // BootLoaderProvider above), so its widgets mount and start fetching while the
  // loader stays on top until everything — including those widgets — is ready.
  return (
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
  );
}

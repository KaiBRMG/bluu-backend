"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import LoadingScreen from "@/components/LoadingScreen";
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

  // Keep the loading screen up until both the user doc (groups) and page
  // permissions have resolved. Otherwise the home page flashes the "Unassigned"
  // group card and the sidebar renders empty before data lands.
  const isDataLoading = userDataLoading || permissionsLoading;

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

  if (isDataLoading) {
    return <LoadingScreen />;
  }

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

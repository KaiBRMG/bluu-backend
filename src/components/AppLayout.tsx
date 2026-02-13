"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { useAuth } from "@/components/AuthProvider";
import { useUserData } from "@/hooks/useUserData";
import { usePermissions, getHighestGroupName } from "@/hooks/usePermissions";

interface AppLayoutProps {
  children: React.ReactNode;
}

// Routes that are always accessible (no permission check needed)
const ALWAYS_ACCESSIBLE = ['/', '/applications/settings'];

export default function AppLayout({ children }: AppLayoutProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { user } = useAuth();
  const { userData: firestoreUserData } = useUserData();
  const { teamspaces, accessiblePages, loading: permissionsLoading, canAccess } = usePermissions();
  const pathname = usePathname();
  const router = useRouter();

  // Compute highest group display name
  const highestGroup = getHighestGroupName(firestoreUserData?.groups || []);

  const userData = {
    name: firestoreUserData?.displayName || user?.displayName || "User",
    email: user?.email || "",
    role: highestGroup,
    photoURL: firestoreUserData?.photoURL || user?.photoURL || null,
  };

  // Route protection: redirect to home if user navigates to an inaccessible page
  useEffect(() => {
    if (permissionsLoading) return;

    // Always-accessible routes
    if (ALWAYS_ACCESSIBLE.some(r => pathname === r || pathname === r + '/')) return;

    // Auth routes bypass
    if (pathname.startsWith('/auth/')) return;

    // Check if current route matches any accessible page
    const hasAccess = accessiblePages.some(p => p.href && pathname.startsWith(p.href));
    if (!hasAccess) {
      router.replace('/');
    }
  }, [pathname, accessiblePages, permissionsLoading, router]);

  return (
    <div className="flex h-screen text-white overflow-hidden" style={{ background: 'var(--background)' }}>
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        teamspaces={teamspaces}
        accessiblePages={accessiblePages}
        permissionsLoading={permissionsLoading}
      />

      <div className="flex flex-col flex-1 overflow-hidden main-content">
        <TopBar userData={userData} />

        <main className="flex-1 overflow-y-auto p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

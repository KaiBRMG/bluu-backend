"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { useAuth } from "@/components/AuthProvider";
import { useUserData } from "@/hooks/useUserData";

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { user } = useAuth();
  const { userData: firestoreUserData } = useUserData();

  // Get the first group from the user's groups array, or default to "General"
  const userGroup = firestoreUserData?.groups?.[0] || "general";
  const displayGroup = userGroup.charAt(0).toUpperCase() + userGroup.slice(1);

  const userData = {
    name: user?.displayName || "User",
    email: user?.email || "",
    role: displayGroup,
    avatar: user?.photoURL || "/avatar-placeholder.png"
  };

  return (
    <div className="flex h-screen text-white overflow-hidden" style={{ background: 'var(--background)' }}>
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        userData={userData}
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

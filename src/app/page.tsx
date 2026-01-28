"use client";

import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/components/AuthProvider";
import { useUserData } from "@/hooks/useUserData";

export default function Home() {
  const { user } = useAuth();
  const { userData } = useUserData();
  const firstName = user?.displayName?.split(' ')[0] || 'User';

  // Get the first group from the user's groups array, or default to "General"
  const userGroup = userData?.groups?.[0] || "general";
  const displayGroup = userGroup.charAt(0).toUpperCase() + userGroup.slice(1);

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <h1 className="text-5xl font-bold mb-2 tracking-tight">
          Welcome, {firstName}
        </h1>
        <p className="text-lg" style={{ color: 'var(--foreground-secondary)' }}>
          Your personalized workspace
        </p>

        {/* Quick stats or widgets can go here */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div
            className="rounded-lg p-6 transition-colors"
            style={{
              background: 'var(--sidebar-background)',
              border: '1px solid var(--border-subtle)'
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)'}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
          >
            <h3 className="text-sm uppercase tracking-wide mb-2" style={{ color: 'var(--foreground-secondary)' }}>Team</h3>
            <p className="text-2xl font-semibold">{displayGroup}</p>
          </div>

          <div
            className="rounded-lg p-6 transition-colors"
            style={{
              background: 'var(--sidebar-background)',
              border: '1px solid var(--border-subtle)'
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)'}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
          >
            <h3 className="text-sm uppercase tracking-wide mb-2" style={{ color: 'var(--foreground-secondary)' }}>Active Projects</h3>
            <p className="text-2xl font-semibold">5</p>
          </div>

          <div
            className="rounded-lg p-6 transition-colors"
            style={{
              background: 'var(--sidebar-background)',
              border: '1px solid var(--border-subtle)'
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)'}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
          >
            <h3 className="text-sm uppercase tracking-wide mb-2" style={{ color: 'var(--foreground-secondary)' }}>Notifications</h3>
            <p className="text-2xl font-semibold">12</p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

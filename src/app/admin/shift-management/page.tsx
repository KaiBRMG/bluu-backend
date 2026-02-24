"use client";

import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import ShiftManagementSidebar from "@/components/admin/shift-management/ShiftManagementSidebar";
import AdminTimesheets from "@/components/admin/shift-management/AdminTimesheets";
import AdminScreenshots from "@/components/admin/shift-management/AdminScreenshots";
import AdminActiveUsers from "@/components/admin/shift-management/AdminActiveUsers";

export default function ShiftManagementPage() {
  const [activeSection, setActiveSection] = useState('active-users');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const renderContent = () => {
    switch (activeSection) {
      case 'active-users':
        return <AdminActiveUsers />;
      case 'timesheets':
        return <AdminTimesheets selectedUserId={selectedUserId} onUserChange={setSelectedUserId} />;
      case 'screenshots':
        return <AdminScreenshots selectedUserId={selectedUserId} onUserChange={setSelectedUserId} />;
      default:
        return null;
    }
  };

  return (
    <AppLayout>
      <div className="max-w-6xl">
        <h1 className="text-5xl font-bold mb-2 tracking-tight">
          Shift Management
        </h1>
        <p className="text-lg" style={{ color: 'var(--foreground-secondary)' }}>
          View and manage employee timesheets and screenshots.
        </p>

        <div className="mt-8 flex gap-6">
          <ShiftManagementSidebar
            activeSection={activeSection}
            onSectionChange={setActiveSection}
          />

          <div
            className="flex-1 rounded-lg p-6"
            style={{
              background: 'var(--sidebar-background)',
              border: '1px solid var(--border-subtle)',
              minHeight: '600px',
            }}
          >
            {renderContent()}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

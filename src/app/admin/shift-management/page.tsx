"use client";

import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import ShiftManagementSidebar from "@/components/admin/shift-management/ShiftManagementSidebar";
import AdminTimesheets from "@/components/admin/shift-management/AdminTimesheets";
import AdminScreenshots from "@/components/admin/shift-management/AdminScreenshots";
import AdminActiveUsers from "@/components/admin/shift-management/AdminActiveUsers";
import AdminShifts from "@/components/admin/shift-management/AdminShifts";

export default function ShiftManagementPage() {
  const [activeSection, setActiveSection] = useState('shifts');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const renderContent = () => {
    switch (activeSection) {
      case 'shifts':
        return <AdminShifts />;
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

        <div
          className="mt-8 rounded-lg"
          style={{
            background: 'var(--sidebar-background)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div className="px-6 pt-4">
            <ShiftManagementSidebar
              activeSection={activeSection}
              onSectionChange={setActiveSection}
            />
          </div>

          <div className="p-6" style={{ minHeight: '600px' }}>
            {renderContent()}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

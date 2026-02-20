"use client";

import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import ShiftManagementSidebar from "@/components/admin/shift-management/ShiftManagementSidebar";
import AdminTimesheets from "@/components/admin/shift-management/AdminTimesheets";

export default function ShiftManagementPage() {
  const [activeSection, setActiveSection] = useState('timesheets');

  const renderContent = () => {
    switch (activeSection) {
      case 'timesheets':
        return <AdminTimesheets />;
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
          View and manage employee timesheets.
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

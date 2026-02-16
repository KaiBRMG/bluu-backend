"use client";

import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import SettingsSidebar from "@/components/settings/SettingsSidebar";
import PersonalInfoForm from "@/components/settings/PersonalInfoForm";
import AppSettingsForm from "@/components/settings/AppSettingsForm";

export default function Settings() {
  const [activeSection, setActiveSection] = useState('personal-info');

  const renderContent = () => {
    switch (activeSection) {
      case 'personal-info':
        return <PersonalInfoForm />;
      case 'app-settings':
        return <AppSettingsForm onSectionChange={setActiveSection} />;
      case 'section-3':
        return (
          <div className="flex items-center justify-center h-64">
            <p style={{ color: 'var(--foreground-secondary)' }}>
              Section 3 content coming soon...
            </p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <h1 className="text-5xl font-bold mb-2 tracking-tight">
          Settings
        </h1>
        <p className="text-lg" style={{ color: 'var(--foreground-secondary)' }}>
          Update your user settings.
        </p>

        {/* Settings Layout: Sidebar + Content */}
        <div className="mt-8 flex gap-6">
          <SettingsSidebar
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

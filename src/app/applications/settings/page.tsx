"use client";

import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import PersonalInfoForm from "@/components/settings/PersonalInfoForm";
import AppSettingsForm from "@/components/settings/AppSettingsForm";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function Settings() {
  const [activeSection, setActiveSection] = useState('personal-info');

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Update your user settings.
        </p>

        <div
          className="mt-8 rounded-lg"
          style={{
            background: 'var(--sidebar-background)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <Tabs
            value={activeSection}
            onValueChange={setActiveSection}
          >
            <div className="px-6 pt-4">
              <TabsList>
                <TabsTrigger value="personal-info">Personal Information</TabsTrigger>
                <TabsTrigger value="app-settings">App Settings</TabsTrigger>
              </TabsList>
            </div>

            <div className="p-6" style={{ minHeight: '600px' }}>
              <TabsContent value="personal-info"><PersonalInfoForm /></TabsContent>
              <TabsContent value="app-settings">
                <AppSettingsForm onSectionChange={setActiveSection} />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}

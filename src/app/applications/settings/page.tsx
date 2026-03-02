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

        <div className="mt-8">
          <Tabs
            orientation="vertical"
            value={activeSection}
            onValueChange={setActiveSection}
            className="flex gap-6"
          >
            <TabsList
              variant="line"
              className="w-56 flex-shrink-0 rounded-lg p-2 h-fit"
              style={{
                background: 'var(--sidebar-background)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <TabsTrigger value="personal-info">Personal Information</TabsTrigger>
              <TabsTrigger value="app-settings">App Settings</TabsTrigger>
            </TabsList>

            <div
              className="flex-1 rounded-lg p-6"
              style={{
                background: 'var(--sidebar-background)',
                border: '1px solid var(--border-subtle)',
                minHeight: '600px',
              }}
            >
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

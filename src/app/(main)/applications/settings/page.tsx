"use client";

import { useState, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import PersonalInfoForm from "@/components/settings/PersonalInfoForm";
import AppSettingsForm from "@/components/settings/AppSettingsForm";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

export default function Settings() {
  const [activeSection, setActiveSection] = useState('personal-info');
  const [personalInfoHasChanges, setPersonalInfoHasChanges] = useState(false);
  const [pendingSection, setPendingSection] = useState<string | null>(null);

  const handleTabChange = useCallback((value: string) => {
    if (activeSection === 'personal-info' && personalInfoHasChanges) {
      setPendingSection(value);
    } else {
      setActiveSection(value);
    }
  }, [activeSection, personalInfoHasChanges]);

  const handleConfirmLeave = () => {
    if (pendingSection) {
      setActiveSection(pendingSection);
      setPersonalInfoHasChanges(false);
    }
    setPendingSection(null);
  };

  const handleCancelLeave = () => {
    setPendingSection(null);
  };

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
            onValueChange={handleTabChange}
          >
            <div className="px-6 pt-4">
              <TabsList>
                <TabsTrigger value="personal-info">Personal Information</TabsTrigger>
                <TabsTrigger value="app-settings">App Settings</TabsTrigger>
              </TabsList>
            </div>

            <div className="p-6" style={{ minHeight: '600px' }}>
              <TabsContent value="personal-info">
                <PersonalInfoForm onHasChanges={setPersonalInfoHasChanges} />
              </TabsContent>
              <TabsContent value="app-settings">
                <AppSettingsForm onSectionChange={setActiveSection} />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>

      <AlertDialog open={pendingSection !== null} onOpenChange={(open) => { if (!open) handleCancelLeave(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes in Personal Information. If you leave now, your changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelLeave}>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmLeave} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Leave without saving
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

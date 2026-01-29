"use client";

import AppLayout from "@/components/AppLayout";

export default function Settings() {
  return (
    <AppLayout>
      <div className="max-w-5xl">
        <h1 className="text-5xl font-bold mb-2 tracking-tight">
          Settings
        </h1>
        <p className="text-lg" style={{ color: 'var(--foreground-secondary)' }}>
          Update your user settings.
        </p>

        {/* Empty state placeholder */}
        <div className="mt-12">
          <div
            className="rounded-lg p-8 text-center"
            style={{
              background: 'var(--sidebar-background)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <p className="text-lg" style={{ color: 'var(--foreground-secondary)' }}>
              .
            </p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

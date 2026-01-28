"use client";

import AppLayout from "@/components/AppLayout";

export default function ShiftsPage() {
  return (
    <AppLayout>
      <div className="max-w-5xl">
        <h1 className="text-5xl font-bold mb-2 tracking-tight">
          Shifts
        </h1>
        <p className="text-lg" style={{ color: 'var(--foreground-secondary)' }}>
          See the current shift schedule
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

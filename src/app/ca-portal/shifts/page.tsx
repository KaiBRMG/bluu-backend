"use client";

import AppLayout from "@/components/AppLayout";

export default function ShiftsPage() {
  return (
    <AppLayout>
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          Shifts
        </h1>
        <p className="text-sm text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">
              .
            </p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

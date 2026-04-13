"use client";

import AppLayout from "@/components/AppLayout";

export default function CustomRequestsPage() {
  return (
    <AppLayout>
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          Custom Requests
        </h1>

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

"use client";

import { useMemo } from "react";
import AppLayout from "@/components/AppLayout";
import { useAdminData } from "@/hooks/useAdminData";
import PermissionTable from "@/components/admin/sharing/PermissionTable";
import EffectivePermissionsPreview from "@/components/admin/sharing/EffectivePermissionsPreview";

export default function SharingPage() {
  const { pages, teamspaces, pagePermissions, groups, users, loading, error, updatePermission } =
    useAdminData();

  // Group pages by teamspace
  const pagesByTeamspace = useMemo(() => {
    const map = new Map<string, typeof pages>();
    for (const page of pages) {
      const key = page.teamspaceId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(page);
    }
    return map;
  }, [pages]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div style={{ color: "var(--foreground-muted)" }}>Loading sharing settings...</div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="text-red-400 mb-2">Error loading sharing settings</div>
            <div className="text-sm" style={{ color: "var(--foreground-muted)" }}>
              {error}
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight mb-2">Sharing & Permissions</h1>
          <p className="text-sm text-muted-foreground">
            Manage which groups and users can access each page.
          </p>
        </div>

        {/* Permission tables by teamspace */}
        {teamspaces
          .sort((a, b) => a.order - b.order)
          .map((ts) => {
            const tsPages = pagesByTeamspace.get(ts.id);
            if (!tsPages || tsPages.length === 0) return null;

            return (
              <PermissionTable
                key={ts.id}
                teamspaceName={ts.name}
                pages={tsPages}
                pagePermissions={pagePermissions}
                groups={groups}
                users={users}
                onUpdatePermission={updatePermission}
              />
            );
          })}

        {/* Effective permissions preview */}
        <div className="mt-8">
          <EffectivePermissionsPreview
            pages={pages}
            teamspaces={teamspaces}
            pagePermissions={pagePermissions}
            users={users}
          />
        </div>
      </div>
    </AppLayout>
  );
}

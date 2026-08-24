"use client";

import { useMemo } from "react";
import AppLayout from "@/components/AppLayout";
import { useAdminData } from "@/hooks/useAdminData";
import PermissionTable from "@/components/admin/sharing/PermissionTable";
import EffectivePermissionsPreview from "@/components/admin/sharing/EffectivePermissionsPreview";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Loading state shaped to the permission tables it replaces. */
function SharingSkeleton() {
  return (
    <div aria-hidden>
      {[0, 1].map((table) => (
        <div key={table} className="mb-8">
          <Skeleton className="mb-3 ml-1 h-4 w-32" />
          <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025]">
            <div className="h-10 border-b border-white/[0.07] bg-white/[0.04]" />
            {[0, 1, 2, 3].map((row) => (
              <div
                key={row}
                className="flex items-center gap-4 border-b border-white/[0.07] px-2 py-3 last:border-b-0"
              >
                <Skeleton className="size-4 shrink-0 rounded-[4px]" />
                <Skeleton className="h-4 w-[164px]" />
                <div className="flex flex-1 justify-center gap-16">
                  {[0, 1, 2, 3].map((box) => (
                    <Skeleton key={box} className="size-4 rounded-[4px]" />
                  ))}
                </div>
                <Skeleton className="h-8 w-[240px] rounded-md" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SharingPage() {
  const {
    pages,
    teamspaces,
    pagePermissions,
    groups,
    users,
    loading,
    error,
    updatePermission,
    refetch,
  } = useAdminData();

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

  // Never sort the hook's state array in place.
  const orderedTeamspaces = useMemo(
    () =>
      [...teamspaces]
        .sort((a, b) => a.order - b.order)
        .filter((ts) => (pagesByTeamspace.get(ts.id)?.length ?? 0) > 0),
    [teamspaces, pagesByTeamspace]
  );

  const header = (
    <div className="mb-6">
      <h1 className="mb-2 text-2xl font-bold tracking-tight">Sharing &amp; Permissions</h1>
      <p className="text-sm text-zinc-400">
        Manage which groups and users can access each page.
      </p>
    </div>
  );

  if (loading) {
    return (
      <AppLayout>
        <div className="max-w-6xl">
          {header}
          <SharingSkeleton />
          <span className="sr-only" role="status">
            Loading sharing settings…
          </span>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    // A 403 is an authorization problem, not a transient one — retrying won't help.
    const isForbidden = /admin access required/i.test(error);
    return (
      <AppLayout>
        <div className="max-w-6xl">
          {header}
          <div
            role="alert"
            className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-6"
          >
            <p className="text-sm font-medium text-red-400">
              {isForbidden
                ? "You don't have permission to manage sharing"
                : "Couldn't load sharing settings"}
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              {isForbidden
                ? "This page is restricted to admins. Ask an admin to grant you access."
                : error}
            </p>
            {!isForbidden && (
              <Button variant="outline" size="sm" className="mt-4" onClick={refetch}>
                Try again
              </Button>
            )}
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-6xl">
        {header}

        {orderedTeamspaces.length === 0 ? (
          <p className="text-sm text-zinc-400">No pages to manage yet.</p>
        ) : (
          orderedTeamspaces.map((ts) => (
            <PermissionTable
              key={ts.id}
              teamspaceName={ts.name}
              pages={pagesByTeamspace.get(ts.id)!}
              pagePermissions={pagePermissions}
              groups={groups}
              users={users}
              onUpdatePermission={updatePermission}
            />
          ))
        )}

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

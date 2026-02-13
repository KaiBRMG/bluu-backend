"use client";

import { useState, useMemo } from "react";
import type { PageDocument, PermissionRole, TeamspaceDocument } from "@/types/firestore";
import { GROUP_DISPLAY_NAMES } from "@/types/firestore";
import { resolvePagePermission } from "@/lib/services/permissionResolver";

interface AdminUser {
  uid: string;
  displayName: string;
  workEmail: string;
  groups: string[];
  photoURL?: string;
}

interface EffectivePermissionsPreviewProps {
  pages: PageDocument[];
  teamspaces: TeamspaceDocument[];
  users: AdminUser[];
}

export default function EffectivePermissionsPreview({
  pages,
  teamspaces,
  users,
}: EffectivePermissionsPreviewProps) {
  const [selectedUid, setSelectedUid] = useState("");

  const selectedUser = users.find((u) => u.uid === selectedUid);

  const effectivePermissions = useMemo(() => {
    if (!selectedUser) return [];

    return pages
      .sort((a, b) => {
        const tsA = teamspaces.find((t) => t.id === a.teamspaceId)?.order ?? 0;
        const tsB = teamspaces.find((t) => t.id === b.teamspaceId)?.order ?? 0;
        if (tsA !== tsB) return tsA - tsB;
        return a.order - b.order;
      })
      .map((page) => {
        const resolved = resolvePagePermission(
          page,
          selectedUser.uid,
          selectedUser.groups || []
        );
        const tsName =
          teamspaces.find((t) => t.id === page.teamspaceId)?.name ||
          page.teamspaceId;

        return {
          pageId: page.pageId,
          title: page.title,
          teamspaceName: tsName,
          teamspaceId: page.teamspaceId,
          access: resolved
            ? {
                role: resolved.role,
                via: resolved.via,
                groupName:
                  resolved.via === "group" && resolved.groupId
                    ? GROUP_DISPLAY_NAMES[resolved.groupId] || resolved.groupId
                    : undefined,
              }
            : null,
        };
      });
  }, [selectedUid, pages, teamspaces, selectedUser]);

  const roleLabel = (role: PermissionRole) => {
    switch (role) {
      case "full_access":
        return "Full Access";
      case "can_edit":
        return "Can Edit";
      case "can_view":
        return "Can View";
    }
  };

  const roleColor = (role: PermissionRole) => {
    switch (role) {
      case "full_access":
        return "#22c55e";
      case "can_edit":
        return "#3b82f6";
      case "can_view":
        return "#eab308";
    }
  };

  // Group results by teamspace for display
  const groupedByTeamspace = useMemo(() => {
    const map = new Map<string, typeof effectivePermissions>();
    for (const item of effectivePermissions) {
      const key = item.teamspaceId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [effectivePermissions]);

  return (
    <div
      className="rounded-lg p-4"
      style={{
        border: "1px solid var(--border-subtle)",
        background: "rgba(255, 255, 255, 0.02)",
      }}
    >
      <h3 className="text-sm font-semibold mb-3">Effective Permissions Preview</h3>

      <div className="mb-4">
        <select
          className="form-input text-sm"
          style={{ maxWidth: "300px" }}
          value={selectedUid}
          onChange={(e) => setSelectedUid(e.target.value)}
        >
          <option value="">Select a user to preview...</option>
          {users.map((u) => (
            <option key={u.uid} value={u.uid}>
              {u.displayName} ({u.workEmail})
            </option>
          ))}
        </select>

        {selectedUser && (
          <div className="mt-2 text-xs" style={{ color: "var(--foreground-muted)" }}>
            Groups: {selectedUser.groups?.map((g) => GROUP_DISPLAY_NAMES[g] || g).join(", ") || "None"}
          </div>
        )}
      </div>

      {selectedUser && (
        <div className="space-y-4">
          {groupedByTeamspace.map(([tsId, items]) => (
            <div key={tsId}>
              <div
                className="text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: "var(--foreground-muted)" }}
              >
                {items[0]?.teamspaceName}
              </div>

              <div className="space-y-1">
                {items.map((item) => (
                  <div
                    key={item.pageId}
                    className="flex items-center justify-between px-3 py-2 rounded"
                    style={{ background: "rgba(255, 255, 255, 0.03)" }}
                  >
                    <span className="text-sm">{item.title}</span>

                    {item.access ? (
                      <div className="flex items-center gap-2">
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded"
                          style={{
                            color: roleColor(item.access.role),
                            background: `${roleColor(item.access.role)}15`,
                          }}
                        >
                          {roleLabel(item.access.role)}
                        </span>
                        <span
                          className="text-xs"
                          style={{ color: "var(--foreground-muted)" }}
                        >
                          via{" "}
                          {item.access.via === "group"
                            ? item.access.groupName
                            : "Direct"}
                        </span>
                      </div>
                    ) : (
                      <span
                        className="text-xs"
                        style={{ color: "var(--foreground-muted)" }}
                      >
                        No Access
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

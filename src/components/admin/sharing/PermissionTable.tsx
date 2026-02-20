"use client";

import { useState, useRef, useEffect } from "react";
import type { PagePermissionDoc } from "@/types/firestore";
import type { PageDef } from "@/lib/definitions";

interface AdminGroup {
  id: string;
  name: string;
  level: number;
}

interface AdminUser {
  uid: string;
  displayName: string;
  workEmail: string;
  groups: string[];
  photoURL?: string;
}

interface PermissionTableProps {
  pages: PageDef[];
  teamspaceName: string;
  pagePermissions: PagePermissionDoc[];
  groups: AdminGroup[];
  users: AdminUser[];
  onUpdatePermission: (
    pageId: string,
    permissions: { groups: Record<string, true>; users: Record<string, true> }
  ) => Promise<void>;
}

export default function PermissionTable({
  pages,
  teamspaceName,
  pagePermissions,
  groups,
  users,
  onUpdatePermission,
}: PermissionTableProps) {
  const [saving, setSaving] = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Filter out 'unassigned' group, sort by level
  const assignableGroups = groups
    .filter((g) => g.id !== "unassigned")
    .sort((a, b) => a.level - b.level);

  // Get permission doc for a page
  const getPermDoc = (pageId: string): PagePermissionDoc | undefined =>
    pagePermissions.find((p) => p.pageId === pageId);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
    }
    if (openDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [openDropdown]);

  const handleGroupToggle = async (pageId: string, groupId: string, currentlyHasAccess: boolean) => {
    setSaving(pageId);
    try {
      const permDoc = getPermDoc(pageId);
      const currentGroups = { ...(permDoc?.groups || {}) };
      const currentUsers = { ...(permDoc?.users || {}) };

      if (currentlyHasAccess) {
        delete currentGroups[groupId];
      } else {
        currentGroups[groupId] = true;
      }

      await onUpdatePermission(pageId, { groups: currentGroups as Record<string, true>, users: currentUsers as Record<string, true> });
    } catch (err) {
      console.error("Failed to update group permission:", err);
    } finally {
      setSaving(null);
    }
  };

  const handleUserToggle = async (pageId: string, uid: string, currentlyHasAccess: boolean) => {
    setOpenDropdown(null);
    setSaving(pageId);
    try {
      const permDoc = getPermDoc(pageId);
      const currentGroups = { ...(permDoc?.groups || {}) };
      const currentUsers = { ...(permDoc?.users || {}) };

      if (currentlyHasAccess) {
        delete currentUsers[uid];
      } else {
        currentUsers[uid] = true;
      }

      await onUpdatePermission(pageId, { groups: currentGroups as Record<string, true>, users: currentUsers as Record<string, true> });
    } catch (err) {
      console.error("Failed to update user permission:", err);
    } finally {
      setSaving(null);
    }
  };

  const getSharedUserCount = (pageId: string): number => {
    const permDoc = getPermDoc(pageId);
    return Object.keys(permDoc?.users || {}).length;
  };

  return (
    <div className="mb-8">
      <h3
        className="text-sm font-semibold uppercase tracking-wider mb-3 px-1"
        style={{ color: "var(--foreground-muted)" }}
      >
        {teamspaceName}
      </h3>

      <div
        className="rounded-lg"
        style={{ border: "1px solid var(--border-subtle)" }}
      >
        {/* Header */}
        <div
          className="grid items-center px-4 py-2 text-xs font-medium uppercase tracking-wider"
          style={{
            gridTemplateColumns: `180px repeat(${assignableGroups.length}, 80px) 1fr`,
            background: "rgba(255, 255, 255, 0.03)",
            color: "var(--foreground-muted)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div>Page</div>
          {assignableGroups.map((g) => (
            <div key={g.id} className="text-center">{g.id}</div>
          ))}
          <div>Individuals</div>
        </div>

        {/* Rows */}
        {pages
          .sort((a, b) => a.order - b.order)
          .map((page) => {
            const permDoc = getPermDoc(page.pageId);
            const sharedCount = getSharedUserCount(page.pageId);
            const isDropdownOpen = openDropdown === page.pageId;

            return (
              <div
                key={page.pageId}
                className="px-4 py-3"
                style={{
                  borderBottom: "1px solid var(--border-subtle)",
                  opacity: saving === page.pageId ? 0.6 : 1,
                  transition: "opacity 120ms",
                }}
              >
                <div
                  className="grid items-center"
                  style={{
                    gridTemplateColumns: `180px repeat(${assignableGroups.length}, 80px) 1fr`,
                  }}
                >
                  {/* Page name */}
                  <div className="font-medium text-sm">{page.title}</div>

                  {/* Group checkboxes */}
                  {assignableGroups.map((g) => {
                    const hasAccess = !!permDoc?.groups?.[g.id];
                    return (
                      <div key={g.id} className="flex justify-center">
                        <input
                          type="checkbox"
                          checked={hasAccess}
                          onChange={() => handleGroupToggle(page.pageId, g.id, hasAccess)}
                          disabled={saving === page.pageId}
                          className="w-4 h-4 rounded cursor-pointer"
                          style={{ accentColor: "#3b82f6" }}
                        />
                      </div>
                    );
                  })}

                  {/* Users dropdown */}
                  <div className="relative" ref={isDropdownOpen ? dropdownRef : undefined}>
                    <button
                      onClick={() => setOpenDropdown(isDropdownOpen ? null : page.pageId)}
                      className="form-input text-sm flex items-center justify-between gap-2 w-full"
                      style={{ padding: "4px 8px", maxWidth: "220px", cursor: "pointer" }}
                      disabled={saving === page.pageId}
                    >
                      <span style={{ color: sharedCount > 0 ? "var(--foreground)" : "var(--foreground-muted)" }}>
                        {sharedCount > 0
                          ? `Shared with ${sharedCount} individual${sharedCount > 1 ? "s" : ""}`
                          : "No individuals"}
                      </span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>

                    {isDropdownOpen && (
                      <div
                        className="absolute top-full left-0 mt-1 w-64 max-h-60 overflow-y-auto rounded-lg shadow-xl z-50"
                        style={{
                          background: "var(--sidebar-background)",
                          border: "1px solid var(--border-subtle)",
                        }}
                      >
                        {users.length === 0 ? (
                          <div className="px-3 py-2 text-xs" style={{ color: "var(--foreground-muted)" }}>
                            No users available
                          </div>
                        ) : (
                          users.map((u) => {
                            const userHasAccess = !!permDoc?.users?.[u.uid];
                            return (
                              <button
                                key={u.uid}
                                onClick={() => handleUserToggle(page.pageId, u.uid, userHasAccess)}
                                className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors"
                                style={{
                                  background: userHasAccess ? "rgba(59, 130, 246, 0.1)" : "transparent",
                                }}
                                onMouseEnter={(e) => {
                                  if (!userHasAccess) e.currentTarget.style.background = "var(--hover-background)";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = userHasAccess ? "rgba(59, 130, 246, 0.1)" : "transparent";
                                }}
                                disabled={saving === page.pageId}
                              >
                                {userHasAccess ? (
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                ) : (
                                  <div className="w-4 h-4" />
                                )}
                                <div className="flex flex-col min-w-0">
                                  <span className="truncate">{u.displayName}</span>
                                  <span className="text-xs truncate" style={{ color: "var(--foreground-muted)" }}>
                                    {u.workEmail}
                                  </span>
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

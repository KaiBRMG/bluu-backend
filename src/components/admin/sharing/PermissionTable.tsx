"use client";

import { useState } from "react";
import type { PageDocument, PermissionRole } from "@/types/firestore";
import { GROUP_DISPLAY_NAMES } from "@/types/firestore";

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
  pages: PageDocument[];
  teamspaceName: string;
  groups: AdminGroup[];
  users: AdminUser[];
  onUpdatePermission: (
    pageId: string,
    permissions: { users: Record<string, PermissionRole>; groups: Record<string, PermissionRole> }
  ) => Promise<void>;
}

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "No Access" },
  { value: "can_view", label: "Can View" },
  { value: "can_edit", label: "Can Edit" },
  { value: "full_access", label: "Full Access" },
];

export default function PermissionTable({
  pages,
  teamspaceName,
  groups,
  users,
  onUpdatePermission,
}: PermissionTableProps) {
  const [saving, setSaving] = useState<string | null>(null);
  const [addingUserTo, setAddingUserTo] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUserRole, setSelectedUserRole] = useState<PermissionRole>("can_view");

  // Filter out the 'general' group from the permission columns
  const assignableGroups = groups.filter((g) => g.id !== "general").sort((a, b) => a.level - b.level);

  const handleGroupRoleChange = async (
    page: PageDocument,
    groupId: string,
    newRole: string
  ) => {
    setSaving(page.pageId);
    try {
      const updatedGroups = { ...page.permissions.groups };
      if (newRole === "") {
        delete updatedGroups[groupId];
      } else {
        updatedGroups[groupId] = newRole as PermissionRole;
      }
      await onUpdatePermission(page.pageId, {
        users: page.permissions.users || {},
        groups: updatedGroups,
      });
    } catch (err) {
      console.error("Failed to update group permission:", err);
    } finally {
      setSaving(null);
    }
  };

  const handleRemoveUser = async (page: PageDocument, uid: string) => {
    setSaving(page.pageId);
    try {
      const updatedUsers = { ...page.permissions.users };
      delete updatedUsers[uid];
      await onUpdatePermission(page.pageId, {
        users: updatedUsers,
        groups: page.permissions.groups || {},
      });
    } catch (err) {
      console.error("Failed to remove user permission:", err);
    } finally {
      setSaving(null);
    }
  };

  const handleAddUser = async (page: PageDocument) => {
    if (!selectedUserId) return;

    // Prevent duplicates
    if (page.permissions.users?.[selectedUserId]) {
      setAddingUserTo(null);
      setSelectedUserId("");
      return;
    }

    setSaving(page.pageId);
    try {
      const updatedUsers = { ...(page.permissions.users || {}), [selectedUserId]: selectedUserRole };
      await onUpdatePermission(page.pageId, {
        users: updatedUsers,
        groups: page.permissions.groups || {},
      });
    } catch (err) {
      console.error("Failed to add user permission:", err);
    } finally {
      setSaving(null);
      setAddingUserTo(null);
      setSelectedUserId("");
      setSelectedUserRole("can_view");
    }
  };

  const handleUserRoleChange = async (
    page: PageDocument,
    uid: string,
    newRole: string
  ) => {
    setSaving(page.pageId);
    try {
      const updatedUsers = { ...page.permissions.users };
      if (newRole === "") {
        delete updatedUsers[uid];
      } else {
        updatedUsers[uid] = newRole as PermissionRole;
      }
      await onUpdatePermission(page.pageId, {
        users: updatedUsers,
        groups: page.permissions.groups || {},
      });
    } catch (err) {
      console.error("Failed to update user permission:", err);
    } finally {
      setSaving(null);
    }
  };

  const getUserName = (uid: string) => {
    const u = users.find((u) => u.uid === uid);
    return u?.displayName || uid;
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
        className="rounded-lg overflow-hidden"
        style={{ border: "1px solid var(--border-subtle)" }}
      >
        {/* Header */}
        <div
          className="grid items-center px-4 py-2 text-xs font-medium uppercase tracking-wider"
          style={{
            gridTemplateColumns: `180px repeat(${assignableGroups.length}, 1fr) 1fr`,
            background: "rgba(255, 255, 255, 0.03)",
            color: "var(--foreground-muted)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div>Page</div>
          {assignableGroups.map((g) => (
            <div key={g.id}>{GROUP_DISPLAY_NAMES[g.id] || g.name}</div>
          ))}
          <div>Users</div>
        </div>

        {/* Rows */}
        {pages
          .sort((a, b) => a.order - b.order)
          .map((page) => (
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
                  gridTemplateColumns: `180px repeat(${assignableGroups.length}, 1fr) 1fr`,
                }}
              >
                {/* Page name */}
                <div className="font-medium text-sm">{page.title}</div>

                {/* Group dropdowns */}
                {assignableGroups.map((g) => (
                  <div key={g.id}>
                    <select
                      className="form-input text-sm"
                      style={{ padding: "4px 8px", maxWidth: "140px" }}
                      value={page.permissions.groups?.[g.id] || ""}
                      onChange={(e) =>
                        handleGroupRoleChange(page, g.id, e.target.value)
                      }
                      disabled={saving === page.pageId}
                    >
                      {ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}

                {/* User permissions */}
                <div className="flex flex-col gap-1">
                  {Object.entries(page.permissions.users || {}).map(
                    ([uid, role]) => (
                      <div key={uid} className="flex items-center gap-2 text-xs">
                        <span
                          className="truncate max-w-[100px]"
                          title={getUserName(uid)}
                        >
                          {getUserName(uid)}
                        </span>
                        <select
                          className="form-input text-xs"
                          style={{ padding: "2px 4px", width: "100px" }}
                          value={role}
                          onChange={(e) =>
                            handleUserRoleChange(page, uid, e.target.value)
                          }
                          disabled={saving === page.pageId}
                        >
                          {ROLE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleRemoveUser(page, uid)}
                          className="text-red-400 hover:text-red-300"
                          disabled={saving === page.pageId}
                          title="Remove user"
                        >
                          x
                        </button>
                      </div>
                    )
                  )}

                  {addingUserTo === page.pageId ? (
                    <div className="flex items-center gap-1 mt-1">
                      <select
                        className="form-input text-xs"
                        style={{ padding: "2px 4px", width: "110px" }}
                        value={selectedUserId}
                        onChange={(e) => setSelectedUserId(e.target.value)}
                      >
                        <option value="">Select user</option>
                        {users
                          .filter((u) => !page.permissions.users?.[u.uid])
                          .map((u) => (
                            <option key={u.uid} value={u.uid}>
                              {u.displayName}
                            </option>
                          ))}
                      </select>
                      <select
                        className="form-input text-xs"
                        style={{ padding: "2px 4px", width: "90px" }}
                        value={selectedUserRole}
                        onChange={(e) =>
                          setSelectedUserRole(e.target.value as PermissionRole)
                        }
                      >
                        <option value="can_view">Can View</option>
                        <option value="can_edit">Can Edit</option>
                        <option value="full_access">Full Access</option>
                      </select>
                      <button
                        className="text-xs text-blue-400 hover:text-blue-300"
                        onClick={() => handleAddUser(page)}
                        disabled={!selectedUserId}
                      >
                        Add
                      </button>
                      <button
                        className="text-xs"
                        style={{ color: "var(--foreground-muted)" }}
                        onClick={() => {
                          setAddingUserTo(null);
                          setSelectedUserId("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="text-xs mt-1"
                      style={{ color: "var(--foreground-muted)" }}
                      onClick={() => setAddingUserTo(page.pageId)}
                    >
                      + Add user
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import type { PagePermissionDoc } from "@/types/firestore";
import { GROUP_DISPLAY_NAMES } from "@/types/firestore";
import type { PageDef } from "@/lib/definitions";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

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

type PermissionMap = { groups: Record<string, true>; users: Record<string, true> };

interface PermissionTableProps {
  pages: PageDef[];
  teamspaceName: string;
  pagePermissions: PagePermissionDoc[];
  groups: AdminGroup[];
  users: AdminUser[];
  onUpdatePermission: (pageId: string, permissions: PermissionMap) => Promise<void>;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** A group's human label. Falls back through the fetched name to the raw id. */
function groupLabel(group: AdminGroup): string {
  return GROUP_DISPLAY_NAMES[group.id] || group.name || group.id;
}

export default function PermissionTable({
  pages,
  teamspaceName,
  pagePermissions,
  groups,
  users,
  onUpdatePermission,
}: PermissionTableProps) {
  // Per-page in-flight set: two rows can save concurrently without one
  // clearing the other's disabled state.
  const [savingPages, setSavingPages] = useState<ReadonlySet<string>>(new Set());
  const [openPicker, setOpenPicker] = useState<string | null>(null);

  // Filter out 'unassigned' group, sort by level. `.filter()` copies, so the
  // sort never touches the prop array.
  const assignableGroups = useMemo(
    () => groups.filter((g) => g.id !== "unassigned").sort((a, b) => a.level - b.level),
    [groups]
  );

  // Never sort the prop array in place — it is owned by useAdminData's state.
  const sortedPages = useMemo(
    () => [...pages].sort((a, b) => a.order - b.order),
    [pages]
  );

  const permByPageId = useMemo(() => {
    const map = new Map<string, PagePermissionDoc>();
    for (const doc of pagePermissions) map.set(doc.pageId, doc);
    return map;
  }, [pagePermissions]);

  const currentPermissions = useCallback(
    (pageId: string): PermissionMap => {
      const doc = permByPageId.get(pageId);
      return {
        groups: { ...(doc?.groups || {}) } as Record<string, true>,
        users: { ...(doc?.users || {}) } as Record<string, true>,
      };
    },
    [permByPageId]
  );

  const setSaving = useCallback((pageId: string, saving: boolean) => {
    setSavingPages((prev) => {
      const next = new Set(prev);
      if (saving) next.add(pageId);
      else next.delete(pageId);
      return next;
    });
  }, []);

  /**
   * Single write path for both group and user toggles. Every outcome is
   * reported: success toasts, and revocations carry an Undo that re-applies
   * the exact permission map we replaced.
   */
  const applyPermissions = useCallback(
    async (opts: {
      pageId: string;
      pageTitle: string;
      next: PermissionMap;
      previous: PermissionMap;
      granted: boolean;
      subject: string;
      /** Undo re-applies `previous`; it must not offer its own undo. */
      isUndo?: boolean;
    }) => {
      const { pageId, pageTitle, next, previous, granted, subject, isUndo } = opts;
      setSaving(pageId, true);
      try {
        await onUpdatePermission(pageId, next);

        if (isUndo) {
          toast.success("Change reverted");
          return;
        }

        if (granted) {
          toast.success(`${subject} can now access ${pageTitle}`);
        } else {
          toast.success(`${subject} no longer has access to ${pageTitle}`, {
            action: {
              label: "Undo",
              onClick: () => {
                void applyPermissions({
                  pageId,
                  pageTitle,
                  next: previous,
                  previous: next,
                  granted: true,
                  subject,
                  isUndo: true,
                });
              },
            },
          });
        }
      } catch (err) {
        toast.error(`Could not update ${pageTitle}`, {
          description: errorMessage(err, "Access is unchanged. Please try again."),
        });
      } finally {
        setSaving(pageId, false);
      }
    },
    [onUpdatePermission, setSaving]
  );

  const handleGroupToggle = useCallback(
    (page: PageDef, group: AdminGroup, currentlyHasAccess: boolean) => {
      const previous = currentPermissions(page.pageId);
      const next = currentPermissions(page.pageId);
      if (currentlyHasAccess) delete next.groups[group.id];
      else next.groups[group.id] = true;

      void applyPermissions({
        pageId: page.pageId,
        pageTitle: page.title,
        next,
        previous,
        granted: !currentlyHasAccess,
        subject: groupLabel(group),
      });
    },
    [applyPermissions, currentPermissions]
  );

  const handleUserToggle = useCallback(
    (page: PageDef, user: AdminUser, currentlyHasAccess: boolean) => {
      const previous = currentPermissions(page.pageId);
      const next = currentPermissions(page.pageId);
      if (currentlyHasAccess) delete next.users[user.uid];
      else next.users[user.uid] = true;

      void applyPermissions({
        pageId: page.pageId,
        pageTitle: page.title,
        next,
        previous,
        granted: !currentlyHasAccess,
        subject: user.displayName,
      });
    },
    [applyPermissions, currentPermissions]
  );

  return (
    <section className="mb-8" aria-labelledby={`teamspace-${teamspaceName}`}>
      <h2
        id={`teamspace-${teamspaceName}`}
        className="mb-3 px-1 text-sm font-semibold tracking-wider text-zinc-400 uppercase"
      >
        {teamspaceName}
      </h2>

      <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025]">
        <Table>
          <TableHeader>
            <TableRow className="border-white/[0.07] hover:bg-transparent">
              <TableHead
                scope="col"
                className="w-[180px] bg-white/[0.04] text-xs font-medium tracking-wider text-zinc-400 uppercase"
              >
                Page
              </TableHead>
              {assignableGroups.map((g) => (
                <TableHead
                  key={g.id}
                  scope="col"
                  className="bg-white/[0.04] text-center text-xs font-medium tracking-wider text-zinc-400 uppercase"
                >
                  {groupLabel(g)}
                </TableHead>
              ))}
              <TableHead
                scope="col"
                className="w-full bg-white/[0.04] text-xs font-medium tracking-wider text-zinc-400 uppercase"
              >
                Individuals
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {sortedPages.map((page) => {
              const permDoc = permByPageId.get(page.pageId);
              const grantedUids = Object.keys(permDoc?.users || {});
              const sharedCount = grantedUids.length;
              const isSaving = savingPages.has(page.pageId);
              const isPickerOpen = openPicker === page.pageId;

              return (
                <TableRow
                  key={page.pageId}
                  aria-busy={isSaving}
                  className={`border-white/[0.07] transition-opacity hover:bg-white/[0.055] ${
                    isSaving ? "opacity-60" : ""
                  }`}
                >
                  {/* A real row header, so the checkboxes in this row have a
                      programmatic name in the accessibility tree. */}
                  <th
                    scope="row"
                    className="p-2 text-left align-middle text-sm font-medium"
                  >
                    <span className="block truncate" title={page.title}>
                      {page.title}
                    </span>
                  </th>

                  {assignableGroups.map((g) => {
                    const hasAccess = !!permDoc?.groups?.[g.id];
                    return (
                      <TableCell key={g.id} className="text-center">
                        <div className="flex justify-center">
                          <Checkbox
                            checked={hasAccess}
                            onCheckedChange={() => handleGroupToggle(page, g, hasAccess)}
                            disabled={isSaving}
                            aria-label={`${groupLabel(g)} access to ${page.title}`}
                          />
                        </div>
                      </TableCell>
                    );
                  })}

                  <TableCell>
                    <Popover
                      open={isPickerOpen}
                      onOpenChange={(open) => setOpenPicker(open ? page.pageId : null)}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          role="combobox"
                          aria-expanded={isPickerOpen}
                          aria-label={`Individuals with access to ${page.title}`}
                          disabled={isSaving}
                          className="w-full max-w-[240px] justify-between font-normal"
                        >
                          <span className={sharedCount > 0 ? "truncate" : "truncate text-zinc-400"}>
                            {sharedCount > 0
                              ? `${sharedCount} individual${sharedCount > 1 ? "s" : ""}`
                              : "No individuals"}
                          </span>
                          <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>

                      <PopoverContent align="start" className="w-72 p-0">
                        <Command
                          filter={(value, search) =>
                            value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
                          }
                        >
                          <CommandInput placeholder="Search people…" />
                          <CommandList>
                            <CommandEmpty>No people found.</CommandEmpty>
                            <CommandGroup>
                              {users.map((u) => {
                                const userHasAccess = !!permDoc?.users?.[u.uid];
                                return (
                                  <CommandItem
                                    key={u.uid}
                                    value={`${u.displayName} ${u.workEmail}`}
                                    // Keep the picker open so several people can be
                                    // granted in one pass.
                                    onSelect={() => handleUserToggle(page, u, userHasAccess)}
                                    disabled={isSaving}
                                    className="gap-2"
                                  >
                                    <CheckIcon
                                      className={`size-4 shrink-0 ${
                                        userHasAccess ? "opacity-100" : "opacity-0"
                                      }`}
                                    />
                                    <span className="flex min-w-0 flex-col">
                                      <span className="truncate" title={u.displayName}>
                                        {u.displayName}
                                      </span>
                                      <span
                                        className="truncate text-xs text-zinc-400"
                                        title={u.workEmail}
                                      >
                                        {u.workEmail}
                                      </span>
                                    </span>
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

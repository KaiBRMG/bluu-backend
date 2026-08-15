"use client";

import { useMemo, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import type { PagePermissionDoc } from "@/types/firestore";
import { GROUP_DISPLAY_NAMES } from "@/types/firestore";
import type { PageDef, TeamspaceDef } from "@/lib/definitions";
import { resolvePagePermission } from "@/lib/services/permissionResolver";
import { PageIcon } from "@/components/PageIcon";
import { Button } from "@/components/ui/button";
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

interface AdminUser {
  uid: string;
  displayName: string;
  workEmail: string;
  groups: string[];
  photoURL?: string;
}

interface EffectivePermissionsPreviewProps {
  pages: PageDef[];
  teamspaces: TeamspaceDef[];
  pagePermissions: PagePermissionDoc[];
  users: AdminUser[];
}

export default function EffectivePermissionsPreview({
  pages,
  teamspaces,
  pagePermissions,
  users,
}: EffectivePermissionsPreviewProps) {
  const [selectedUid, setSelectedUid] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const selectedUser = users.find((u) => u.uid === selectedUid);

  const permMap = useMemo(() => {
    const map = new Map<string, PagePermissionDoc>();
    for (const doc of pagePermissions) {
      map.set(doc.pageId, doc);
    }
    return map;
  }, [pagePermissions]);

  const effectivePermissions = useMemo(() => {
    if (!selectedUser) return [];

    // Never sort the prop array in place — it is shared with PermissionTable.
    return [...pages]
      .sort((a, b) => {
        const tsA = teamspaces.find((t) => t.id === a.teamspaceId)?.order ?? 0;
        const tsB = teamspaces.find((t) => t.id === b.teamspaceId)?.order ?? 0;
        if (tsA !== tsB) return tsA - tsB;
        return a.order - b.order;
      })
      .map((page) => {
        const permDoc = permMap.get(page.pageId);
        const resolved = resolvePagePermission(
          permDoc,
          selectedUser.uid,
          selectedUser.groups || []
        );
        const tsName =
          teamspaces.find((t) => t.id === page.teamspaceId)?.name ||
          page.teamspaceId;

        return {
          pageId: page.pageId,
          title: page.title,
          icon: page.icon,
          teamspaceName: tsName,
          teamspaceId: page.teamspaceId,
          access: resolved
            ? {
                via: resolved.via,
                groupName:
                  resolved.via === "group" && resolved.groupId
                    ? GROUP_DISPLAY_NAMES[resolved.groupId] || resolved.groupId
                    : undefined,
              }
            : null,
        };
      });
  }, [pages, teamspaces, selectedUser, permMap]);

  // Group results by teamspace
  const groupedByTeamspace = useMemo(() => {
    const map = new Map<string, typeof effectivePermissions>();
    for (const item of effectivePermissions) {
      const key = item.teamspaceId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [effectivePermissions]);

  const accessibleCount = effectivePermissions.filter((i) => i.access).length;

  return (
    <section
      className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4"
      aria-labelledby="effective-access-heading"
    >
      <h2 id="effective-access-heading" className="text-sm font-semibold">
        Effective access
      </h2>
      <p className="mt-1 mb-3 text-xs text-zinc-400">
        Check what one person can actually see, and which grant gives it to them.
        Direct grants and group grants combine — either one is enough.
      </p>

      <div className="mb-4">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              role="combobox"
              aria-expanded={pickerOpen}
              aria-label="Person to preview access for"
              className="w-full max-w-[300px] justify-between font-normal"
            >
              <span className={selectedUser ? "truncate" : "truncate text-zinc-400"}>
                {selectedUser
                  ? `${selectedUser.displayName} (${selectedUser.workEmail})`
                  : "Select a person…"}
              </span>
              <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>

          <PopoverContent align="start" className="w-80 p-0">
            <Command
              filter={(value, search) =>
                value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
              }
            >
              <CommandInput placeholder="Search people…" />
              <CommandList>
                <CommandEmpty>No people found.</CommandEmpty>
                <CommandGroup>
                  {selectedUid && (
                    <CommandItem
                      value="clear selection"
                      onSelect={() => {
                        setSelectedUid("");
                        setPickerOpen(false);
                      }}
                      className="text-zinc-400"
                    >
                      Clear selection
                    </CommandItem>
                  )}
                  {users.map((u) => (
                    <CommandItem
                      key={u.uid}
                      value={`${u.displayName} ${u.workEmail}`}
                      onSelect={() => {
                        setSelectedUid(u.uid);
                        setPickerOpen(false);
                      }}
                      className="gap-2"
                    >
                      <CheckIcon
                        className={`size-4 shrink-0 ${
                          u.uid === selectedUid ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate" title={u.displayName}>
                          {u.displayName}
                        </span>
                        <span className="truncate text-xs text-zinc-400" title={u.workEmail}>
                          {u.workEmail}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {selectedUser && (
          <div className="mt-2 text-xs text-zinc-400">
            Groups:{" "}
            {selectedUser.groups?.map((g) => GROUP_DISPLAY_NAMES[g] || g).join(", ") ||
              "None"}{" "}
            · Can see {accessibleCount} of {effectivePermissions.length} pages
          </div>
        )}
      </div>

      {!selectedUser ? (
        <p className="text-sm text-zinc-400">
          {users.length === 0
            ? "No people to preview yet."
            : "Select a person to see every page they can reach."}
        </p>
      ) : (
        <div className="space-y-4">
          {groupedByTeamspace.map(([tsId, items]) => (
            <div key={tsId}>
              <h3 className="mb-2 text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                {items[0]?.teamspaceName}
              </h3>

              <div className="space-y-1">
                {items.map((item) => (
                  <div
                    key={item.pageId}
                    className="flex items-center justify-between gap-3 rounded-md bg-white/[0.04] px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <PageIcon
                        name={item.icon ?? undefined}
                        className="size-4 shrink-0 text-zinc-400"
                      />
                      <span className="truncate" title={item.title}>
                        {item.title}
                      </span>
                    </span>

                    {item.access ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
                          Access
                        </span>
                        <span className="text-xs text-zinc-400">
                          via{" "}
                          {item.access.via === "group"
                            ? item.access.groupName
                            : "Direct"}
                        </span>
                      </div>
                    ) : (
                      <span className="shrink-0 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-xs font-medium text-zinc-400">
                        No access
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ListFilter, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { useAdminUsers, type AdminFullUser } from "@/hooks/useAdminUsers";
import { EmployeeIndex, type IndexSection } from "@/components/admin/user-management/EmployeeIndex";
import { RegistryRail, type Facet } from "@/components/admin/user-management/RegistryRail";
import { GroupPicker } from "@/components/admin/user-management/GroupPicker";
import NewUserDialog from "@/components/admin/user-management/NewUserDialog";
import UserDetailDrawer from "@/components/admin/user-management/UserDetailDrawer";
import { STAGE_LABEL, USER_STAGES, userStage } from "@/components/admin/user-management/userStatus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * User Management — one faceted index of people.
 *
 * The previous version was four `Tabs`, three of which rendered the same
 * component with booleans that collapsed to two predicates already available
 * as filter values inside it. That is a filter promoted to navigation, and it
 * cost real things: "archived contractors" was unaskable because the two
 * partitions were separate destinations, and the page's primary action lived
 * *inside* two of the four panels, so "add an employee" disappeared on half
 * the surface it belongs to.
 *
 * The shape here is the one DESIGN.md §5 documents for a browse-and-open
 * collection: a facet rail with faceted counts, then a sectioned index of
 * two-line rows. The primary action sits on the `<h1>` row (DESIGN.md §3),
 * visible from every state of the page.
 */

const ACTION_BLUE = "#3b82f6";

const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contractor", "Intern"];

interface Filters {
  /** '' = every stage except archived. Archived is opt-in, never a surprise. */
  stage: string;
  groups: string[];
  employment: string[];
  q: string;
}

const EMPTY_FILTERS: Filters = { stage: "", groups: [], employment: [], q: "" };

function matches(user: AdminFullUser, f: Filters): boolean {
  const stage = userStage(user);
  if (f.stage) {
    if (stage !== f.stage) return false;
  } else if (stage === "archived") {
    return false;
  }
  if (f.groups.length && !(user.groups || []).some((g) => f.groups.includes(g))) return false;
  if (f.employment.length && !f.employment.includes(user.employmentType || "")) return false;
  if (f.q) {
    const q = f.q.trim().toLowerCase();
    const hay = [user.firstName, user.lastName, user.displayName, user.workEmail]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    // Email is in the haystack deliberately: it is the one identifier an admin
    // reliably has when someone says "I can't get in", and the old registry
    // search matched names only.
    if (!hay.includes(q)) return false;
  }
  return true;
}

function byName(a: AdminFullUser, b: AdminFullUser): number {
  const af = (a.firstName || "").toLowerCase();
  const bf = (b.firstName || "").toLowerCase();
  if (af !== bf) return af.localeCompare(bf);
  return (a.lastName || "").toLowerCase().localeCompare((b.lastName || "").toLowerCase());
}

/* ------------------------------ URL round-trip ----------------------------- */

function readFiltersFromUrl(): Filters {
  const p = new URLSearchParams(window.location.search);
  const list = (key: string) => (p.get(key) || "").split(",").filter(Boolean);
  return {
    stage: p.get("stage") || "",
    groups: list("group"),
    employment: list("type"),
    q: p.get("q") || "",
  };
}

function writeFiltersToUrl(f: Filters) {
  const p = new URLSearchParams();
  if (f.stage) p.set("stage", f.stage);
  if (f.groups.length) p.set("group", f.groups.join(","));
  if (f.employment.length) p.set("type", f.employment.join(","));
  if (f.q) p.set("q", f.q);
  const qs = p.toString();
  // `replaceState` rather than the router: this is view state, not a
  // navigation, and pushing it would make Back walk the filter history.
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

/* --------------------------------- Page ----------------------------------- */

export default function UserManagementPage() {
  const {
    users,
    groups,
    loading,
    refreshing,
    error,
    refetch,
    createUser,
    updateUser,
    addGroupMembers,
    removeGroupMember,
    deleteUser,
  } = useAdminUsers();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Read the URL after mount rather than in a state initialiser: the initialiser
  // would run on the server too and hydrate against a different value.
  useEffect(() => {
    setFilters(readFiltersFromUrl());
  }, []);

  const patch = useCallback((next: Partial<Filters>) => {
    setFilters((prev) => {
      const merged = { ...prev, ...next };
      writeFiltersToUrl(merged);
      return merged;
    });
  }, []);

  const clearAll = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    writeFiltersToUrl(EMPTY_FILTERS);
  }, []);

  const toggleIn = useCallback(
    (key: "groups" | "employment", value: string) => {
      setFilters((prev) => {
        const current = prev[key];
        const merged = {
          ...prev,
          [key]: current.includes(value)
            ? current.filter((v) => v !== value)
            : [...current, value],
        };
        writeFiltersToUrl(merged);
        return merged;
      });
    },
    [],
  );

  const hasFilters =
    !!filters.stage || filters.groups.length > 0 || filters.employment.length > 0 || !!filters.q;

  /* --------------------------- Filtering + facets -------------------------- */

  const visible = useMemo(
    () => users.filter((u) => matches(u, filters)).sort(byName),
    [users, filters],
  );

  /**
   * Counts are faceted, or they are lies (DESIGN.md §5). Each facet is counted
   * with its own dimension replaced by that one value and every *other* active
   * filter still applied, so the number beside a facet is exactly what clicking
   * it will produce — and a click can never land on an empty list by surprise.
   */
  const stageFacets: Facet[] = useMemo(
    () =>
      USER_STAGES.map((stage) => ({
        value: stage,
        label: STAGE_LABEL[stage],
        count: users.filter((u) => matches(u, { ...filters, stage })).length,
      })),
    [users, filters],
  );

  const groupFacets: Facet[] = useMemo(
    () =>
      groups.map((g) => ({
        value: g.id,
        label: g.name,
        count: users.filter((u) => matches(u, { ...filters, groups: [g.id] })).length,
      })),
    [users, groups, filters],
  );

  const employmentFacets: Facet[] = useMemo(
    () =>
      EMPLOYMENT_TYPES.map((t) => ({
        value: t,
        label: t,
        count: users.filter((u) => matches(u, { ...filters, employment: [t] })).length,
      })),
    [users, filters],
  );

  const sections: IndexSection[] = useMemo(
    () =>
      USER_STAGES.map((stage) => ({
        stage,
        users: visible.filter((u) => userStage(u) === stage),
      })),
    [visible],
  );

  /* -------------------------------- Actions -------------------------------- */

  const handleDeleteUser = useCallback(async () => {
    if (!selectedUserId) return;
    await deleteUser(selectedUserId);
    setSelectedUserId(null);
  }, [selectedUserId, deleteUser]);

  const toggleSelect = useCallback((uid: string) => {
    setSelectedUids((prev) =>
      prev.includes(uid) ? prev.filter((v) => v !== uid) : [...prev, uid],
    );
  }, []);

  const bulkAddToGroup = useCallback(
    async (groupId: string) => {
      const group = groups.find((g) => g.id === groupId);
      const uids = selectedUids;
      if (!group || uids.length === 0) return;
      setBulkBusy(true);
      try {
        await addGroupMembers(groupId, uids);
        toast.success(
          `${uids.length} ${uids.length === 1 ? "person" : "people"} added to ${group.name}`,
          { description: "They can now reach every page that group grants." },
        );
        setSelectedUids([]);
      } catch (err) {
        toast.error(`Could not add to ${group.name}`, {
          description: err instanceof Error ? err.message : "Please try again.",
        });
      } finally {
        setBulkBusy(false);
      }
    },
    [groups, selectedUids, addGroupMembers],
  );

  /* --------------------------------- Chrome -------------------------------- */

  // The header is never replaced by a loading or error state. A page whose
  // title disappears while it fetches reads as a broken app, and the primary
  // action has to stay reachable from every state of the page.
  const header = (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
        <p className="mt-1 max-w-prose text-sm text-zinc-400">
          Everyone with an account. An employee must be registered here before they can sign in.
        </p>
      </div>
      {createUser && (
        <NewUserDialog groups={groups} onCreate={createUser} disabled={loading || !!error} />
      )}
    </header>
  );

  const railProps = {
    stageFacets,
    stage: filters.stage,
    onSetStage: (value: string) => patch({ stage: value }),
    groupFacets,
    activeGroups: filters.groups,
    onToggleGroup: (value: string) => toggleIn("groups", value),
    employmentFacets,
    activeEmployment: filters.employment,
    onToggleEmployment: (value: string) => toggleIn("employment", value),
  };

  const activeFilterCount =
    (filters.stage ? 1 : 0) + filters.groups.length + filters.employment.length;

  return (
    <AppLayout>
      <div className="max-w-6xl">
        {header}

        {error ? (
          <div className="flex flex-col items-start gap-3 py-10">
            <div className="flex items-center gap-2 text-sm font-medium text-red-400">
              <AlertCircle className="size-4" />
              Couldn&apos;t load user management
            </div>
            <p className="text-sm text-zinc-400">{error}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="grid gap-x-10 gap-y-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
            {/* Below lg the rail folds into a popover so the index keeps the
                full width — the same fold the Resources rail uses. */}
            <div className="lg:hidden">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <ListFilter className="size-4" />
                    Filters
                    {activeFilterCount > 0 && (
                      <span className="rounded-full bg-white/10 px-1.5 text-[11px] tabular-nums">
                        {activeFilterCount}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="dark w-64"
                  style={{ zIndex: "var(--z-overlay)" }}
                >
                  <RegistryRail {...railProps} />
                </PopoverContent>
              </Popover>
            </div>

            <aside className="hidden lg:block lg:sticky lg:top-4 lg:self-start">
              {loading ? <RailSkeleton /> : <RegistryRail {...railProps} />}
            </aside>

            <div className="min-w-0">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
                  />
                  <Input
                    type="search"
                    aria-label="Search employees by name or email"
                    placeholder="Search by name or email…"
                    value={filters.q}
                    onChange={(e) => patch({ q: e.target.value })}
                    className="h-8 w-full pl-8"
                    disabled={loading}
                  />
                </div>
                {refreshing && (
                  <span aria-live="polite" className="text-xs text-zinc-400">
                    Updating…
                  </span>
                )}
                {hasFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAll}
                    className="text-zinc-400 hover:text-white"
                  >
                    <X className="size-4" /> Clear filters
                  </Button>
                )}
              </div>

              {loading ? (
                <IndexSkeleton />
              ) : visible.length === 0 ? (
                <EmptyState
                  filtered={hasFilters}
                  total={users.filter((u) => !u.isArchived).length}
                  onClear={clearAll}
                />
              ) : (
                <EmployeeIndex
                  sections={sections}
                  groups={groups}
                  selectedUids={selectedUids}
                  onToggleSelect={toggleSelect}
                  onOpen={setSelectedUserId}
                  total={visible.length}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* The bulk bar is the answer to "add five people to Ops" — the job the
          old Add Members dropdown did, on an affordance that is reachable by
          keyboard and that works from the list you already filtered. */}
      {selectedUids.length > 0 && (
        <div className="fixed inset-x-0 bottom-6 flex justify-center px-4" style={{ zIndex: "var(--z-banner)" }}>
          <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-[#171717] px-3 py-2">
            <span className="text-sm tabular-nums text-zinc-300">
              {selectedUids.length} selected
            </span>
            <GroupPicker
              groups={groups}
              selectedIds={[]}
              addOnly
              onToggle={(groupId) => bulkAddToGroup(groupId)}
              emptyLabel="No groups to add to."
              trigger={
                <Button size="sm" disabled={bulkBusy} style={{ backgroundColor: ACTION_BLUE }}>
                  <UserPlus className="size-4" />
                  Add to group
                </Button>
              }
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedUids([])}
              className="text-zinc-400 hover:text-white"
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      <UserDetailDrawer
        userId={selectedUserId}
        users={users}
        groups={groups}
        onClose={() => setSelectedUserId(null)}
        onUpdateUser={updateUser}
        onRefetch={refetch}
        onDeleteUser={handleDeleteUser}
        onAddGroupMembers={addGroupMembers}
        onRemoveGroupMember={removeGroupMember}
      />
    </AppLayout>
  );
}

/* ------------------------------- Sub-states -------------------------------- */

/**
 * Empty because of a filter is a different state from empty because there is
 * nothing (DESIGN.md §5), and the filtered one carries its own way out and
 * names what is behind it.
 */
function EmptyState({
  filtered,
  total,
  onClear,
}: {
  filtered: boolean;
  total: number;
  onClear: () => void;
}) {
  if (!filtered) {
    return (
      <p className="py-10 text-sm text-zinc-400">
        Nobody is registered yet. Add the first employee to let them sign in.
      </p>
    );
  }
  return (
    <p className="py-10 text-sm text-zinc-400">
      Nothing matches these filters.{" "}
      <button
        type="button"
        onClick={onClear}
        className="text-white underline underline-offset-2 hover:no-underline"
      >
        Clear them
      </button>{" "}
      to see all {total} {total === 1 ? "person" : "people"}.
    </p>
  );
}

/** Skeletons are shaped to the final layout, never a spinner mid-page. */
function RailSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      {[4, 3, 4].map((rows, i) => (
        <div key={i}>
          <Skeleton className="mb-2 h-3 w-16" />
          <div className="flex flex-col gap-1">
            {Array.from({ length: rows }).map((_, r) => (
              <Skeleton key={r} className="h-7 w-full rounded-md" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function IndexSkeleton() {
  return (
    <div>
      <Skeleton className="mb-3 h-3 w-20" />
      {[0, 1].map((section) => (
        <div key={section} className={section === 0 ? "" : "pt-6"}>
          <div className="flex items-center gap-3 px-2.5 pb-1">
            <Skeleton className="h-3 w-24" />
            <span className="h-px flex-1 bg-white/[0.07]" />
          </div>
          {Array.from({ length: 5 }).map((_, r) => (
            <div key={r} className="flex items-center gap-3 px-2.5 py-2">
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="mt-1.5 h-2.5 w-64" />
              </div>
              <Skeleton className="hidden h-5 w-16 rounded-full sm:block" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

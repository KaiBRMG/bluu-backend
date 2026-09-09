"use client";

import { useState, useRef, useLayoutEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { House, ChevronLeft, ChevronDown } from "lucide-react";
import type { ResolvedAccess } from "@/types/firestore";
import type { TeamspaceDef } from "@/lib/definitions";
import { UNIVERSAL_PAGES } from "@/lib/definitions";
import {
  Sidebar as SidebarPrimitive,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { NavUser } from "@/components/sidebar/NavUser";
import { PageIcon } from "@/components/PageIcon";
import { auth } from "@/firebase-config";
import { toast } from "sonner";

// AppLayout (and thus this Sidebar) is mounted per-page, so it remounts on every
// navigation. Persist the scroll offset of the content area at module scope so it
// survives those remounts and the sidebar doesn't jump back to the top.
let savedScrollTop = 0;

/**
 * Pages that do **not** navigate: each spawns its own Electron window, and
 * `main.js` re-checks the page permission server-side (against `accessPath` for
 * that prefix) before the window is created.
 *
 * `route` doubles as the in-window fallback. Two things can send us down it, and
 * both mean "this installed build is older than the feature": the IPC is absent
 * entirely, or main rejects the path because its `SATELLITE_PREFIXES` predates
 * this entry. Either way the surface still works — just inside the main window,
 * with the sidebar rendered around it — while the fleet updates.
 */
const SATELLITE_PAGES: Record<string, { route: string; key: string }> = {
  "apps-ofmanager": { route: "/of-manager", key: "of-manager" },
  "apps-gologin": { route: "/gologin", key: "gologin" },
};

function SatelliteButton({
  pageId,
  title,
  icon,
}: {
  pageId: string;
  title: string;
  icon?: string | null;
}) {
  const router = useRouter();
  const target = SATELLITE_PAGES[pageId];

  const open = useCallback(async () => {
    if (!target) return;
    const api = window.electronAPI?.window;
    // `onlyfans.openWindow` is the legacy channel, kept for builds that predate
    // the generalised one. It reaches the same handler in main.js.
    const openSatellite =
      api?.openSatellite ??
      (pageId === "apps-ofmanager" ? window.electronAPI?.onlyfans?.openWindow : undefined);
    if (!openSatellite) {
      router.push(target.route);
      return;
    }
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        toast.error("Session expired — sign in again.");
        return;
      }
      const result = await openSatellite(idToken, { path: target.route, key: target.key, title });
      // An older shell doesn't know this prefix — open it in-window instead of
      // telling the user the feature is broken.
      if (result?.error === "invalid-path") {
        router.push(target.route);
        return;
      }
      // 'already-opening' is a double-click while the access check is in flight —
      // the window is on its way, so saying "could not open" would be wrong.
      if (!result?.success && result?.error !== "already-opening") {
        toast.error(
          result?.error === "forbidden"
            ? `You do not have access to ${title}.`
            : `Could not open ${title}.`,
        );
      }
    } catch {
      toast.error(`Could not open ${title}.`);
    }
  }, [pageId, router, target, title]);

  return (
    <SidebarMenuButton onClick={open} tooltip={title}>
      <PageIcon name={icon ?? undefined} />
      <span>{title}</span>
    </SidebarMenuButton>
  );
}

interface SidebarProps {
  teamspaces: TeamspaceDef[];
  accessiblePages: ResolvedAccess[];
  userData: {
    name: string;
    groupName: string;
    photoURL?: string | null;
  };
}

export default function Sidebar({ teamspaces, accessiblePages, userData }: SidebarProps) {
  const pathname = usePathname();
  const { state, toggleSidebar } = useSidebar();

  const sortedTeamspaces = teamspaces
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter((ts) => accessiblePages.some((p) => p.teamspaceId === ts.id));

  const STORAGE_KEY = "sidebar_teamspace_open";

  // Keep the raw persisted map (keyed by teamspace id) rather than deriving it
  // from sortedTeamspaces: teamspaces load asynchronously, so at first mount the
  // list is often empty and deriving here would drop every stored preference.
  // Absence means "expanded" (the default) — see `openMap[ts.id] ?? true` below.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    } catch {
      return {};
    }
  });

  const toggle = (id: string) =>
    setOpenMap((prev) => {
      // Toggle against the displayed default (expanded) so the first click on a
      // never-toggled teamspace actually collapses it instead of no-op'ing.
      const next = { ...prev, [id]: !(prev[id] ?? true) };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });

  // Restore the persisted scroll offset before paint so the remount on navigation
  // doesn't visibly jump to the top; keep it updated as the user scrolls.
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = savedScrollTop;
  }, []);

  return (
    <SidebarPrimitive collapsible="icon">
      {/* Header: logo + trigger */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center justify-between">
              <SidebarMenuButton size="lg" asChild>
                {state === "collapsed" ? (
                  <button onClick={toggleSidebar} className="flex items-center">
                    <Image src="/logo/bluu_uu.svg" alt="Bluu" width={20} height={20} priority style={{ height: '1.25rem', width: 'auto' }} />
                  </button>
                ) : (
                  <Link href="/">
                    <Image src="/logo/bluu_long.svg" alt="Bluu" width={120} height={28} priority style={{ height: '1.75rem', width: 'auto' }} />
                  </Link>
                )}
              </SidebarMenuButton>
              {state === "expanded" && (
                <SidebarTrigger className="ml-1 shrink-0" />
              )}
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === "/"}
              tooltip="Home"
            >
              <Link href="/">
                <House />
                <span>Home</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {/* Org-wide pages sit alongside Home, above the teamspaces. They carry
              no page permission, so they render for everyone unconditionally —
              there is no `accessiblePages` entry to look them up in. */}
          {UNIVERSAL_PAGES.map((page) => (
            <SidebarMenuItem key={page.href}>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith(page.href)}
                tooltip={page.title}
              >
                <Link href={page.href}>
                  <PageIcon name={page.icon} />
                  <span>{page.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent
        ref={contentRef}
        onScroll={(e) => { savedScrollTop = e.currentTarget.scrollTop; }}
      >
        {/* Teamspace groups */}
        {sortedTeamspaces.map((ts) => {
          const pages = accessiblePages
            .filter((p) => p.teamspaceId === ts.id)
            .sort((a, b) => a.order - b.order);
          const isOpen = openMap[ts.id] ?? true;

          return (
            <Collapsible key={ts.id} open={isOpen} onOpenChange={() => toggle(ts.id)}>
              <SidebarGroup>
                <SidebarGroupLabel asChild>
                  <CollapsibleTrigger className="flex w-full items-center justify-between">
                    <span>{ts.name}</span>
                    {isOpen
                      ? <ChevronDown className="size-3.5 shrink-0 opacity-50" />
                      : <ChevronLeft className="size-3.5 shrink-0 opacity-50" />
                    }
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {pages.map((page) => (
                        <SidebarMenuItem key={page.pageId}>
                          {SATELLITE_PAGES[page.pageId] ? (
                            <SatelliteButton
                              pageId={page.pageId}
                              title={page.title}
                              icon={page.icon}
                            />
                          ) : (
                            <SidebarMenuButton
                              asChild
                              isActive={!!page.href && pathname === page.href}
                              tooltip={page.title}
                            >
                              <Link href={page.href ?? "#"}>
                                <PageIcon name={page.icon ?? undefined} />
                                <span>{page.title}</span>
                              </Link>
                            </SidebarMenuButton>
                          )}
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          );
        })}

      </SidebarContent>

      <SidebarFooter>
        <NavUser user={userData} />
      </SidebarFooter>
      <SidebarRail />
    </SidebarPrimitive>
  );
}

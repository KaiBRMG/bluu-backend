"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, House, ChevronLeft, ChevronDown, type LucideIcon } from "lucide-react";
import {
  MessageSquareQuote,
  ShieldUser,
  PanelLeft,
  CalendarClock,
  Cog,
  MessageCircleQuestionMark,
  UserRoundCog,
  Share2,
  CalendarCog,
  ClockFading,
} from "lucide-react";
import type { ResolvedAccess } from "@/types/firestore";
import type { TeamspaceDef } from "@/lib/definitions";
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

const ICON_MAP: Record<string, LucideIcon> = {
  House,
  MessageSquareQuote,
  ShieldUser,
  PanelLeft,
  CalendarClock,
  Cog,
  MessageCircleQuestionMark,
  UserRoundCog,
  Share2,
  CalendarCog,
  ClockFading,
};

function NavIcon({ name, className }: { name?: string; className?: string }) {
  if (!name) return null;
  const Icon = ICON_MAP[name];
  if (!Icon) return null;
  return <Icon className={className} />;
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

  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() => {
    let stored: Record<string, boolean> = {};
    try {
      stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    } catch {}
    return Object.fromEntries(
      sortedTeamspaces.map((ts) => [ts.id, stored[ts.id] ?? true])
    );
  });

  const toggle = (id: string) =>
    setOpenMap((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });

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
                    <img
                      src="/logo/bluu_uu.svg"
                      alt="Bluu"
                      className="h-5 w-auto"
                    />
                  </button>
                ) : (
                  <Link href="/">
                    <img
                      src="/logo/bluu_long.svg"
                      alt="Bluu"
                      className="h-7 w-auto"
                    />
                  </Link>
                )}
              </SidebarMenuButton>
              {state === "expanded" && (
                <SidebarTrigger className="ml-1 shrink-0" />
              )}
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Home */}
        <SidebarGroup>
          <SidebarGroupContent>
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
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

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
                          <SidebarMenuButton
                            asChild
                            isActive={!!page.href && pathname === page.href}
                            tooltip={page.title}
                          >
                            <Link href={page.href ?? "#"}>
                              <NavIcon name={page.icon ?? undefined} />
                              <span>{page.title}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          );
        })}

        {/* Settings — pinned to bottom */}
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith("/applications/settings")}
                  tooltip="Settings"
                >
                  <Link href="/applications/settings/">
                    <Settings />
                    <span>Settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={userData} />
      </SidebarFooter>
      <SidebarRail />
    </SidebarPrimitive>
  );
}

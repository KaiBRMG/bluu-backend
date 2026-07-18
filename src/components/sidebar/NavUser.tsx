"use client";

import { IconDotsVertical, IconLogout, IconSettings } from "@tabler/icons-react";
import Link from "next/link";
import { auth } from "@/firebase-config";
import { clearPermissionsCache } from "@/lib/permissionsCache";
import { useTimeTrackingContext } from "@/contexts/TimeTrackingContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

import { getAvatarColor, getInitials } from '@/lib/utils/avatar';

interface NavUserProps {
  user: {
    name: string;
    groupName: string;
    photoURL?: string | null;
  };
}

function UserAvatarItem({ name, photoURL }: { name: string; photoURL?: string | null }) {
  return (
    <Avatar className="size-7" style={{ background: getAvatarColor(name || "User") }}>
      {photoURL && <AvatarImage src={photoURL} alt={name} />}
      <AvatarFallback style={{ background: getAvatarColor(name || "User"), color: "#fff" }}>
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function NavUser({ user }: NavUserProps) {
  const { isMobile } = useSidebar();
  const { clockOutAndFlush } = useTimeTrackingContext();

  // Signing out is a soft clock-out: the user is leaving the app without pressing
  // Clock Out, so flush the session first or it stays open server-side (and renders
  // as live) until the daily stale-session Cloud Function closes it.
  const handleSignOut = async () => {
    try {
      await clockOutAndFlush();
    } catch (error) {
      console.error("Clock-out on sign out failed:", error);
    }
    try {
      clearPermissionsCache();
      localStorage.removeItem('sessionToken');
      await auth.signOut();
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <UserAvatarItem name={user.name} photoURL={user.photoURL} />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs opacity-60">{user.groupName}</span>
              </div>
              <IconDotsVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <UserAvatarItem name={user.name} photoURL={user.photoURL} />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs opacity-60">{user.groupName}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/applications/settings/">
                <IconSettings />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSignOut} className="text-red-400">
              <IconLogout />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

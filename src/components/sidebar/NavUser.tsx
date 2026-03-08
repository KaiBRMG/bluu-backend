"use client";

import { IconDotsVertical, IconLogout } from "@tabler/icons-react";
import { auth } from "@/firebase-config";
import { clearPermissionsCache } from "@/lib/permissionsCache";
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

const AVATAR_COLORS = [
  "#E57373", "#F06292", "#BA68C8", "#7986CB", "#64B5F6",
  "#4DD0E1", "#4DB6AC", "#81C784", "#FFB74D", "#A1887F",
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function getAvatarColor(name: string): string {
  return AVATAR_COLORS[hashString(name) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  if (!name?.trim()) return "?";
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";
}

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

  const handleSignOut = async () => {
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

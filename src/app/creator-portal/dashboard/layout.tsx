"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, HeartHandshake, ImagePlay, CalendarCheck } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Dashboard", href: "/creator-portal/dashboard", icon: House },
  { title: "Welcome to Bluu Rock", href: "/creator-portal/dashboard/welcome", icon: HeartHandshake },
  { title: "Custom Requests", href: "/creator-portal/dashboard/all-customs", icon: ImagePlay },
  { title: "Content Planning", href: "/creator-portal/dashboard/content-requests", icon: CalendarCheck },
];

function CreatorSidebar() {
  const pathname = usePathname();
  const { setOpenMobile, isMobile } = useSidebar();

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar>
      <SidebarHeader
        className="px-5 py-4 border-b"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
      >
        <img src="/logo/bluu_long.svg" alt="Bluu Rock" className="h-5" />
      </SidebarHeader>
      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map(({ title, href, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === href}
                    className="text-zinc-400 hover:text-zinc-100 hover:bg-white/5 data-[active=true]:bg-white/10 data-[active=true]:text-zinc-100 rounded-lg h-10"
                  >
                    <Link href={href} onClick={handleNavClick}>
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="text-sm">{title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider
      style={{
        ["--sidebar" as string]: "#111113",
        ["--sidebar-foreground" as string]: "#fafafa",
        ["--sidebar-border" as string]: "rgba(255,255,255,0.06)",
        ["--sidebar-accent" as string]: "rgba(255,255,255,0.05)",
        ["--sidebar-accent-foreground" as string]: "#fafafa",
        ["--sidebar-ring" as string]: "rgba(139,92,246,0.5)",
      } as React.CSSProperties}
    >
      <CreatorSidebar />
      <SidebarInset className="bg-[#09090b]">
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}

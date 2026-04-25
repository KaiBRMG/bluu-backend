"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, ImagePlay, CalendarCheck } from "lucide-react";
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
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Welcome to Bluu Rock", href: "/creator-portal/dashboard/welcome", icon: House },
  { title: "Custom Requests", href: "/creator-portal/dashboard/all-customs", icon: ImagePlay },
  { title: "Content Planning", href: "/creator-portal/dashboard/content-requests", icon: CalendarCheck },
];

function CreatorSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar
      collapsible="none"
      style={{ background: "#111113", borderRight: "1px solid rgba(255,255,255,0.06)" }}
    >
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
                    className="text-zinc-400 hover:text-zinc-100 hover:bg-white/5 data-[active=true]:bg-white/10 data-[active=true]:text-zinc-100 rounded-lg"
                  >
                    <Link href={href}>
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
    <SidebarProvider>
      <CreatorSidebar />
      <SidebarInset className="bg-[#09090b]">
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}

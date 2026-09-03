"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { CREATOR_NAV_ITEMS } from "../nav";
import { CreatorBottomNav } from "../components/CreatorBottomNav";
import { COLOR } from "../theme";

function CreatorSidebar() {
  const pathname = usePathname();
  const { setOpenMobile, isMobile } = useSidebar();

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-5 py-4" style={{ borderColor: COLOR.line }}>
        {/* The logo is the one non-Avatar image in the portal. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo/bluu_long.svg" alt="Bluu Rock" className="h-5 w-auto" />
      </SidebarHeader>
      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {CREATOR_NAV_ITEMS.map(({ title, href, icon: Icon }) => {
                const active = pathname === href;
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      // Selection is a fill plus weight, never hue alone — the
                      // same rule the tab bar's rail exists for.
                      className="h-11 rounded-lg data-[active=true]:bg-[#00b8f5]/15 data-[active=true]:font-semibold data-[active=true]:text-[#f4f7fa] hover:bg-[#1e2934]"
                      style={{ color: active ? COLOR.ink : COLOR.ink2 }}
                    >
                      <Link
                        href={href}
                        onClick={handleNavClick}
                        aria-current={active ? "page" : undefined}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="text-sm">{title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
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
      style={
        {
          ["--sidebar" as string]: COLOR.ground,
          ["--sidebar-foreground" as string]: COLOR.ink,
          ["--sidebar-border" as string]: COLOR.line,
          ["--sidebar-accent" as string]: COLOR.raised,
          ["--sidebar-accent-foreground" as string]: COLOR.ink,
          ["--sidebar-ring" as string]: COLOR.azure,
        } as React.CSSProperties
      }
    >
      <CreatorSidebar />
      {/* The tab bar's clearance is padded on each page's own content wrapper,
          NOT here. Padding this container while every page ground is `min-h-dvh`
          inside it makes the minimum document height `100dvh + 4rem`, so even an
          empty page scrolls 64px into flat ground. */}
      <SidebarInset style={{ background: COLOR.void }}>{children}</SidebarInset>
      <CreatorBottomNav />
    </SidebarProvider>
  );
}

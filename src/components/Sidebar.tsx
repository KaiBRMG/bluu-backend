"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { ResolvedAccess } from "@/types/firestore";
import type { TeamspaceDef } from "@/lib/definitions";
import {
  House,
  ArrowLeftFromLine,
  ChevronDown,
  ChevronLeft,
  Settings,
  MessageSquareQuote,
  ShieldUser,
  PanelLeft,
  CalendarClock,
  UserRoundCog,
  Share2,
  CalendarCog,
  ClockFading,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  House,
  MessageSquareQuote,
  ShieldUser,
  PanelLeft,
  CalendarClock,
  UserRoundCog,
  Share2,
  CalendarCog,
  ClockFading,
};

function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name];
  if (!Icon) return <div className={className ?? "sidebar-nav-item-icon bg-zinc-700 rounded"} />;
  return <Icon className={className ?? "sidebar-nav-item-icon"} />;
}

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  teamspaces: TeamspaceDef[];
  accessiblePages: ResolvedAccess[];
}

interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  href?: string;
  subItems?: MenuItem[];
}

export default function Sidebar({
  isCollapsed,
  onToggleCollapse,
  teamspaces,
  accessiblePages,
}: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  // Build menu items dynamically from teamspaces + accessible pages
  const menuItems: MenuItem[] = [
    {
      id: "home",
      label: "Home",
      icon: "House",
      href: "/",
    },
    ...teamspaces
      .sort((a, b) => a.order - b.order)
      .filter((ts) => accessiblePages.some((p) => p.teamspaceId === ts.id))
      .map((ts) => ({
        id: ts.id,
        label: ts.name,
        icon: ts.icon,
        subItems: accessiblePages
          .filter((p) => p.teamspaceId === ts.id)
          .sort((a, b) => a.order - b.order)
          .map((p) => ({
            id: p.pageId,
            label: p.title,
            icon: p.icon || undefined,
            href: p.href || undefined,
          })),
      })),
  ];

  // Auto-expand parent items based on current pathname
  useEffect(() => {
    const activeParentId = menuItems.find((item) => {
      if (item.subItems) {
        return item.subItems.some(
          (subItem) => subItem.href && pathname.startsWith(subItem.href)
        );
      }
      return false;
    })?.id;

    if (activeParentId) {
      setExpandedItems([activeParentId]);
    } else {
      setExpandedItems([]);
    }
  }, [pathname, accessiblePages]);

  // Collapse all menu items when sidebar is collapsed
  useEffect(() => {
    if (isCollapsed) {
      setExpandedItems([]);
    } else {
      const activeParentId = menuItems.find((item) => {
        if (item.subItems) {
          return item.subItems.some(
            (subItem) => subItem.href && pathname.startsWith(subItem.href)
          );
        }
        return false;
      })?.id;

      if (activeParentId) {
        setExpandedItems([activeParentId]);
      }
    }
  }, [isCollapsed]);

  const toggleExpanded = (id: string) => {
    setExpandedItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleMenuItemClick = (item: MenuItem) => {
    if (isCollapsed) {
      onToggleCollapse();
      if (item.subItems && !expandedItems.includes(item.id)) {
        setExpandedItems((prev) => [...prev, item.id]);
      }
      return;
    }

    if (item.href) {
      router.push(item.href);
    } else if (item.subItems) {
      toggleExpanded(item.id);
    }
  };

  return (
    <aside
      className={`sidebar flex flex-col ${
        isCollapsed ? "sidebar-collapsed" : ""
      }`}
    >
      {/* Top section with logo and collapse button */}
      <div
        className="h-14 flex items-center px-4 relative overflow-hidden"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        {/* Full logo + collapse button (visible when expanded) */}
        <div
          className={`flex items-center justify-between w-full transition-opacity duration-[250ms] ease-out ${
            isCollapsed ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
        >
          <div className="flex items-center">
            <img
              src="/logo/bluu_long.svg"
              alt="Bluu Logo"
              className="h-8 w-auto"
            />
          </div>
          <button
            onClick={onToggleCollapse}
            className="p-1 rounded transition-colors"
            style={{ background: "transparent" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--hover-background)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
            title="Collapse sidebar"
          >
            <ArrowLeftFromLine className="sidebar-nav-item-icon" />
          </button>
        </div>

        {/* Icon logo (visible when collapsed) */}
        <button
          onClick={onToggleCollapse}
          className={`absolute left-0 top-0 h-full w-full flex items-center justify-center transition-opacity duration-[250ms] ease-out ${
            isCollapsed ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          style={{ background: "transparent" }}
          title="Expand sidebar"
        >
          <img
            src="/logo/bluu_uu.svg"
            alt="Bluu"
            className="h-5 w-auto"
          />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        <div className="sidebar-nav-group">
          {menuItems.map((item) => (
            <div key={item.id}>
              <button
                onClick={() => handleMenuItemClick(item)}
                className={`sidebar-nav-item w-full ${
                  item.href && pathname === item.href ? "active" : ""
                }`}
              >
                {item.icon ? (
                  <NavIcon name={item.icon} />
                ) : (
                  <div className="sidebar-nav-item-icon bg-zinc-700 rounded"></div>
                )}

                <span className="sidebar-nav-item-text">{item.label}</span>
                {item.subItems && (
                  expandedItems.includes(item.id)
                    ? <ChevronDown className="sidebar-nav-item-arrow" />
                    : <ChevronLeft className="sidebar-nav-item-arrow" />
                )}
              </button>

              {/* Sub-items */}
              {item.subItems && expandedItems.includes(item.id) && (
                <div
                  className={`sidebar-nav-group ${
                    isCollapsed ? "hidden" : ""
                  }`}
                >
                  {item.subItems.map((subItem) => (
                    <button
                      key={subItem.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (subItem.href) {
                          router.push(subItem.href);
                        }
                      }}
                      className={`sidebar-nav-item nested-1 w-full ${
                        subItem.href && pathname === subItem.href
                          ? "active"
                          : ""
                      }`}
                    >
                      {subItem.icon ? (
                        <NavIcon name={subItem.icon} />
                      ) : (
                        <div className="sidebar-nav-item-icon"></div>
                      )}
                      <span className="sidebar-nav-item-text">
                        {subItem.label}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </nav>

      {/* Bottom section - Settings */}
      <div
        className="p-2"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <button
          onClick={() => router.push("/applications/settings/")}
          className={`sidebar-nav-item w-full ${
            pathname === "/applications/settings/" ? "active" : ""
          }`}
        >
          <Settings className="sidebar-nav-item-icon" />
          <span className="sidebar-nav-item-text">Settings</span>
        </button>
      </div>
    </aside>
  );
}

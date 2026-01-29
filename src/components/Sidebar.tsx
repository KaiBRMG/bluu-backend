"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  userData: {
    name: string;
    email: string;
    role: string;
  };
}

interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  href?: string;
  subItems?: MenuItem[];
}

export default function Sidebar({ isCollapsed, onToggleCollapse, userData }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  // Mock menu structure - customize based on user groups
  const menuItems: MenuItem[] = [
    {
      id: "home",
      label: "Home",
      icon: "/Icons/house.svg",
      href: "/"
    },
    {
      id: "ca-portal",
      label: "CA Portal",
      icon: "/Icons/ca-portal.svg",
      subItems: [
        {
          id: "shifts",
          label: "Shifts",
          icon: "/Icons/calendar-clock.svg",
          href: "/ca-portal/shifts"
        },
        { id: "documents", label: "Documents" },
        { id: "calendar", label: "Calendar" },
      ]
    },
    {
      id: "admin",
      label: "Admin",
      icon: "/Icons/shield-user.svg",
      subItems: [
        { id: "sharing", label: "Sharing" },
        { id: "organisation-settings", label: "Organisation Settings" },
        { id: "user-settings", label: "User Settings" },
      ]
    },
    {
      id: "apps",
      label: "Apps",
      icon: "/Icons/layout-panel-left.svg",
      subItems: [
        {
          id: "time-tracking",
          label: "Time Tracking",
          icon: "/Icons/time-tracking.svg",
          href: "/applications/time-tracking"
        },
        { id: "app-2", label: "App 2 (Placeholder)" },
        { id: "app-3", label: "App 3 (Placeholder)" },
      ]
    }
  ];

  // Auto-expand parent items based on current pathname
  useEffect(() => {
    // Find the parent item that contains the active subitem
    const activeParentId = menuItems.find((item) => {
      if (item.subItems) {
        return item.subItems.some(
          (subItem) => subItem.href && pathname.startsWith(subItem.href)
        );
      }
      return false;
    })?.id;

    // Only expand the parent of the currently active subitem
    if (activeParentId) {
      setExpandedItems([activeParentId]);
    } else {
      setExpandedItems([]);
    }
  }, [pathname]);

  // Collapse all menu items when sidebar is collapsed
  useEffect(() => {
    if (isCollapsed) {
      setExpandedItems([]);
    } else {
      // When expanding, re-check the current pathname to expand the active parent
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
    setExpandedItems(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleMenuItemClick = (item: MenuItem) => {
    // If sidebar is collapsed, expand it first
    if (isCollapsed) {
      onToggleCollapse();
      // If the item has subItems, also expand it
      if (item.subItems && !expandedItems.includes(item.id)) {
        setExpandedItems(prev => [...prev, item.id]);
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
      <div className="h-14 flex items-center justify-between px-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {!isCollapsed ? (
          <>
            <div className="flex items-center">
              {/* Logo */}
              <img src="/logo/bluu_long.svg" alt="Bluu Logo" className="h-8 w-auto" />
            </div>
            <button
              onClick={onToggleCollapse}
              className="p-1 rounded transition-colors"
              style={{ background: 'transparent' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover-background)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              title="Collapse sidebar"
            >
              <img src="/Icons/menu_collapse.svg" alt="Collapse" className="sidebar-nav-item-icon" />
            </button>
          </>
        ) : (
          <button
            onClick={onToggleCollapse}
            className="p-1 rounded transition-colors mx-auto"
            style={{ background: 'transparent' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover-background)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            title="Expand sidebar"
          >
            <img src="/logo/bluu_uu.svg" alt="Bluu" className="h-10 w-auto" />
          </button>
        )}
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
                {/* Icon */}
                {item.icon && item.icon.endsWith('.svg') ? (
                  <img src={item.icon} alt={item.label} className="sidebar-nav-item-icon" />
                ) : (
                  <div className="sidebar-nav-item-icon bg-zinc-700 rounded"></div>
                )}

                <span className="sidebar-nav-item-text">{item.label}</span>
                {item.subItems && (
                  <img
                    src={expandedItems.includes(item.id) ? "/Icons/expanded_arrow.svg" : "/Icons/collapsed_arrow.svg"}
                    alt={expandedItems.includes(item.id) ? "Collapse" : "Expand"}
                    className="sidebar-nav-item-arrow"
                  />
                )}
              </button>

              {/* Sub-items */}
              {item.subItems && expandedItems.includes(item.id) && (
                <div className={`sidebar-nav-group ${isCollapsed ? "hidden" : ""}`}>
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
                        pathname === subItem.href ? "active" : ""
                      }`}
                    >
                      {subItem.icon && subItem.icon.endsWith('.svg') ? (
                        <img src={subItem.icon} alt={subItem.label} className="sidebar-nav-item-icon" />
                      ) : (
                        <div className="sidebar-nav-item-icon"></div>
                      )}
                      <span className="sidebar-nav-item-text">{subItem.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </nav>

      {/* Bottom section - Settings */}
      <div className="p-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => router.push('/applications/settings/')}
          className={`sidebar-nav-item w-full ${pathname === '/applications/settings/' ? 'active' : ''}`}
        >
          <img src="/Icons/settings.svg" alt="Settings" className="sidebar-nav-item-icon" />
          <span className="sidebar-nav-item-text">Settings</span>
        </button>
      </div>
    </aside>
  );
}

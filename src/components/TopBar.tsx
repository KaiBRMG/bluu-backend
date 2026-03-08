"use client";

import { clearPermissionsCache } from "@/lib/permissionsCache";
import { auth } from "../firebase-config";
import TimerPill from "@/components/TimerPill";
import NotificationTray from "@/components/NotificationTray";

export default function TopBar() {
  return (
    <header className="h-14 flex items-center justify-between px-6 sticky top-0 z-50" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--sidebar-background)' }}>
      <TimerPill />
      <div className="ml-auto flex items-center gap-4">
        <NotificationTray />
      </div>
    </header>
  );
}

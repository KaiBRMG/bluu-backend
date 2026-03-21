"use client";

import dynamic from "next/dynamic";

const TimeTrackingProvider = dynamic(
  () => import("@/contexts/TimeTrackingContext").then((m) => m.TimeTrackingProvider),
  { ssr: false }
);
const NotificationsProvider = dynamic(
  () => import("@/hooks/useNotifications").then((m) => m.NotificationsProvider),
  { ssr: false }
);

export default function LazyProviders({ children }: { children: React.ReactNode }) {
  return (
    <NotificationsProvider>
      <TimeTrackingProvider>
        {children}
      </TimeTrackingProvider>
    </NotificationsProvider>
  );
}

import { House, HeartHandshake, ImagePlay, CalendarCheck } from "lucide-react";

/**
 * The portal's four destinations, in one place — rendered by the desktop
 * `Sidebar` (full `title`) and the mobile `CreatorBottomNav` (`shortTitle`, which
 * has to fit a quarter of a phone's width). Add a destination here, not twice.
 */
export const CREATOR_NAV_ITEMS = [
  { title: "Dashboard", shortTitle: "Home", href: "/creator/dashboard", icon: House },
  { title: "Welcome to Bluu Rock", shortTitle: "Welcome", href: "/creator/dashboard/welcome", icon: HeartHandshake },
  { title: "Custom Requests", shortTitle: "Customs", href: "/creator/dashboard/all-customs", icon: ImagePlay },
  { title: "Content Planning", shortTitle: "Content", href: "/creator/dashboard/content-requests", icon: CalendarCheck },
] as const;

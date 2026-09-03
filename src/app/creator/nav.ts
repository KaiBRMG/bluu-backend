import { CalendarCheck, HeartHandshake, ImagePlay, Sun } from "lucide-react";

/**
 * The portal's four destinations, in one place — rendered by the desktop
 * `Sidebar` (full `title`) and the mobile `CreatorBottomNav` (`shortTitle`,
 * which has to fit a quarter of a phone's width). Add a destination here, not
 * twice. Past four tabs the bar needs rethinking, not a fifth squeeze.
 *
 * **Order is thumb order, not importance order.** The two destinations a creator
 * uses daily sit first; the reference page she reads once sits last.
 *
 * `/creator/dashboard` must stay the first entry's href: it is the URL the bot's
 * chat menu button points at, and pointing that at `/creator` (which 307s) can
 * drop the launch fragment and lock a linked creator out. See telegram.md.
 */
export const CREATOR_NAV_ITEMS = [
  { title: "Today", shortTitle: "Today", href: "/creator/dashboard", icon: Sun },
  { title: "Custom Requests", shortTitle: "Customs", href: "/creator/dashboard/all-customs", icon: ImagePlay },
  { title: "Content Plan", shortTitle: "Content", href: "/creator/dashboard/content-requests", icon: CalendarCheck },
  { title: "Welcome Guide", shortTitle: "Guide", href: "/creator/dashboard/welcome", icon: HeartHandshake },
] as const;

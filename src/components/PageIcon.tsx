"use client";

import Image from "next/image";
import {
  Astroid,
  House,
  MessageSquareQuote,
  ShieldUser,
  BookOpen,
  BookHeart,
  BookType,
  PanelLeft,
  CalendarClock,
  KeyRound,
  Cog,
  FileUser,
  UserStar,
  ImagePlay,
  BookOpenText,
  SquareStar,
  CalendarCheck,
  MessageCircleQuestionMark,
  UserRoundCog,
  LayoutDashboard,
  BellPlus,
  Share2,
  CalendarCog,
  ClockFading,
  type LucideIcon,
} from "lucide-react";

/**
 * The single name → icon map for the `icon` field on PageDef/TeamspaceDef in
 * `src/lib/definitions.ts`. The sidebar and the sharing table both render from
 * it, so a page added to `definitions.ts` only needs its icon registered once.
 */
export const ICON_MAP: Record<string, LucideIcon> = {
  Astroid,
  House,
  MessageSquareQuote,
  ShieldUser,
  BookOpen,
  BookHeart,
  BookType,
  PanelLeft,
  CalendarClock,
  SquareStar,
  KeyRound,
  Cog,
  FileUser,
  ImagePlay,
  CalendarCheck,
  UserStar,
  LayoutDashboard,
  BellPlus,
  BookOpenText,
  MessageCircleQuestionMark,
  UserRoundCog,
  Share2,
  CalendarCog,
  ClockFading,
};

// Brand icons that have no lucide equivalent are served from /Icons as SVGs.
// Same escape hatch the sidebar logo already uses — everything else stays in
// ICON_MAP so the icon set remains lucide-only.
export const SVG_ICONS: Record<string, string> = {
  OnlyFans: "/Icons/onlyfans.svg",
};

/** Renders a page/teamspace icon by its definition name. Nothing if unmapped. */
export function PageIcon({ name, className }: { name?: string; className?: string }) {
  if (!name) return null;
  const svg = SVG_ICONS[name];
  if (svg) {
    return (
      <Image
        src={svg}
        alt=""
        width={16}
        height={16}
        aria-hidden
        className={className}
        style={{ width: "1rem", height: "1rem" }}
      />
    );
  }
  const Icon = ICON_MAP[name];
  if (!Icon) return null;
  return <Icon className={className} aria-hidden />;
}

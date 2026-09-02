"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABBAR_STYLE } from "../theme";
import { CREATOR_NAV_ITEMS } from "../nav";

/**
 * Mobile primary navigation.
 *
 * The portal's desktop nav is the shadcn `Sidebar`; on a phone that means a
 * hamburger in the top-left corner — the hardest place on the screen to reach
 * one-handed, and two taps to every destination. This puts the same four
 * destinations in the thumb zone at one tap each. Rendered `md:hidden`; the
 * sidebar (and its trigger) take over from `md` up.
 *
 * The active state is carried by a SHAPE (the top rail) plus hue, not hue alone.
 * Colour cannot do this job here: active `sky-300` against inactive `zinc-500`
 * measures 2.90:1, under the 3:1 WCAG 1.4.11 requires of a state indicator — and
 * raising inactive to the AA-legal `zinc-400` collapses the two to 1.54:1. So
 * `zinc-400` carries the text contrast (7.76:1 on the ground) and the rail
 * carries the state. Do not "simplify" this back to a colour swap.
 */
export function CreatorBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex select-none [-webkit-tap-highlight-color:transparent] md:hidden"
      style={TABBAR_STYLE}
    >
      {CREATOR_NAV_ITEMS.map(({ shortTitle, href, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`relative flex h-16 flex-1 flex-col items-center justify-center gap-1 transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400 focus-visible:outline-none active:bg-white/5 ${
              active ? "text-sky-300" : "text-zinc-400"
            }`}
          >
            {/* The state cue. Shape, not just hue — see the note above. */}
            <span
              aria-hidden="true"
              className={`absolute inset-x-0 top-0 h-0.5 rounded-b-full transition-colors ${
                active ? "bg-sky-400" : "bg-transparent"
              }`}
            />
            <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.25 : 1.75} />
            <span className={`text-[11px] leading-none ${active ? "font-medium" : ""}`}>
              {shortTitle}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

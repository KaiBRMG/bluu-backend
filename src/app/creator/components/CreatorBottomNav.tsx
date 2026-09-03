"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { COLOR, FOCUS_RING, TABBAR_STYLE } from "../theme";
import { CREATOR_NAV_ITEMS } from "../nav";
import { tapFeedback } from "../lib/haptics";

/**
 * Mobile primary navigation.
 *
 * The portal's desktop nav is the shadcn `Sidebar`; on a phone that means a
 * hamburger in the top-left corner — the hardest place on the screen to reach
 * one-handed, and two taps to every destination. This puts the same four
 * destinations in the thumb zone at one tap each. Rendered `md:hidden`; the
 * sidebar and its trigger take over from `md` up.
 *
 * ── The active state is a SHAPE, not a hue ───────────────────────────────────
 * Colour cannot do this job on this palette. Measured: `azure` against the
 * AA-legal `ink2` is **1.14:1** — nowhere near the 3:1 WCAG 1.4.11 requires of a
 * state indicator, and dropping the inactive step to something that *would*
 * separate would push it under the 4.5:1 text floor. So `ink2` carries the text
 * contrast (9.4:1 on this ground), the **2px azure top rail** carries the state,
 * and the active label steps up in weight as a third cue.
 *
 * Do not "simplify" this back to a colour swap. This note is here because that
 * is the change someone will try to make.
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
            onClick={() => tapFeedback()}
            className={`relative flex h-16 flex-1 flex-col items-center justify-center gap-1 transition-colors active:bg-[#131d27] ${FOCUS_RING}`}
            style={{ color: active ? COLOR.ink : COLOR.ink2 }}
          >
            {/* The state cue. Shape first — see the note above. */}
            <span
              aria-hidden="true"
              className="absolute inset-x-3 top-0 h-0.5 rounded-b-full transition-colors"
              style={{ background: active ? COLOR.azure : "transparent" }}
            />
            <Icon className="size-5 shrink-0" strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
            <span className={`text-[11px] leading-none ${active ? "font-semibold" : "font-medium"}`}>
              {shortTitle}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

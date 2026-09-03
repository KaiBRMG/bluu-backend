import { JetBrains_Mono } from "next/font/google";

/**
 * The portal's numeric voice.
 *
 * DESIGN.md §3's One-Family Rule (Google Sans carries the whole console) is a
 * §1–6 console rule; the portal is an authored divergence and this is the one
 * place it diverges on type. The reason is specific rather than decorative: the
 * portal's entire structure is a **time axis**, and dates, countdowns, CR codes
 * and amounts are the things a creator scans down that axis. A monospace with
 * real tabular figures makes that column align and read as an instrument; Google
 * Sans with `tabular-nums` aligns but does not distinguish.
 *
 * It is scoped hard so it cannot leak:
 *  - `next/font` **self-hosts** the file from our own origin. No Google Fonts
 *    CDN request, which matters in a Telegram webview on a bad connection and
 *    is a different loading path from the console's `google-fonts` <link>.
 *  - `latin` subset and two weights only — the whole face is a few KB.
 *  - Exposed as a CSS variable applied on the `/creator` segment's own wrapper,
 *    so the Electron console never inherits it.
 *  - `display: swap` — Google Sans renders the fallback immediately; a late
 *    mono swap shifts nothing because every use is in a fixed-height row.
 */
export const portalMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-portal-mono",
  display: "swap",
});

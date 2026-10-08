import type { Metadata } from 'next';
import type { ComponentType } from 'react';
import {
  IconBrandTelegram,
  IconDeviceDesktop,
  IconInfoCircle,
  IconSparkles,
} from '@tabler/icons-react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { TELEGRAM_BOT_URL, TELEGRAM_BOT_USERNAME } from '@/lib/telegramConfig';
import {
  DOOR,
  DOOR_ACTION,
  DOOR_ARROW,
  DOOR_ARROW_OUT,
  DOOR_GLYPH,
  SELECTION,
  STAGE_GROUND,
} from './_lib/theme';

export const metadata: Metadata = {
  title: 'Bluu Rock',
  description: 'Creators, applicants and Bluu Rock staff — find your way in.',
  // Handed out as a domain, not something we want in search results — same
  // posture as the application form and the installer page.
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The front door — `/desktop-only`, public and unauthenticated.
 *
 * Every browser request that is not on the middleware allowlist is rewritten
 * here, the bare domain included, so this page is what anyone who types
 * `app.bluurock.com` sees. Three readers arrive and the page sends each one on:
 *
 * ▸ **A creator** → `@BluuRockBot`. Telegram is the only way into the creator
 *   portal (there is no `/creator/login`), so the door opens the bot, whose menu
 *   button launches the Mini App with signed `initData`. Linking to `/creator`
 *   from a browser would land them on a refusal.
 * ▸ **A prospective creator** → `/model-submissions`, the public application.
 * ▸ **Staff** → `/download`. The console only runs in the desktop app; anyone
 *   who has it should open it, everyone else installs it.
 * ▸ **Anyone else** → bluurock.com. Not an audience but a way out: someone who
 *   landed here without knowing what Bluu Rock is gets the company site.
 *
 * The three audiences are ordered by how often each one arrives, not ranked —
 * no door is filled (see `_lib/theme.ts`) — and the way out always comes last.
 *
 * A server component with plain anchors: no client JS, and no `<Link>` prefetch
 * firing RSC requests at a page whose visitors mostly leave the site (rule 9i).
 *
 * Each door is labelled by its question and action, and described by its body
 * copy — otherwise the whole row's text becomes one paragraph-long link name.
 * The wrapper around the copy is a `<div>`, not a `<span>`: a heading is flow
 * content and is invalid inside phrasing content.
 *
 * Skin: `_lib/theme.ts` (DESIGN.md §10). Never inline a hex here.
 */

interface Door {
  question: string;
  body: string;
  action: string;
  href: string;
  /** Off-site: opens in a new tab, with an outward arrow and a spoken hint. */
  external?: boolean;
  Glyph: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}

const DOORS: Door[] = [
  {
    question: 'Are you a creator?',
    body: `Your portal lives in Telegram. Open @${TELEGRAM_BOT_USERNAME} and tap the menu button to see what's due.`,
    action: 'Open in Telegram',
    href: TELEGRAM_BOT_URL,
    external: true,
    Glyph: IconBrandTelegram,
  },
  {
    question: 'Want to become a creator?',
    body: 'Tell us about yourself. Every application is read by a person and kept confidential.',
    action: 'Apply now',
    href: '/model-submissions',
    Glyph: IconSparkles,
  },
  {
    question: 'Bluu Rock employee?',
    body: 'Open Bluu Backend on your desktop. Not installed yet? Download the app for macOS or Windows.',
    action: 'Download the app',
    href: '/download',
    Glyph: IconDeviceDesktop,
  },
  {
    question: 'Who is Bluu Rock?',
    body: 'See who we are and what we do.',
    action: 'Visit bluurock.com',
    href: 'https://bluurock.com',
    external: true,
    Glyph: IconInfoCircle,
  },
];

export default function FrontDoorPage() {
  return (
    <main
      className={`flex min-h-dvh flex-col text-white ${SELECTION}`}
      style={STAGE_GROUND}
    >
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-4 py-12 sm:px-6 sm:py-20">
        <header className="flex flex-col gap-6 pb-8 sm:pb-10">
          {/* Intrinsic size given so the ratio is known before the bytes land —
              a raster logo with only a height reserves no width and shifts the
              masthead as it decodes. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo/HQ2.webp"
            alt="Bluu Rock"
            width={1374}
            height={868}
            className="h-10 w-auto self-start"
          />
          <div className="flex flex-col gap-2">
            <h1 className="text-[2rem] leading-[1.1] font-semibold tracking-[-0.02em] text-balance sm:text-[2.5rem]">
              Welcome to Bluu Rock
            </h1>
            <p className="text-base text-pretty text-white/60">Where would you like to go?</p>
          </div>
        </header>

        <nav aria-label="Choose your way in">
          <ul className="flex flex-col gap-3">
            {DOORS.map(({ question, body, action, href, external, Glyph }, i) => {
              const Arrow = external ? ArrowUpRight : ArrowRight;
              const arrowClass = external ? DOOR_ARROW_OUT : DOOR_ARROW;
              const id = `door-${i}`;
              return (
                <li key={href}>
                  <a
                    href={href}
                    className={DOOR}
                    aria-labelledby={`${id}-q ${id}-a`}
                    aria-describedby={`${id}-b`}
                    {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    <span className={DOOR_GLYPH}>
                      <Glyph aria-hidden className="size-5" />
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <h2 id={`${id}-q`} className="text-lg leading-snug font-semibold text-white">
                        {question}
                      </h2>
                      <span
                        id={`${id}-b`}
                        className="mt-1 text-[15px] leading-relaxed text-pretty text-white/60"
                      >
                        {body}
                      </span>
                      <span id={`${id}-a`} className={DOOR_ACTION}>
                        {action}
                        <Arrow aria-hidden className={arrowClass} />
                        {/* Leading space is load-bearing: without it the
                            accessible name reads "Open in Telegram(opens…". */}
                        {external && <span className="sr-only"> (opens in a new tab)</span>}
                      </span>
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </main>
  );
}

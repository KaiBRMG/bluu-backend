'use client';

/**
 * The installer page — `/download`, public and unauthenticated (allowlisted in
 * `src/middleware.ts`). Read by a new colleague on a machine with no app on it,
 * and — via `APP_UPDATE.downloadUrl` — by a Windows shell too old to update
 * itself, opened in the system browser. Both want the same thing: the file.
 *
 * **Every button is a direct download.** It points at `/api/download/[platform]`,
 * which 302s to the newest published installer on GitHub Releases — no folder to
 * browse, no "take the newest file", nothing to bump on release. The version on
 * the button is read from `/api/download`, the same lookup the click follows, so
 * the chip can never describe a different file from the one handed over.
 *
 * **No certificate step.** Windows builds are signed through Azure Artifact
 * Signing from v1.0, so there is nothing to trust by hand any more.
 *
 * The Mac decision has a wrong answer with a long tail: the x64 `.dmg` carries
 * no arch suffix, so an Apple Silicon user who takes it runs under Rosetta and
 * keeps taking x64 updates from then on. That is what "Not sure which Mac you
 * have?" is for, and why it sits beside the button rather than in a support doc.
 *
 * The page is written to be skimmed. Everything that is not the instruction, the
 * file, or the decision has been cut.
 *
 * Skin: `_lib/theme.ts` (DESIGN.md §9). Never inline a hex here.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { IconBrandApple, IconBrandWindows } from '@tabler/icons-react';
import { Check, ChevronDown, Download, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  INSTALLER_PLATFORMS,
  installerHref,
  type InstallerPlatform,
  type InstallerVersions,
} from '@/lib/installers';
import { cn } from '@/lib/utils';
import {
  BENCH_GROUND,
  BTN_VERSION,
  FILE_CHIP,
  FOOTER_LINK,
  INLINE_LINK,
  OPTION,
  PANEL,
  PRIMARY_BTN,
  PRIMARY_BTN_STYLE,
  UI_CHIP,
} from './_lib/theme';

const ISSUE_URL = 'https://forms.gle/QPs5gjzvX5TPg2zLA';
const CONTACT_URL = 'https://t.me/KaiJN';

/* ── Platform ───────────────────────────────────────────────────────────── */

/**
 * OS only. Chip architecture is not knowable from the user agent — asking is.
 *
 * `mobile` is checked first because an iPhone's UA says "like Mac OS X", which
 * used to preselect Apple Silicon and offer a phone a `.dmg`. iPadOS reports a
 * desktop Mac UA, so a Mac with touch points is treated as a tablet too.
 */
function detectOs(): 'windows' | 'mac' | 'mobile' | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return 'mobile';
  if (/Mac/i.test(ua) && navigator.maxTouchPoints > 1) return 'mobile';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(ua)) return 'mac';
  return null;
}

/** Detection never changes during a session, so there is nothing to subscribe to. */
const NEVER_CHANGES = () => () => {};

const PLATFORMS: Record<
  InstallerPlatform,
  { name: string; spec: string; Icon: typeof IconBrandWindows; cta: string }
> = {
  windows: {
    name: 'Windows',
    spec: 'Windows 10 or 11 · 64-bit',
    Icon: IconBrandWindows,
    cta: 'Download for Windows',
  },
  // The names are deliberately short. "macOS · Apple Silicon" wrapped to two or
  // three lines between 640 and ~800px and left the row ragged; the Apple mark
  // beside it already says macOS, and the version floor belongs on the spec line.
  'mac-arm': {
    name: 'Apple Silicon',
    spec: 'macOS 12+ · M1 and newer',
    Icon: IconBrandApple,
    cta: 'Download for Apple Silicon',
  },
  'mac-intel': {
    name: 'Intel Mac',
    spec: 'macOS 12+ · before 2020',
    Icon: IconBrandApple,
    cta: 'Download for Intel Mac',
  },
};

/* ── Pieces ─────────────────────────────────────────────────────────────── */

/** Quotes a literal control in the OS's own dialogs. */
function Ui({ children }: { children: React.ReactNode }) {
  return <span className={UI_CHIP}>{children}</span>;
}

/** Quotes a filename the reader has to recognise on disk. */
function FileName({ children }: { children: React.ReactNode }) {
  return <span className={FILE_CHIP}>{children}</span>;
}

/**
 * The download button. A plain same-tab link: the redirect ends in a file, so
 * the browser downloads it and the page stays put.
 *
 * `version` is three-state. `undefined` — the lookup has not answered — holds
 * the chip's width with an invisible placeholder, so the button does not widen
 * (and shove the instruction beside it) when the number lands. `null` — no
 * answer — drops the chip; a version is never guessed.
 */
function DownloadButton({
  platform,
  version,
  onClick,
}: {
  platform: InstallerPlatform;
  version: string | null | undefined;
  onClick: () => void;
}) {
  return (
    <Button asChild className={PRIMARY_BTN} style={PRIMARY_BTN_STYLE}>
      <a href={installerHref(platform)} onClick={onClick}>
        <Download className="size-[18px]" aria-hidden />
        {PLATFORMS[platform].cta}
        {version === undefined ? (
          <span aria-hidden className={cn(BTN_VERSION, 'invisible')}>
            v0.0.0
          </span>
        ) : (
          version && <span className={BTN_VERSION}>v{version}</span>
        )}
      </a>
    </Button>
  );
}

/**
 * Radix gives the tab panel `tabIndex={0}` so a keyboard user can land in it,
 * and shadcn's `TabsContent` sets `outline-none` — which leaves that landing
 * invisible. The ring puts it back (WCAG 2.4.7).
 */
const TAB_PANEL =
  'rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b8f5]/45 ' +
  'data-[state=active]:animate-in data-[state=active]:fade-in-0 ' +
  'data-[state=active]:slide-in-from-bottom-1 data-[state=active]:duration-200 motion-reduce:animate-none';

const NO_VERSIONS: InstallerVersions = { windows: null, 'mac-arm': null, 'mac-intel': null };

/** Shared by the phone notice and the confirmation line — quiet, never azure. */
const NOTE_ICON = 'mt-0.5 size-4 flex-none text-white/55';

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function DownloadPage() {
  const detected = useSyncExternalStore(NEVER_CHANGES, detectOs, () => null);

  // An explicit pick always wins; until there is one the detected OS decides,
  // and Windows is the answer when nothing is known. A Mac preselects Apple
  // Silicon because that is the safer wrong guess — see the file header.
  const [picked, setPicked] = useState<InstallerPlatform | null>(null);
  const choice: InstallerPlatform = picked ?? (detected === 'mac' ? 'mac-arm' : 'windows');

  // `null` while the lookup is in flight — see `DownloadButton`.
  const [versions, setVersions] = useState<InstallerVersions | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/download')
      .then((res) => (res.ok ? (res.json() as Promise<InstallerVersions>) : null))
      .then((data) => {
        if (!cancelled) setVersions({ ...NO_VERSIONS, ...data });
      })
      .catch(() => {
        // The buttons work without it — only the version chip is missing.
        if (!cancelled) setVersions(NO_VERSIONS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The link 302s to a ~100 MB file and the page itself never changes, so
  // without this a click looks like it did nothing and gets repeated — two
  // copies in Downloads. Keyed by platform so switching tabs does not carry it.
  const [started, setStarted] = useState<InstallerPlatform | null>(null);

  const isMac = choice !== 'windows';

  return (
    <main
      className="min-h-dvh text-white selection:bg-[#00b8f5] selection:text-[#04141c]"
      style={BENCH_GROUND}
    >
      <div className="mx-auto flex w-full max-w-[860px] flex-col px-5 pb-16 sm:px-8 sm:pb-24">
        {/* ── Masthead ───────────────────────────────────────────────────── */}
        <header className="flex flex-col gap-6 pt-10 pb-8 sm:pt-14 sm:pb-10">
          {/* Intrinsic size given so the ratio is known before the bytes land —
              a raster logo with only a height would reserve no width and shift
              the masthead as it decodes. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo/HQ2.webp"
            alt="Bluu Rock"
            width={1374}
            height={868}
            className="h-10 w-auto self-start"
          />
          <h1 className="text-[2rem] leading-[1.1] font-semibold tracking-[-0.02em] text-balance sm:text-[2.5rem]">
            Download Bluu Backend
          </h1>
        </header>

        {/* ── On a phone ────────────────────────────────────────────────────
            The link usually arrives in a chat app, so a phone is a common first
            visit. The panel stays — the reader may be choosing for later — but
            they are told first that nothing here installs on the device in hand. */}
        {detected === 'mobile' && (
          <p className={cn('mb-4 flex gap-3 rounded-2xl px-5 py-4 text-[14.5px] leading-relaxed text-white/80', PANEL)}>
            <Monitor aria-hidden className={NOTE_ICON} />
            Bluu Backend is a desktop app. Open this page on your Windows PC or Mac to
            install it.
          </p>
        )}

        {/* ── The install panel ──────────────────────────────────────────── */}
        <section className={cn('rounded-2xl p-5 sm:p-7', PANEL)}>
          <Tabs value={choice} onValueChange={(v) => setPicked(v as InstallerPlatform)} className="gap-6">
            <TabsList
              aria-label="Choose your platform"
              className="grid h-auto! w-full grid-cols-1 gap-2 bg-transparent p-0 md:grid-cols-3"
            >
              {INSTALLER_PLATFORMS.map((id) => {
                const { name, spec, Icon } = PLATFORMS[id];
                return (
                  <TabsTrigger key={id} value={id} className={OPTION}>
                    <Check
                      aria-hidden
                      className="absolute top-3.5 right-3.5 size-4 text-[#00b8f5] opacity-0 transition-opacity duration-150 group-data-[state=active]/opt:opacity-100"
                    />
                    <span className="flex items-center gap-2 pr-6 text-[15px] font-semibold text-white">
                      <Icon
                        aria-hidden
                        className="size-[18px] flex-none text-white/45 transition-colors duration-150 group-data-[state=active]/opt:text-[#00b8f5]"
                      />
                      {name}
                    </span>
                    <span className="text-[12.5px] leading-snug text-white/55">{spec}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {INSTALLER_PLATFORMS.map((id) => (
              <TabsContent key={id} value={id} className={cn('flex flex-col', TAB_PANEL)}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                  <DownloadButton
                    platform={id}
                    version={versions === null ? undefined : versions[id]}
                    onClick={() => setStarted(id)}
                  />
                  {id === 'windows' ? (
                    <p className="text-[13px] leading-relaxed text-white/55">
                      Run the installer. If Windows warns you, choose <Ui>More info</Ui>{' '}
                      and then <Ui>Run anyway</Ui>
                    </p>
                  ) : (
                    <p className="text-[13px] leading-relaxed text-white/55">
                      Open the <FileName>.dmg</FileName> and drag Bluu Backend into
                      Applications
                    </p>
                  )}
                </div>
              </TabsContent>
            ))}
          </Tabs>

          {/* Mounted from the first paint so assistive tech is already watching
              the region when the message arrives (a live region inserted with
              its content is not announced). */}
          <p role="status" className="mt-4 flex gap-3 empty:mt-0 text-[13.5px] leading-relaxed text-white/70">
            {started === choice && (
              <>
                <Check aria-hidden className={NOTE_ICON} />
                Your download is starting. It will be in your browser’s downloads
                when it finishes.
              </>
            )}
          </p>

          {/* The picker is a client control. Without scripting the tabs cannot be
              switched, so every installer has to stay reachable as plain links or
              a Mac visitor is stranded on the Windows default. */}
          <noscript>
            <div className="mt-6 flex flex-col gap-2 border-t border-white/10 pt-5 text-[14px] text-white/70">
              {INSTALLER_PLATFORMS.map((id) => (
                <a key={id} href={installerHref(id)} className={INLINE_LINK}>
                  {PLATFORMS[id].name}
                </a>
              ))}
            </div>
          </noscript>
        </section>

        {/* ── Which Mac? (macOS only) ────────────────────────────────────── */}
        {isMac && (
          <Collapsible className={cn('mt-4 rounded-2xl', PANEL)}>
            <CollapsibleTrigger className="group/disc flex w-full items-center justify-between gap-4 rounded-2xl p-5 text-left text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-white/[0.02] focus-visible:ring-2 focus-visible:ring-[#00b8f5]/50 focus-visible:outline-none">
              Not sure which Mac you have?
              <ChevronDown
                aria-hidden
                className="size-4 flex-none text-white/50 transition-transform duration-200 group-data-[state=open]/disc:rotate-180"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-col gap-4 px-5 pb-5">
                <Separator className="bg-white/10" />
                <p className="text-[14.5px] leading-relaxed text-white/70">
                  Apple menu, top-left of the screen, then the <Ui>About This Mac</Ui>{' '}
                  item.
                </p>
                <dl className="grid gap-x-5 gap-y-2.5 text-[14.5px] leading-relaxed sm:grid-cols-[auto_1fr] sm:items-baseline">
                  <dt className="text-white/70">
                    It says <Ui>Chip</Ui> — Apple M1, M2, M3, M4
                  </dt>
                  <dd className="font-medium text-white">Apple Silicon</dd>
                  <dt className="text-white/70">
                    It says <Ui>Processor</Ui> — an Intel Core chip
                  </dt>
                  <dd className="font-medium text-white">Intel Mac</dd>
                </dl>
                <p className="text-[13.5px] leading-relaxed text-white/55">
                  The wrong build still installs, but it runs through Rosetta and
                  keeps updating itself to the wrong one.
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer className="mt-14 flex flex-col gap-4 sm:mt-20">
          <Separator className="bg-white/10" />
          <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-white/55 sm:flex-row sm:items-center sm:justify-between">
            <span>© 2026 Bluu Rock · Internal use only, not for distribution.</span>
            <span>
              Trouble installing?{' '}
              <a
                href={ISSUE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={FOOTER_LINK}
              >
                Log an issue
              </a>{' '}
              or{' '}
              <a
                href={CONTACT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={FOOTER_LINK}
              >
                message us
              </a>
              .
            </span>
          </div>
        </footer>
      </div>
    </main>
  );
}

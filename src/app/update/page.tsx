'use client';

/**
 * The update page — `/update`, public and unauthenticated (allowlisted in
 * `src/middleware.ts`). It is `/download` with the first-install work removed.
 *
 * **Why it exists.** `/download` serves two readers at once and has to guess
 * which one is in front of it, from a `localStorage` marker that a new browser,
 * cleared site data or a private window all erase. Guess wrong and a Windows
 * user who only wanted the newest `.exe` is handed a numbered certificate
 * sequence they completed months ago — and may re-run. `APP_UPDATE.downloadUrl`
 * points here instead, so the returning reader no longer has to be inferred:
 * the *route* says which one they are.
 *
 * So this page has **no certificate step and no walkthrough video** — both are
 * first-install work. What is left of the certificate is one line pointing at
 * `/download`, because the one reader who can still land here wrongly is someone
 * who followed an update link onto a machine that has never had the app.
 *
 * Deliberately **stateless**: no `localStorage`, no branching, nothing to get
 * wrong. Every reader sees the same page, which is the whole point of splitting
 * it off. Do not reintroduce the visit marker here.
 *
 * `/download` keeps its own two-reader logic — it is still the link handed to a
 * new hire, and still the page someone bookmarked last year.
 *
 * The Mac decision is kept, because it has the same wrong answer with the same
 * long tail on an update as on a first install: the x64 `.dmg` carries no arch
 * suffix, so an Apple Silicon user who takes it runs under Rosetta and keeps
 * taking x64 updates from then on. (macOS is never *sent* here — it updates
 * in-app — but a link that exists gets shared.)
 *
 * Skin: `../download/_lib/theme.ts` (DESIGN.md §9). Never inline a hex here.
 */

import { useState, useSyncExternalStore } from 'react';
import { IconBrandApple, IconBrandWindows } from '@tabler/icons-react';
import { Check, ChevronDown, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LATEST_RELEASE_LABEL } from '@/lib/latestRelease';
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
} from '../download/_lib/theme';

const WINDOWS_URL =
  'https://drive.google.com/drive/folders/1okTEpa0NXAenf0DJ3KaKjC_Dmscuugeg?usp=drive_link';
const MAC_INTEL_URL =
  'https://drive.google.com/drive/folders/1d9h2Yqx_TpWmnKblDS6Ah30ZQeWaW1FO?usp=drive_link';
const MAC_SILICON_URL =
  'https://drive.google.com/drive/folders/1nlWKZvcBo6VOzUb5LSqoYe5WeGe9MVi1?usp=sharing';
const ISSUE_URL = 'https://forms.gle/QPs5gjzvX5TPg2zLA';
const CONTACT_URL = 'https://t.me/KaiJN';

type Choice = 'windows' | 'mac-arm' | 'mac-intel';
type MacChoice = 'mac-arm' | 'mac-intel';

/* ── Platform ───────────────────────────────────────────────────────────── */

/** The detected OS cannot change mid-session, so there is nothing to subscribe to. */
const NEVER_CHANGES = () => () => {};

/** OS only. Chip architecture is not knowable from the user agent — asking is. */
function detectOs(): 'windows' | 'mac' | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(ua)) return 'mac';
  return null;
}

const PLATFORMS: {
  id: Choice;
  name: string;
  spec: string;
  Icon: typeof IconBrandWindows;
}[] = [
  {
    id: 'windows',
    name: 'Windows',
    spec: 'Windows 10 or 11 · 64-bit',
    Icon: IconBrandWindows,
  },
  // The names are deliberately short. "macOS · Apple Silicon" wrapped to two or
  // three lines between 640 and ~800px and left the row ragged; the Apple mark
  // beside it already says macOS, and the version floor belongs on the spec line.
  {
    id: 'mac-arm',
    name: 'Apple Silicon',
    spec: 'macOS 12+ · M1 and newer',
    Icon: IconBrandApple,
  },
  {
    id: 'mac-intel',
    name: 'Intel Mac',
    spec: 'macOS 12+ · before 2020',
    Icon: IconBrandApple,
  },
];

const MAC: Record<MacChoice, { url: string; cta: string; file: string }> = {
  'mac-arm': {
    url: MAC_SILICON_URL,
    cta: 'Download for Apple Silicon',
    file: '-arm64.dmg',
  },
  'mac-intel': {
    url: MAC_INTEL_URL,
    cta: 'Download for Intel Mac',
    file: 'Bluu Backend.dmg',
  },
};

/* ── Pieces ─────────────────────────────────────────────────────────────── */

/** Quotes a literal control in the OS's own dialogs and menus. */
function Ui({ children }: { children: React.ReactNode }) {
  return <span className={UI_CHIP}>{children}</span>;
}

/** Quotes a filename the reader has to recognise on disk. */
function FileName({ children }: { children: React.ReactNode }) {
  return <span className={FILE_CHIP}>{children}</span>;
}

/**
 * The one action on this page, per platform. Always filled — unlike `/download`
 * there is no second step here competing for the lead.
 */
function DownloadButton({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild className={PRIMARY_BTN} style={PRIMARY_BTN_STYLE}>
      <a href={href} target="_blank" rel="noopener noreferrer">
        <Download className="size-[18px]" aria-hidden />
        {label}
        <span className={BTN_VERSION}>{LATEST_RELEASE_LABEL}</span>
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

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function UpdatePage() {
  const detected = useSyncExternalStore(NEVER_CHANGES, detectOs, () => null);

  // An explicit pick always wins; until there is one the detected OS decides,
  // and Windows is the answer when nothing is known — it is the only platform
  // the update prompt sends here. A Mac preselects Apple Silicon.
  const [picked, setPicked] = useState<Choice | null>(null);
  const choice: Choice = picked ?? (detected === 'mac' ? 'mac-arm' : 'windows');

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
            Update Bluu Backend
          </h1>
        </header>

        {/* ── The install panel ──────────────────────────────────────────── */}
        <section className={cn('rounded-2xl p-5 sm:p-7', PANEL)}>
          <Tabs value={choice} onValueChange={(v) => setPicked(v as Choice)} className="gap-6">
            <TabsList
              aria-label="Choose your platform"
              className="grid h-auto! w-full grid-cols-1 gap-2 bg-transparent p-0 md:grid-cols-3"
            >
              {PLATFORMS.map((p) => (
                <TabsTrigger key={p.id} value={p.id} className={OPTION}>
                  <Check
                    aria-hidden
                    className="absolute top-3.5 right-3.5 size-4 text-[#00b8f5] opacity-0 transition-opacity duration-150 group-data-[state=active]/opt:opacity-100"
                  />
                  <span className="flex items-center gap-2 pr-6 text-[15px] font-semibold text-white">
                    <p.Icon
                      aria-hidden
                      className="size-[18px] flex-none text-white/45 transition-colors duration-150 group-data-[state=active]/opt:text-[#00b8f5]"
                    />
                    {p.name}
                  </span>
                  <span className="text-[12.5px] leading-snug text-white/55">{p.spec}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            {/* ── Windows ────────────────────────────────────────────────── */}
            <TabsContent value="windows" className={cn('flex flex-col gap-5', TAB_PANEL)}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <DownloadButton href={WINDOWS_URL} label="Download for Windows" />
                <p className="text-[13px] leading-relaxed text-white/55">
                  Take the newest <FileName>.exe</FileName> in the folder and run it.
                  If Windows warns you, choose <Ui>More info</Ui> and then{' '}
                  <Ui>Run anyway</Ui>
                </p>
              </div>

              {/* The only trace of the certificate left on this page. Someone
                  updating has already done it and must not be sent back through
                  it; someone who has not is one click from the page that still
                  runs the full sequence. A plain <a>, not <Link> — the real load
                  is what lets `/download` read its visit marker fresh instead of
                  inheriting this render. */}
              <p className="border-t border-white/[0.08] pt-5 text-[13.5px] leading-relaxed text-white/55">
                Installing Bluu Backend for the first time?{' '}
                <a href="/download" className={INLINE_LINK}>
                  Install the certificate first.
                </a>
              </p>
            </TabsContent>

            {/* ── macOS ──────────────────────────────────────────────────── */}
            {(Object.keys(MAC) as MacChoice[]).map((id) => (
              <TabsContent key={id} value={id} className={cn('flex flex-col gap-5', TAB_PANEL)}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                  <DownloadButton href={MAC[id].url} label={MAC[id].cta} />
                  <p className="text-[13px] leading-relaxed text-white/55">
                    Take <FileName>{MAC[id].file}</FileName>, then drag it into
                    Applications
                  </p>
                </div>
              </TabsContent>
            ))}
          </Tabs>

          {/* The picker is a client control. Without scripting the tabs cannot be
              switched, so every installer has to stay reachable as plain links or
              a Mac visitor is stranded on the Windows default. */}
          <noscript>
            <div className="mt-6 flex flex-col gap-2 border-t border-white/10 pt-5 text-[14px] text-white/70">
              {PLATFORMS.map((p) => (
                <a
                  key={p.id}
                  href={p.id === 'windows' ? WINDOWS_URL : MAC[p.id as MacChoice].url}
                  className={INLINE_LINK}
                >
                  {p.name}
                </a>
              ))}
              <a href="/download" className={INLINE_LINK}>
                First install on this machine — start here
              </a>
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

'use client';

/**
 * The installer page — `/download`, public and unauthenticated (allowlisted in
 * `src/middleware.ts`). Two readers, one page:
 *
 * ▸ **A new colleague**, on a machine with no app on it, who has to pick the
 *   right file and — on Windows — trust a certificate first. Their whole job is
 *   a choice they can get wrong, so the choice is the page.
 * ▸ **A Windows user reinstalling for an update** (`APP_UPDATE.downloadUrl`
 *   points here; macOS updates in-app and is never sent to this page). They
 *   already own the certificate and want the `.exe` in one click.
 *
 * The platform picker is preselected from the user agent, which resolves the
 * first reader's choice for them and costs the second nothing. It is a picker
 * and not three buttons because the Mac decision has a wrong answer with a long
 * tail: the x64 `.dmg` carries no arch suffix, so an Apple Silicon user who
 * takes it runs under Rosetta and keeps taking x64 updates from then on. That
 * is what "Not sure which Mac you have?" is for, and why it sits beside the
 * button rather than in a support doc.
 *
 * Skin: `_lib/theme.ts` (DESIGN.md §9). Never inline a hex here.
 */

import { useState, useSyncExternalStore } from 'react';
import { IconBrandApple, IconBrandWindows } from '@tabler/icons-react';
import { Check, ChevronDown, Download, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  BENCH_GROUND,
  FILE_CHIP,
  FOOTER_LINK,
  INLINE_LINK,
  OPTION,
  PANEL,
  PRIMARY_BTN,
  PRIMARY_BTN_STYLE,
  SECONDARY_BTN,
  UI_CHIP,
} from './_lib/theme';

const WINDOWS_URL =
  'https://drive.google.com/drive/folders/1okTEpa0NXAenf0DJ3KaKjC_Dmscuugeg?usp=drive_link';
const MAC_INTEL_URL =
  'https://drive.google.com/drive/folders/1d9h2Yqx_TpWmnKblDS6Ah30ZQeWaW1FO?usp=drive_link';
const MAC_SILICON_URL =
  'https://drive.google.com/drive/folders/1nlWKZvcBo6VOzUb5LSqoYe5WeGe9MVi1?usp=sharing';
const CERT_URL =
  'https://drive.google.com/drive/folders/1xfop4q-G6m3zigYLqGAVhvWCJRIigZXX?usp=drive_link';
const WALKTHROUGH_URL = 'https://youtu.be/7LrNBZZC6tQ?si=rqXoDe2MJcDBbjhQ';
const ISSUE_URL = 'https://forms.gle/QPs5gjzvX5TPg2zLA';
const CONTACT_URL = 'https://t.me/KaiJN';

type Choice = 'windows' | 'mac-arm' | 'mac-intel';

/** Quotes a literal control in Windows' own dialogs. */
function Ui({ children }: { children: React.ReactNode }) {
  return <span className={UI_CHIP}>{children}</span>;
}

/** Quotes a filename the reader has to recognise on disk. */
function FileName({ children }: { children: React.ReactNode }) {
  return <span className={FILE_CHIP}>{children}</span>;
}

function StepNumber({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-full bg-[#00b8f5]/15 text-[13px] font-semibold text-[#00b8f5] tabular-nums"
    >
      {n}
    </span>
  );
}

const PLATFORMS: {
  id: Choice;
  name: string;
  spec: string;
  url: string;
  cta: string;
  blurb: React.ReactNode;
  fileHint: React.ReactNode;
  Icon: typeof IconBrandWindows;
}[] = [
  {
    id: 'windows',
    name: 'Windows',
    spec: 'Windows 10 or 11 · 64-bit',
    url: WINDOWS_URL,
    cta: 'Download for Windows',
    Icon: IconBrandWindows,
    blurb: (
      <>
        Opens the shared Drive folder — take the newest <FileName>.exe</FileName> inside.
        Your first install on a machine also needs the certificate step below.
      </>
    ),
    fileHint: (
      <>
        Named <FileName>Bluu Backend Setup.exe</FileName>
      </>
    ),
  },
  {
    id: 'mac-arm',
    name: 'macOS · Apple Silicon',
    spec: 'M1 or newer · 2020 and later',
    url: MAC_SILICON_URL,
    cta: 'Download for Apple Silicon',
    Icon: IconBrandApple,
    blurb: (
      <>
        Opens the shared Drive folder — take the newest <FileName>.dmg</FileName> inside,
        then drag Bluu Backend into Applications. Updates install themselves from
        there; you should not need this page again.
      </>
    ),
    fileHint: (
      <>
        The right file ends in <FileName>-arm64.dmg</FileName>
      </>
    ),
  },
  {
    id: 'mac-intel',
    name: 'macOS · Intel',
    spec: 'Intel processor · before 2020',
    url: MAC_INTEL_URL,
    cta: 'Download for Intel Mac',
    Icon: IconBrandApple,
    blurb: (
      <>
        Opens the shared Drive folder — take the newest <FileName>.dmg</FileName> inside,
        then drag Bluu Backend into Applications. Updates install themselves from
        there; you should not need this page again.
      </>
    ),
    fileHint: (
      <>
        The Intel build carries no chip in its name — <FileName>Bluu Backend.dmg</FileName>
      </>
    ),
  },
];

/** OS only. Chip architecture is not knowable from the user agent — asking is. */
function detectOs(): 'windows' | 'mac' | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(ua)) return 'mac';
  return null;
}

/**
 * Detection read through `useSyncExternalStore` rather than an effect, so the
 * server and the hydrating client agree on `null` and the real answer arrives
 * in React's own re-render — no `setState` in an effect, no hydration mismatch.
 * The user agent never changes under us, so the subscription is a no-op.
 */
const NEVER_CHANGES = () => () => {};

export default function DownloadPage() {
  const detected = useSyncExternalStore(NEVER_CHANGES, detectOs, () => null);

  // An explicit pick always wins; until there is one the detected OS decides,
  // and Windows is the answer when nothing is known. A Mac is preselected to
  // Apple Silicon because that is the safer wrong guess — see the file header.
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
        <header className="flex flex-col gap-7 pt-10 pb-9 sm:pt-14 sm:pb-11">
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
          <div className="flex flex-col gap-3">
            <h1 className="text-[2rem] leading-[1.1] font-semibold tracking-[-0.02em] text-balance sm:text-[2.5rem]">
              Download Bluu Backend
            </h1>
            <p className="max-w-[56ch] text-[15px] leading-relaxed text-white/60 text-pretty sm:text-base">
              The desktop app is under active internal development, so installers
              and setup steps change often. Check this page before every install.
            </p>
          </div>
        </header>

        {/* ── The install panel ──────────────────────────────────────────── */}
        <section className={cn('rounded-2xl p-5 sm:p-7', PANEL)}>
          {/* Height reserved so the detection line cannot shift the panel when
              it resolves a frame after hydration. */}
          <p
            aria-live="polite"
            className="flex min-h-5 items-center text-[13.5px] text-white/55"
          >
            {detected === 'windows' && 'You appear to be on Windows — this is the one you need.'}
            {detected === 'mac' && 'You appear to be on a Mac. Pick the chip yours uses — there is a way to check below.'}
          </p>

          <Tabs
            value={choice}
            onValueChange={(v) => setPicked(v as Choice)}
            className="mt-4 gap-6"
          >
            <TabsList
              aria-label="Choose your platform"
              className="grid h-auto! w-full grid-cols-1 gap-2 bg-transparent p-0 sm:grid-cols-3"
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
                  <span className="text-[12.5px] leading-snug text-white/55">
                    {p.spec}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>

            {PLATFORMS.map((p) => (
              <TabsContent
                key={p.id}
                value={p.id}
                className="flex flex-col gap-5 data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-1 data-[state=active]:duration-200 motion-reduce:animate-none"
              >
                <p className="max-w-[60ch] text-[15px] leading-relaxed text-white/70">
                  {p.blurb}
                </p>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                  <Button asChild className={PRIMARY_BTN} style={PRIMARY_BTN_STYLE}>
                    <a href={p.url} target="_blank" rel="noopener noreferrer">
                      <Download className="size-[18px]" aria-hidden />
                      {p.cta}
                    </a>
                  </Button>
                  <p className="text-[13px] leading-relaxed text-white/55">
                    {p.fileHint}
                  </p>
                </div>
              </TabsContent>
            ))}
          </Tabs>

          {/* The picker is a client control. Without scripting the tabs cannot
              be switched, so every installer has to stay reachable as plain
              links or a Mac visitor is stranded on the Windows default. */}
          <noscript>
            <div className="mt-6 flex flex-col gap-2 border-t border-white/10 pt-5 text-[14px] text-white/70">
              <p>All installers:</p>
              {PLATFORMS.map((p) => (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={INLINE_LINK}
                >
                  {p.name}
                </a>
              ))}
            </div>
          </noscript>
        </section>

        {/* ── Which Mac? (macOS only) ────────────────────────────────────── */}
        {isMac && (
          <Collapsible className={cn('mt-5 rounded-2xl', PANEL)}>
            <CollapsibleTrigger className="group/disc flex w-full items-center justify-between gap-4 rounded-2xl p-5 text-left transition-colors duration-150 hover:bg-white/[0.02] focus-visible:ring-2 focus-visible:ring-[#00b8f5]/50 focus-visible:outline-none sm:p-6">
              <span className="flex flex-col gap-1">
                <span className="text-[15px] font-semibold text-white">
                  Not sure which Mac you have?
                </span>
                <span className="text-[13px] text-white/55">
                  Thirty seconds, and it decides which file you need.
                </span>
              </span>
              <ChevronDown
                aria-hidden
                className="size-4 flex-none text-white/50 transition-transform duration-200 group-data-[state=open]/disc:rotate-180"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-col gap-4 px-5 pb-5 sm:px-6 sm:pb-6">
                <Separator className="bg-white/10" />
                <p className="text-[14.5px] leading-relaxed text-white/70">
                  Open the Apple menu in the top-left corner of the screen and
                  choose the <Ui>About This Mac</Ui> item.
                </p>
                <dl className="grid gap-x-5 gap-y-2.5 text-[14.5px] leading-relaxed sm:grid-cols-[auto_1fr] sm:items-baseline">
                  <dt className="text-white/70">
                    It says <Ui>Chip</Ui> — Apple M1, M2, M3, M4
                  </dt>
                  <dd className="font-medium text-white">
                    Choose macOS · Apple Silicon
                  </dd>
                  <dt className="text-white/70">
                    It says <Ui>Processor</Ui> — an Intel Core chip
                  </dt>
                  <dd className="font-medium text-white">Choose macOS · Intel</dd>
                </dl>
                <p className="text-[13.5px] leading-relaxed text-white/55">
                  Worth the check: the wrong build still installs, but it runs
                  through Rosetta and keeps updating itself to the wrong one.
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* ── Windows first-time setup (Windows only) ────────────────────── */}
        {!isMac && (
          <section className="mt-12 flex flex-col gap-6 sm:mt-14">
            <div className="flex flex-col gap-2.5">
              <h2 className="text-xl font-semibold tracking-[-0.01em] text-white sm:text-[1.375rem]">
                First install on Windows
              </h2>
              <p className="max-w-[62ch] text-[15px] leading-relaxed text-white/60">
                Bluu Backend is signed with our own certificate, so Windows blocks
                it until that certificate is trusted. Two steps, once per machine.
              </p>
              <p className="max-w-[62ch] text-[14px] leading-relaxed text-white/55">
                <span className="font-semibold text-[#00b8f5]">Updating?</span> If
                you have installed <FileName>InternalCert.cer</FileName> on this machine
                before, go straight to step 2.
              </p>
            </div>

            <ol className="flex flex-col gap-7">
              <li className="flex gap-4">
                <StepNumber n={1} />
                <div className="flex flex-col gap-3 pt-0.5">
                  <h3 className="text-[15px] font-semibold text-white">
                    Trust the certificate
                  </h3>
                  <p className="text-[14.5px] leading-relaxed text-white/70">
                    Download <FileName>InternalCert.cer</FileName> from{' '}
                    <a
                      href={CERT_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={INLINE_LINK}
                    >
                      the certificate folder
                    </a>
                    , then:
                  </p>
                  <ol className="flex list-decimal flex-col gap-2 pl-5 text-[14.5px] leading-relaxed text-white/70 marker:text-white/40 marker:tabular-nums">
                    <li>
                      Double-click <FileName>InternalCert.cer</FileName>
                    </li>
                    <li>
                      Click <Ui>Install Certificate…</Ui>
                    </li>
                    <li>
                      Select <Ui>Local Machine</Ui> and click <Ui>Next</Ui>
                    </li>
                    <li>
                      Select <Ui>Place all certificates in the following store</Ui>
                    </li>
                    <li>
                      Click <Ui>Browse</Ui> and choose{' '}
                      <Ui>Trusted Root Certification Authorities</Ui>
                    </li>
                    <li>
                      Click <Ui>OK</Ui> to close the picker, then <Ui>Next</Ui> and{' '}
                      <Ui>Finish</Ui>
                    </li>
                  </ol>
                </div>
              </li>

              <li className="flex gap-4">
                <StepNumber n={2} />
                <div className="flex flex-col gap-3 pt-0.5">
                  <h3 className="text-[15px] font-semibold text-white">
                    Run the installer
                  </h3>
                  <p className="max-w-[62ch] text-[14.5px] leading-relaxed text-white/70">
                    Open the <FileName>.exe</FileName> you downloaded above. If Windows
                    still warns you, choose <Ui>More info</Ui> and then{' '}
                    <Ui>Run anyway</Ui>
                  </p>
                </div>
              </li>
            </ol>

            <Button asChild variant="outline" className={SECONDARY_BTN}>
              <a href={WALKTHROUGH_URL} target="_blank" rel="noopener noreferrer">
                <Play className="size-4 fill-current" aria-hidden />
                Watch the walkthrough
              </a>
            </Button>
          </section>
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

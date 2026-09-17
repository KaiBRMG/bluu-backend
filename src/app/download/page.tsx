'use client';

/**
 * The installer page — `/download`, public and unauthenticated (allowlisted in
 * `src/middleware.ts`). Two readers, and the page has to tell them apart:
 *
 * ▸ **A first install on this machine.** On Windows the certificate is not a
 *   footnote to the download, it is the thing that has to happen *first* — the
 *   `.exe` will not run without it. So the Windows panel is a numbered sequence
 *   with its own download button per step, and step 1 holds the filled button
 *   until the certificate has been taken.
 * ▸ **A returning visitor**, who is almost always a Windows user reinstalling
 *   for an update (`APP_UPDATE.downloadUrl` points here; macOS updates in-app
 *   and is never sent to this page). They already trust the certificate and want
 *   the `.exe`, so it leads and the certificate drops to one line.
 *
 * **Which of the two is decided by a `localStorage` marker**, read through
 * `useSyncExternalStore` so the server and the hydrating client agree, and
 * **frozen for the session** (`readVisit` caches) so the layout cannot rearrange
 * itself under someone mid-read. The marker records two separate facts — that
 * the page has been seen, and that the certificate was actually downloaded here
 * — because a visitor who looked once and left has *not* done the crucial step,
 * and demoting it for them would be the one failure this flow exists to prevent.
 * The certificate is therefore never hidden, only folded: "Installing on a new
 * machine?" reopens the full sequence.
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
import { Check, ChevronDown, Download, Play } from 'lucide-react';
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
  SECONDARY_BTN,
  STEP_BTN_QUIET,
  STEP_MARK,
  STEP_MARK_CURRENT,
  STEP_MARK_DONE,
  STEP_MARK_UPCOMING,
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
type MacChoice = 'mac-arm' | 'mac-intel';

/* ── Device memory ──────────────────────────────────────────────────────────
   One key, two facts. `seen` alone is a visitor who has been here before but
   never took the certificate — still a first-timer as far as the flow is
   concerned. `cert` is the only one that demotes step 1. */

const VISIT_KEY = 'bluu.download.visit.v1';

/** Frozen on first read so the layout cannot rearrange itself mid-session. */
let visitSnapshot: string | null = null;

function readVisit(): string {
  if (visitSnapshot === null) {
    try {
      visitSnapshot = localStorage.getItem(VISIT_KEY) ?? '';
    } catch {
      // Private windows and blocked site data throw on access. A reader we
      // cannot remember is treated as new, which shows the certificate — the
      // safe way to be wrong.
      visitSnapshot = '';
    }
  }
  return visitSnapshot;
}

/** The marker never changes during a session, so there is nothing to subscribe to. */
const NEVER_CHANGES = () => () => {};

function markVisit(value: string) {
  try {
    const current = localStorage.getItem(VISIT_KEY) ?? '';
    if (current.includes(value)) return;
    localStorage.setItem(VISIT_KEY, current ? `${current} ${value}` : value);
  } catch {
    /* Nothing to do — the next visit is simply treated as a first one. */
  }
}

/* ── Platform ───────────────────────────────────────────────────────────── */

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

/** Quotes a literal control in Windows' own dialogs. */
function Ui({ children }: { children: React.ReactNode }) {
  return <span className={UI_CHIP}>{children}</span>;
}

/** Quotes a filename the reader has to recognise on disk. */
function FileName({ children }: { children: React.ReactNode }) {
  return <span className={FILE_CHIP}>{children}</span>;
}

/**
 * Where the reader is in the sequence. Three states, not two — an upcoming step
 * wearing the current step's fill is the page contradicting its own ordering.
 */
function StepMark({ n, state }: { n: number; state: 'done' | 'current' | 'upcoming' }) {
  return (
    <span
      aria-hidden
      className={cn(
        STEP_MARK,
        state === 'done'
          ? STEP_MARK_DONE
          : state === 'current'
            ? STEP_MARK_CURRENT
            : STEP_MARK_UPCOMING,
      )}
    >
      {state === 'done' ? <Check className="size-4" strokeWidth={3} /> : n}
    </span>
  );
}

/** A download button. `lead` is the filled one — the step the reader is on. */
function DownloadButton({
  href,
  label,
  version,
  lead,
  onClick,
}: {
  href: string;
  label: string;
  version?: boolean;
  lead: boolean;
  onClick?: () => void;
}) {
  return (
    <Button
      asChild
      className={lead ? PRIMARY_BTN : STEP_BTN_QUIET}
      style={lead ? PRIMARY_BTN_STYLE : undefined}
    >
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        <Download className="size-[18px]" aria-hidden />
        {label}
        {version && <span className={BTN_VERSION}>{LATEST_RELEASE_LABEL}</span>}
      </a>
    </Button>
  );
}

/** The six clicks inside Windows' own certificate dialog. */
function CertificateSteps() {
  return (
    <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[14px] leading-relaxed text-white/70 marker:tabular-nums marker:text-white/40">
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
        Click <Ui>Browse</Ui> and choose <Ui>Trusted Root Certification Authorities</Ui>
      </li>
      <li>
        Click <Ui>OK</Ui> to close the picker, then <Ui>Next</Ui> and <Ui>Finish</Ui>
      </li>
    </ol>
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

export default function DownloadPage() {
  const detected = useSyncExternalStore(NEVER_CHANGES, detectOs, () => null);
  const visit = useSyncExternalStore(NEVER_CHANGES, readVisit, () => '');

  // An explicit pick always wins; until there is one the detected OS decides,
  // and Windows is the answer when nothing is known. A Mac preselects Apple
  // Silicon because that is the safer wrong guess — see the file header.
  const [picked, setPicked] = useState<Choice | null>(null);
  const choice: Choice = picked ?? (detected === 'mac' ? 'mac-arm' : 'windows');

  // Taking the certificate in *this* session moves the filled button to step 2,
  // so the page follows the reader through the sequence rather than describing
  // it. Separate from the frozen snapshot, which decides the layout.
  const [certTaken, setCertTaken] = useState(false);
  const returning = visit.includes('cert');
  const certDone = returning || certTaken;

  useEffect(() => {
    markVisit('seen');
  }, []);

  const takeCertificate = () => {
    markVisit('cert');
    setCertTaken(true);
  };

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
            <TabsContent value="windows" className={cn('flex flex-col', TAB_PANEL)}>
              {returning ? (
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <DownloadButton
                      href={WINDOWS_URL}
                      label="Download for Windows"
                      version
                      lead
                    />
                    <p className="text-[13px] leading-relaxed text-white/55">
                      Take the newest <FileName>.exe</FileName> in the folder
                    </p>
                  </div>

                  <Collapsible className="rounded-xl border border-white/[0.08]">
                    <CollapsibleTrigger className="group/cert flex w-full items-center justify-between gap-4 rounded-xl px-4 py-3 text-left text-[14px] font-medium text-white/70 transition-colors duration-150 hover:text-white focus-visible:ring-2 focus-visible:ring-[#00b8f5]/50 focus-visible:outline-none">
                      Installing on a new machine? Set up the certificate first
                      <ChevronDown
                        aria-hidden
                        className="size-4 flex-none text-white/50 transition-transform duration-200 group-data-[state=open]/cert:rotate-180"
                      />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
                        <DownloadButton
                          href={CERT_URL}
                          label="Download certificate"
                          lead
                          onClick={takeCertificate}
                        />
                        <CertificateSteps />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              ) : (
                <ol className="flex flex-col">
                  {/* Step 1 — the certificate. The .exe will not run without it,
                      so it holds the filled button until it has been taken. */}
                  <li className="flex gap-4">
                    <StepMark n={1} state={certDone ? 'done' : 'current'} />
                    <div className="flex flex-col gap-3.5 pb-7">
                      <div className="flex flex-col gap-1 pt-0.5">
                        <h2 className="text-[15px] font-semibold text-white">
                          Install the certificate first
                        </h2>
                        <p className="text-[14px] leading-relaxed text-white/60">
                          Windows blocks the app until this is trusted. Once per
                          machine.
                        </p>
                      </div>
                      <DownloadButton
                        href={CERT_URL}
                        label="Download certificate"
                        lead={!certDone}
                        onClick={takeCertificate}
                      />
                      <CertificateSteps />
                    </div>
                  </li>

                  <li className="flex gap-4 border-t border-white/[0.08] pt-7">
                    <StepMark n={2} state={certDone ? 'current' : 'upcoming'} />
                    <div className="flex flex-col gap-3.5">
                      <div className="flex flex-col gap-1 pt-0.5">
                        <h2 className="text-[15px] font-semibold text-white">
                          Install the app
                        </h2>
                        <p className="text-[14px] leading-relaxed text-white/60">
                          Take the newest <FileName>.exe</FileName> in the folder and
                          run it. If Windows warns you, choose <Ui>More info</Ui> and
                          then <Ui>Run anyway</Ui>
                        </p>
                      </div>
                      <DownloadButton
                        href={WINDOWS_URL}
                        label="Download for Windows"
                        version
                        lead={certDone}
                      />
                    </div>
                  </li>
                </ol>
              )}
            </TabsContent>

            {/* ── macOS ──────────────────────────────────────────────────── */}
            {(Object.keys(MAC) as MacChoice[]).map((id) => (
              <TabsContent key={id} value={id} className={cn('flex flex-col gap-5', TAB_PANEL)}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                  <DownloadButton href={MAC[id].url} label={MAC[id].cta} version lead />
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
              <a href={CERT_URL} className={INLINE_LINK}>
                Windows certificate — install this first
              </a>
              {PLATFORMS.map((p) => (
                <a
                  key={p.id}
                  href={p.id === 'windows' ? WINDOWS_URL : MAC[p.id as MacChoice].url}
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

        {/* ── Walkthrough (Windows only) ─────────────────────────────────── */}
        {!isMac && (
          <Button asChild variant="outline" className={cn('mt-6', SECONDARY_BTN)}>
            <a href={WALKTHROUGH_URL} target="_blank" rel="noopener noreferrer">
              <Play className="size-4 fill-current" aria-hidden />
              Watch the walkthrough
            </a>
          </Button>
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

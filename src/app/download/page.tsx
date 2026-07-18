"use client";

import { useState } from "react";
import { Apple, ChevronDown, Info, Monitor, Play } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const ACCENT = "#29B6F6";

const WINDOWS_URL =
  "https://drive.google.com/drive/folders/1okTEpa0NXAenf0DJ3KaKjC_Dmscuugeg?usp=drive_link";
const MAC_INTEL_URL =
  "https://drive.google.com/drive/folders/1d9h2Yqx_TpWmnKblDS6Ah30ZQeWaW1FO?usp=drive_link";
const MAC_SILICON_URL =
  "https://drive.google.com/drive/folders/1nlWKZvcBo6VOzUb5LSqoYe5WeGe9MVi1?usp=sharing";
const WALKTHROUGH_URL = "https://youtu.be/7LrNBZZC6tQ?si=rqXoDe2MJcDBbjhQ";

/** A one-time-install certificate step index. */
function StepNumber({ n }: { n: number }) {
  return (
    <span className="mt-px flex size-6 flex-none items-center justify-center rounded-full bg-[#29B6F6]/15 text-[12px] font-semibold text-[#29B6F6] tabular-nums">
      {n}
    </span>
  );
}

/** Emphasises a literal on-screen label the user must click or find. */
function Ui({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-white/[0.07] px-1 py-0.5 text-[12.5px] font-medium text-foreground/90">
      {children}
    </span>
  );
}

export default function DownloadPage() {
  const [setupOpen, setSetupOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#0a0b0c] px-6 pb-20 pt-12 text-foreground">
      <div className="mx-auto flex max-w-[920px] flex-col gap-12">
        <header className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo/bluu_long.svg" alt="Bluu Rock" className="h-8 w-auto" />
        </header>

        <section className="flex flex-col gap-5">
          <div className="flex flex-col gap-2.5">
            <h1 className="m-0 text-[clamp(32px,4vw,44px)] font-semibold tracking-tight text-balance">
              Download Bluu Backend
            </h1>
            <p className="m-0 max-w-[60ch] text-base leading-relaxed text-muted-foreground text-pretty">
              Choose your platform below. Bluu Backend is under active internal
              development — installers and instructions may change often, so
              check this page before each install.
            </p>
          </div>

          <Alert className="flex items-start gap-3 border-[#29B6F6]/35 bg-[#29B6F6]/10">
            <span
              className="mt-0.5 flex size-5 flex-none items-center justify-center rounded-full text-xs font-bold text-[#04121a]"
              style={{ background: ACCENT }}
            >
              <Info className="size-3" strokeWidth={3} />
            </span>
            <AlertDescription className="text-sm leading-relaxed text-foreground/85">
              <p>
                All links below open a company Google Drive folder. You must be
                signed in to Google with your{" "}
                <strong style={{ color: ACCENT }}>@bluurock.com</strong> email to
                access them — if you see an access-denied page, switch Google
                accounts and try again.
              </p>
            </AlertDescription>
          </Alert>
        </section>

        <section className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] items-stretch gap-5">
          {/* Windows */}
          <Card className="gap-4 rounded-2xl border-white/10 bg-[#111214] p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-[10px] bg-white/[0.06] text-foreground/85">
                <Monitor className="size-5" />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-base font-semibold">Windows</span>
                <span className="text-[12.5px] text-muted-foreground">
                  Win 10 / 11 · 64-bit · .exe
                </span>
              </div>
            </div>

            <Button
              asChild
              className="w-full rounded-[9px] text-[#04121a] transition hover:brightness-110"
              style={{ background: ACCENT }}
            >
              <a href={WINDOWS_URL} target="_blank" rel="noopener noreferrer">
                Download for Windows
              </a>
            </Button>

            <p className="m-0 mt-auto text-[12.5px] leading-relaxed text-muted-foreground">
              First-time install needs a one-time certificate. Follow the{" "}
              <button
                type="button"
                onClick={() => setSetupOpen(true)}
                className="font-medium underline underline-offset-2 hover:text-foreground"
                style={{ color: ACCENT }}
              >
                Windows setup
              </button>{" "}
              steps below.
            </p>
          </Card>

          {/* macOS Intel */}
          <Card className="gap-4 rounded-2xl border-white/10 bg-[#111214] p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-[10px] bg-white/[0.06] text-foreground/85">
                <Apple className="size-5" />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-base font-semibold">macOS (Intel)</span>
                <span className="text-[12.5px] text-muted-foreground">
                  macOS 12+ · .dmg
                </span>
              </div>
            </div>

            <Button
              asChild
              className="w-full rounded-[9px] text-[#04121a] transition hover:brightness-110"
              style={{ background: ACCENT }}
            >
              <a href={MAC_INTEL_URL} target="_blank" rel="noopener noreferrer">
                Download for Intel Mac
              </a>
            </Button>

            <p className="m-0 mt-auto text-[12.5px] leading-relaxed text-muted-foreground">
              For MacBooks and iMacs with an Intel processor — most models
              before 2020.
            </p>
          </Card>

          {/* macOS Apple Silicon */}
          <Card className="gap-4 rounded-2xl border-white/10 bg-[#111214] p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-[10px] bg-white/[0.06] text-foreground/85">
                <Apple className="size-5" />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-base font-semibold">
                  macOS (Apple Silicon)
                </span>
                <span className="text-[12.5px] text-muted-foreground">
                  M1+ · arm64 · .dmg
                </span>
              </div>
            </div>

            <Button
              asChild
              className="w-full rounded-[9px] text-[#04121a] transition hover:brightness-110"
              style={{ background: ACCENT }}
            >
              <a href={MAC_SILICON_URL} target="_blank" rel="noopener noreferrer">
                Download for Apple Silicon
              </a>
            </Button>

            <p className="m-0 mt-auto text-[12.5px] leading-relaxed text-muted-foreground">
              For MacBooks, Mac minis and iMacs with an M-series chip — 2020 or
              later.
            </p>
          </Card>
        </section>

        {/* Windows-only first-time setup */}
        <Collapsible
          open={setupOpen}
          onOpenChange={setSetupOpen}
          className="rounded-2xl border border-white/10 bg-[#111214]"
        >
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-6 text-left">
            <span className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-[10px] bg-white/[0.06] text-foreground/85">
                <Monitor className="size-5" />
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-base font-semibold">
                  Windows first-time setup
                </span>
                <span className="text-[12.5px] text-muted-foreground">
                  One-time certificate install — read before installing
                </span>
              </span>
            </span>
            <span className="flex flex-none items-center gap-3">
              <Badge
                variant="outline"
                className="border-[#29B6F6]/40 text-[11px] font-medium"
                style={{ color: ACCENT }}
              >
                required
              </Badge>
              <ChevronDown
                className={`size-4 text-muted-foreground transition-transform duration-200 ${
                  setupOpen ? "rotate-180" : ""
                }`}
              />
            </span>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="flex flex-col gap-5 px-6 pb-6 text-[13.5px] leading-relaxed text-muted-foreground">
              <Separator className="bg-white/10" />

              <p className="m-0 font-medium text-foreground/85">
                Bluu Backend is still in development, so Windows may block the
                install. These two steps let it through.
              </p>

              <div className="flex gap-3.5">
                <StepNumber n={1} />
                <div className="flex flex-col gap-2.5">
                  <p className="m-0 font-semibold text-foreground/90">
                    Install <Ui>InternalCert.cer</Ui> from the Google Drive
                    folder.
                  </p>
                  <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 marker:text-muted-foreground/60">
                    <li>
                      Double-click <Ui>InternalCert.cer</Ui>.
                    </li>
                    <li>
                      Click <Ui>Install Certificate…</Ui>
                    </li>
                    <li>
                      Select <Ui>Local Machine</Ui> and click <Ui>Next</Ui>.
                    </li>
                    <li>
                      Select <Ui>Place all certificates in the following store</Ui>.
                    </li>
                    <li>
                      Click <Ui>Browse</Ui> and select{" "}
                      <Ui>Trusted Root Certification Authorities</Ui>.
                    </li>
                    <li>
                      Click <Ui>OK</Ui>, then <Ui>Next</Ui>, then{" "}
                      <Ui>Finish</Ui>.
                    </li>
                  </ol>
                </div>
              </div>

              <div className="flex gap-3.5">
                <StepNumber n={2} />
                <p className="m-0 self-center font-semibold text-foreground/90">
                  Download and install the .exe file from the Google Drive
                  folder.
                </p>
              </div>

              <div className="flex gap-2.5 rounded-[9px] border border-white/10 bg-white/[0.05] px-3.5 py-3">
                <span className="flex-none font-bold" style={{ color: ACCENT }}>
                  Note
                </span>
                <p className="m-0">
                  If you are updating and have already installed{" "}
                  <Ui>InternalCert.cer</Ui>, you do not need to install it again
                  — skip straight to step 2.
                </p>
              </div>

              <Button
                asChild
                variant="outline"
                className="w-fit rounded-[9px] border-[#29B6F6]/40 text-[13.5px] font-semibold transition hover:bg-[#29B6F6]/10"
                style={{ color: ACCENT }}
              >
                <a href={WALKTHROUGH_URL} target="_blank" rel="noopener noreferrer">
                  <Play className="size-4 fill-current" />
                  Watch the walkthrough video
                </a>
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <footer className="flex flex-col gap-4">
          <Separator className="bg-white/10" />
          <div className="flex flex-wrap justify-between gap-2 text-[12.5px] text-muted-foreground">
            <span>
              © 2026 Bluu Rock · For internal use only, not for distribution.
            </span>
            <span>
              Trouble installing? Please{" "}
              <a
                href="https://forms.gle/QPs5gjzvX5TPg2zLA"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                log an issue
              </a>{" "}
              or{" "}
              <a
                href="https://t.me/KaiJN"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                contact us
              </a>
              .
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}

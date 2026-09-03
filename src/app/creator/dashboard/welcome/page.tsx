"use client";

import {
  CalendarCheck,
  ExternalLink,
  FolderOpen,
  ImagePlay,
  Rocket,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ACCENT_BTN, COLOR, FOCUS_RING, PAGE_GROUND_STYLE, SURFACE } from "../../theme";
import { PortalHeader } from "../../components/PortalHeader";

/**
 * The welcome guide — the one screen a creator reads once rather than daily.
 *
 * It is the reference half of the portal, so it is the one place that may run
 * as prose. Everything it explains is explained *in terms of the interface she
 * will actually see*: the axis, the tick, the countdown. A guide that describes
 * a different product than the one on screen is worse than no guide.
 */

const CONTENT_EXAMPLES_URL =
  "https://drive.google.com/drive/folders/1vR1GwiJ9VV_312ZJpdol6MhRcodJ9XIR?usp=drive_link";

export default function WelcomePage() {
  return (
    <div className="min-h-dvh" style={PAGE_GROUND_STYLE}>
      <PortalHeader title="Welcome Guide" />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-3 pt-8 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-12 md:pb-16">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: COLOR.ink }}>
            Welcome to Bluu Rock
          </h1>
          <p className="mt-2 text-sm italic" style={{ color: COLOR.azureText }}>
            shape. develop. impact.
          </p>
        </header>

        <Section icon={Users} title="How we work">
          <P>
            Bluu Rock manages the day-to-day operations of your account, including chatting,
            sales strategy, content scheduling, and performance optimisation.
          </P>
          <P>
            To keep everything running smoothly, we rely on timely content delivery, approvals,
            and open communication. Clear collaboration allows us to scale your earnings
            efficiently and consistently.
          </P>
        </Section>

        <Section icon={ImagePlay} title="Custom requests">
          <P>
            These are unique, custom goods your fans request at a much higher rate than
            general PPV content — pictures, videos, calls, and items. Because a fan willing to
            pay for one usually comes back for more, getting them out quickly matters.
          </P>
          <P>
            Open a custom to see everything the fan asked for, then tap{" "}
            <Strong>Done</Strong> once you&rsquo;ve finished it. It goes to your manager to check,
            and disappears from your list.
          </P>
        </Section>

        <Section icon={CalendarCheck} title="Content plan">
          <P>
            We follow a structured approach to planning and scheduling content — PPVs,
            timeline posts, social media posts, campaign content. Aim to fulfil requirements
            by the due date so our team can release content as scheduled.
          </P>
          <P>
            Content requests can be marked done straight from the list: tap the tick on the
            right of the row. Tapped one by mistake? The confirmation that appears has an{" "}
            <Strong>Undo</Strong> on it.
          </P>
        </Section>

        <Section icon={FolderOpen} title="Uploading your content">
          <P>
            Your Google Drive folder is in the top bar of every screen. Upload what you have
            recorded into <Code># Unsorted</Code> — customs, content requirements, everything.
            Create new folders or rename files as needed.
          </P>
          <P>
            For a custom request, name the file with its <Code>CR</Code> code. If there are
            several files, put them in a folder named with the code instead.
          </P>
          <div
            className={`mt-1 flex flex-col gap-2 rounded-xl px-4 py-4 ${SURFACE.card}`}
          >
            <p className="text-sm font-medium" style={{ color: COLOR.ink }}>
              Content examples
            </p>
            <p className="text-sm leading-relaxed" style={{ color: COLOR.ink2 }}>
              Use the examples in this folder as a reference or inspiration when filming.
            </p>
            <ExternalAction href={CONTENT_EXAMPLES_URL}>Open the examples folder</ExternalAction>
          </div>
        </Section>

        <Section icon={Rocket} title="What's coming">
          <P>
            We are continuously improving our systems, sales strategies, and tools to grow
            your account.
          </P>
          <P>
            Upcoming updates may include new campaign formats, enhanced reporting, and
            additional growth opportunities.
          </P>
        </Section>

        <Section icon={ShieldCheck} title="Terms & privacy">
          <P>
            Your use of this portal is governed by our Terms of Use &amp; Privacy Policy.
            Part C covers creators specifically — what the portal is (and is not), your
            content and the licence you give us, and the confirmations you make about the
            content you upload. Part D explains what personal data we hold, how long we keep
            it, and how to ask for a copy or a deletion.
          </P>
          <P>
            Amounts shown in this portal are internal tracking figures for coordination.
          </P>
          <ExternalAction href="/terms">Read the Terms &amp; Privacy Policy</ExternalAction>
        </Section>
      </div>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function P({ children }: { children: React.ReactNode }) {
  // 65–75ch measure. The guide is the one screen in the portal that runs as
  // prose, so it is the one screen where measure matters.
  return (
    <p className="max-w-[68ch] text-sm leading-relaxed text-pretty" style={{ color: COLOR.ink2 }}>
      {children}
    </p>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return (
    <strong className="font-semibold" style={{ color: COLOR.ink }}>
      {children}
    </strong>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="pf-mono rounded px-1 py-0.5 text-xs"
      style={{ background: COLOR.raised, color: COLOR.ink }}
    >
      {children}
    </code>
  );
}

function ExternalAction({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex min-h-11 w-fit items-center gap-1.5 rounded-xl px-4 text-xs font-semibold transition-colors ${ACCENT_BTN} ${FOCUS_RING}`}
    >
      {children} <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
    </a>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-lg"
          style={{ background: COLOR.raised }}
        >
          <Icon className="size-4" style={{ color: COLOR.azure }} aria-hidden="true" />
        </span>
        <h2 className="text-base font-semibold" style={{ color: COLOR.ink }}>
          {title}
        </h2>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

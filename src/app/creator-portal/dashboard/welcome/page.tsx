import {
  Users, LayoutDashboard, ImagePlay, CalendarCheck,
  FolderOpen, Rocket, ExternalLink,
} from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { PAGE_GROUND_STYLE, HEADER_STYLE, SURFACE, ACCENT_BTN, HUES } from "../../theme";

export default function WelcomePage() {
  return (
    <div className="min-h-screen" style={PAGE_GROUND_STYLE}>
      {/* Top bar */}
      <header
        className="sticky top-0 z-40 flex h-14 items-center gap-2 px-3 sm:px-6"
        style={HEADER_STYLE}
      >
        <SidebarTrigger className="text-zinc-400 hover:text-zinc-100 hover:bg-white/5" />
        <img
          src="/logo/bluu_long.svg"
          alt="Bluu Rock"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-6 pointer-events-none"
        />
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-8 sm:gap-10">

        {/* Hero */}
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Creator Portal</p>
          <h1 className="text-3xl font-bold text-zinc-100 tracking-tight">Welcome to Bluu Rock MGMT</h1>
          <p className="text-sm text-zinc-400 italic mt-0.5">shape. develop. impact.</p>
        </div>

        {/* How We Work */}
        <Section icon={Users} iconColor={HUES.violet} title="How We Work">
          <p className="text-sm text-zinc-400 leading-relaxed">
            Bluu Rock manages the day-to-day operations of your account, including chatting, sales strategy,
            content scheduling, and performance optimisation.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            To keep everything running smoothly, we rely on timely content delivery, approvals, and open
            communication. Clear collaboration allows us to scale your earnings efficiently and consistently.
          </p>
        </Section>

        {/* Your Dashboard */}
        <Section icon={LayoutDashboard} iconColor={HUES.blue} title="Your Dashboard">
          <p className="text-sm text-zinc-400 leading-relaxed">
            This is a multi-layered workspace designed to seamlessly connect you with management and our chat
            team, providing real-time updates on custom requests, calls, items, and content requirements.
            Please ensure card statuses are updated accurately and in a timely manner so our team can
            coordinate effectively, release content as scheduled, and maintain momentum.
          </p>

          <div className="flex flex-col gap-3 mt-2">
            <DashboardItem
              icon={ImagePlay}
              iconColor={HUES.violet}
              title="Custom Requests"
              body="These are unique, custom goods your fans request at a much higher rate than general PPV content — pictures, videos, calls, and items. Once you complete a video, call, or item, mark it as Completed."
            />
            <DashboardItem
              icon={CalendarCheck}
              iconColor={HUES.blue}
              title="Content Plan"
              body="We follow a structured approach to planning and scheduling content. PPVs, timeline posts, social media posts, campaign content, etc. Aim to fulfil requirements by the due date. Mark items as Completed when done."
            />
            <DashboardItem
              icon={FolderOpen}
              iconColor={HUES.amber}
              title="Google Drive Upload Link"
              body="Find your Google Drive upload link — upload content you've recorded here. Custom requests, content requirements, etc. Create new folders or rename files as needed."
            />
          </div>

          {/* Content Examples aside */}
          <div className="mt-2 flex flex-col gap-2 rounded-xl border border-violet-500/[0.18] bg-violet-500/[0.06] px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-300">Content Examples</p>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Use the examples in this folder as a reference or inspiration when filming your content.
            </p>
            <a
              href="https://drive.google.com/drive/folders/1vR1GwiJ9VV_312ZJpdol6MhRcodJ9XIR?usp=drive_link"
              target="_blank"
              rel="noreferrer"
              className={`flex items-center gap-1.5 self-start rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${ACCENT_BTN}`}
            >
              Open Folder <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </Section>

        {/* What's Coming */}
        <Section icon={Rocket} iconColor={HUES.emerald} title="What's Coming">
          <p className="text-sm text-zinc-400 leading-relaxed">
            We are continuously improving our systems, sales strategies, and tools to grow your account.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Upcoming updates may include new campaign formats, enhanced reporting, and additional growth opportunities.
          </p>
        </Section>

      </main>
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

interface SectionProps {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  iconColor: string;
  title: string;
  children: React.ReactNode;
}

function Section({ icon: Icon, iconColor, title, children }: SectionProps) {
  return (
    <section className={`flex flex-col gap-4 rounded-2xl px-4 py-5 sm:px-6 sm:py-6 ${SURFACE.panel}`}>
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `${iconColor}18` }}
        >
          <Icon className="w-4 h-4" style={{ color: iconColor }} />
        </div>
        <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
      </div>
      <div className="flex flex-col gap-3 sm:pl-11">
        {children}
      </div>
    </section>
  );
}

// ─── Dashboard Item ───────────────────────────────────────────────────────────

interface DashboardItemProps {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  iconColor: string;
  title: string;
  body: string;
}

function DashboardItem({ icon: Icon, iconColor, title, body }: DashboardItemProps) {
  return (
    <div className={`flex gap-3 rounded-xl px-4 py-3 ${SURFACE.card}`}>
      <div
        className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: `${iconColor}18` }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: iconColor }} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold text-zinc-200">{title}</p>
        <p className="text-xs text-zinc-400 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

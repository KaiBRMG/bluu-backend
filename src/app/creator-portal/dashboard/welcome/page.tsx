import {
  Users, LayoutDashboard, ImagePlay, CalendarCheck,
  FolderOpen, Rocket, ExternalLink,
} from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";

export default function WelcomePage() {
  return (
    <div
      className="min-h-screen"
      style={{
        backgroundColor: "#09090b",
        backgroundImage: "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(139,92,246,0.08), transparent)",
        color: "white",
      }}
    >
      {/* Top bar */}
      <header
        className="sticky top-0 z-40 flex items-center gap-2 px-3 sm:px-6 h-14"
        style={{
          background: "rgba(9,9,11,0.85)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <SidebarTrigger className="text-zinc-400 hover:text-zinc-100 hover:bg-white/5" />
        <span className="text-sm font-medium text-zinc-300 truncate">Welcome to Bluu Rock</span>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-8 sm:gap-10">

        {/* Hero */}
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-600">Creator Portal</p>
          <h1 className="text-3xl font-bold text-zinc-100 tracking-tight">Welcome to Bluu Rock MGMT</h1>
          <p className="text-sm text-zinc-500 italic mt-0.5">shape. develop. impact.</p>
        </div>

        {/* How We Work */}
        <Section icon={Users} iconColor="#8b5cf6" title="How We Work">
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
        <Section icon={LayoutDashboard} iconColor="#3b82f6" title="Your Dashboard">
          <p className="text-sm text-zinc-400 leading-relaxed">
            This is a multi-layered workspace designed to seamlessly connect you with management and our chat
            team, providing real-time updates on custom requests, calls, items, and content requirements.
            Please ensure card statuses are updated accurately and in a timely manner so our team can
            coordinate effectively, release content as scheduled, and maintain momentum.
          </p>

          <div className="flex flex-col gap-3 mt-2">
            <DashboardItem
              icon={ImagePlay}
              iconColor="#8b5cf6"
              title="Custom Requests"
              body="These are unique, custom goods your fans request at a much higher rate than general PPV content — pictures, videos, calls, and items. Once you complete a video, call, or item, mark it as Completed."
            />
            <DashboardItem
              icon={CalendarCheck}
              iconColor="#3b82f6"
              title="Content Plan"
              body="We follow a structured approach to planning and scheduling content. PPVs, timeline posts, social media posts, campaign content, etc. Aim to fulfil requirements by the due date. Mark items as Completed when done."
            />
            <DashboardItem
              icon={FolderOpen}
              iconColor="#f59e0b"
              title="Google Drive Upload Link"
              body="Find your Google Drive upload link — upload content you've recorded here. Custom requests, content requirements, etc. Create new folders or rename files as needed."
            />
          </div>

          {/* Content Examples aside */}
          <div
            className="mt-2 rounded-xl px-4 py-4 flex flex-col gap-2"
            style={{
              background: "rgba(139,92,246,0.06)",
              border: "1px solid rgba(139,92,246,0.18)",
            }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-400">Content Examples</p>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Use the examples in this folder as a reference or inspiration when filming your content.
            </p>
            <a
              href="https://drive.google.com/drive/folders/1vR1GwiJ9VV_312ZJpdol6MhRcodJ9XIR?usp=drive_link"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs font-semibold self-start px-3 py-1.5 rounded-lg transition-all hover:brightness-110"
              style={{
                background: "rgba(139,92,246,0.15)",
                border: "1px solid rgba(139,92,246,0.3)",
                color: "#c4b5fd",
              }}
            >
              Open Folder <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </Section>

        {/* What's Coming */}
        <Section icon={Rocket} iconColor="#10b981" title="What's Coming">
          <p className="text-sm text-zinc-400 leading-relaxed">
            We are continuously improving our systems, sales strategies, and tools to grow your account.
          </p>
          <p className="text-sm text-zinc-500 leading-relaxed">
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
    <section
      className="rounded-2xl px-4 sm:px-6 py-5 sm:py-6 flex flex-col gap-4"
      style={{
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
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
    <div
      className="rounded-xl px-4 py-3 flex gap-3"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div
        className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: `${iconColor}18` }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: iconColor }} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold text-zinc-200">{title}</p>
        <p className="text-xs text-zinc-500 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useCreatorAuth } from "@/components/CreatorAuthProvider";
import { auth, db } from "@/firebase-config";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Carousel, CarouselContent, CarouselItem,
  CarouselPrevious, CarouselNext,
} from "@/components/ui/carousel";
import {
  Info, ExternalLink, CheckCircle2, ChevronRight, LogOut, X,
} from "lucide-react";
import {
  type CampaignEntry, type CRType, type CRPriority,
  PRIORITY_COLORS, formatAmount, formatDueDate, firestoreToEntry, sortByPriority,
} from "@/lib/campaignTracking";
import { apiRequest } from "@/lib/clientApi";
import { toast } from "sonner";

// ─── Entry Card ───────────────────────────────────────────────────────────────

interface EntryCardProps {
  entry: CampaignEntry;
  onComplete: (id: string) => void;
  completing: boolean;
  driveLink?: string | null;
  accentHex: string;
}

function EntryCard({ entry, onComplete, completing, driveLink, accentHex }: EntryCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const dueDateLabel = entry.dueDate
    ? `${formatDueDate(entry.dueDate)}${entry.dueDateTimezone ? ` (${entry.dueDateTimezone})` : ""}`
    : null;

  return (
    <>
      <div
        className="relative rounded-2xl border p-4 flex flex-col gap-3 h-full min-h-[260px]"
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
          borderColor: "rgba(255,255,255,0.08)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        }}
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <span
            className="font-mono text-xs font-semibold tracking-widest px-2 py-0.5 rounded-md"
            style={{ background: `${accentHex}25`, color: accentHex }}
          >
            {entry.CR}
          </span>
          {entry.priority && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[entry.priority as CRPriority]}`}>
              {entry.priority} Priority
            </span>
          )}
        </div>

        {/* Fan name */}
        <div>
          <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-0.5">Fan</p>
          <p className="text-sm font-medium text-zinc-100">{entry.fanName}</p>
          {entry.profileLink && (
            <a
              href={entry.profileLink}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] transition-colors flex items-center gap-1 mt-0.5"
              style={{ color: accentHex }}
            >
              View Profile <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {/* View details link */}
        <button
          onClick={() => setDetailOpen(true)}
          className="text-[11px] transition-colors flex items-center gap-1 self-start flex-1"
          style={{ color: accentHex }}
        >
          View details <ChevronRight className="w-3 h-3" />
        </button>

        {/* Meta */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
          {dueDateLabel && (
            <span className="text-rose-400/80">Due {dueDateLabel}</span>
          )}
          {entry.length && <span>Length: {entry.length}</span>}
          {entry.socialPlatform && <span>{entry.socialPlatform}</span>}
          {entry.socialUsername && <span>@{entry.socialUsername}</span>}
          {entry.address && <span className="truncate max-w-[140px]">{entry.address}</span>}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 pt-1 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <span className="text-sm font-semibold text-zinc-200">{formatAmount(entry.totalAmount)}</span>
          <Button
            onClick={() => onComplete(entry.id)}
            disabled={completing}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 h-auto rounded-lg transition-all disabled:opacity-50 self-start"
            style={{
              background: "linear-gradient(135deg, #059669, #10b981)",
              color: "white",
              boxShadow: completing ? "none" : "0 0 12px rgba(16,185,129,0.35)",
            }}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {completing ? "Saving…" : "Completed"}
          </Button>
        </div>
      </div>

      {/* Detail overlay */}
      {detailOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          onClick={() => setDetailOpen(false)}
        >
          <Card
            className="w-full max-w-md max-h-[80vh] overflow-y-auto"
            style={{
              background: "#111113",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "white",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 px-6 pt-6 pb-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="font-mono text-xs font-semibold tracking-widest px-2 py-0.5 rounded-md"
                  style={{ background: `${accentHex}25`, color: accentHex }}
                >
                  {entry.CR}
                </span>
                {entry.priority && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[entry.priority as CRPriority]}`}>
                    {entry.priority} Priority
                  </span>
                )}
              </div>
              <button
                onClick={() => setDetailOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <CardContent className="flex flex-col gap-4 pt-4">
              {/* Fan */}
              <div>
                <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-0.5">Fan</p>
                <p className="text-sm font-medium text-zinc-100">{entry.fanName}</p>
                {entry.profileLink && (
                  <a
                    href={entry.profileLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] transition-colors flex items-center gap-1 mt-0.5"
                    style={{ color: accentHex }}
                  >
                    View Profile <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {/* Description */}
              {entry.description && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Description</p>
                  <p className="text-sm text-zinc-300 leading-relaxed">{entry.description}</p>
                </div>
              )}

              {/* Meta details */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                {dueDateLabel && (
                  <div>
                    <p className="uppercase tracking-wider text-zinc-500 mb-0.5">Due Date</p>
                    <p className="text-rose-400/80">{dueDateLabel}</p>
                  </div>
                )}
                {entry.length && (
                  <div>
                    <p className="uppercase tracking-wider text-zinc-500 mb-0.5">Length</p>
                    <p className="text-zinc-300">{entry.length}</p>
                  </div>
                )}
                {entry.socialPlatform && (
                  <div>
                    <p className="uppercase tracking-wider text-zinc-500 mb-0.5">Platform</p>
                    <p className="text-zinc-300">{entry.socialPlatform}</p>
                  </div>
                )}
                {entry.socialUsername && (
                  <div>
                    <p className="uppercase tracking-wider text-zinc-500 mb-0.5">Username</p>
                    <p className="text-zinc-300">@{entry.socialUsername}</p>
                  </div>
                )}
                {entry.address && (
                  <div className="col-span-2">
                    <p className="uppercase tracking-wider text-zinc-500 mb-0.5">Address</p>
                    <p className="text-zinc-300">{entry.address}</p>
                  </div>
                )}
                {entry.totalAmount != null && (
                  <div>
                    <p className="uppercase tracking-wider text-zinc-500 mb-0.5">Amount</p>
                    <p className="text-zinc-200 font-semibold">{formatAmount(entry.totalAmount)}</p>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                {driveLink && (
                  <a
                    href={driveLink}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-all hover:brightness-110"
                    style={{
                      background: "linear-gradient(135deg, rgba(59,130,246,0.2), rgba(99,102,241,0.2))",
                      border: "1px solid rgba(99,102,241,0.3)",
                      color: "#93c5fd",
                    }}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Upload
                  </a>
                )}
                <Button
                  onClick={() => { onComplete(entry.id); setDetailOpen(false); }}
                  disabled={completing}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 h-auto rounded-lg transition-all disabled:opacity-50"
                  style={{
                    background: "linear-gradient(135deg, #059669, #10b981)",
                    color: "white",
                    boxShadow: completing ? "none" : "0 0 12px rgba(16,185,129,0.35)",
                  }}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {completing ? "Saving…" : "Completed"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>,
        document.body
      )}
    </>
  );
}

// ─── Type Tile ────────────────────────────────────────────────────────────────

const TYPE_META: Record<CRType, { label: string; infoText?: string; accentHex: string }> = {
  CR: {
    label: "Customs",
    infoText: "Please upload content to your Google Drive folder using the CR code as the name. For multiple files, create a folder with the CR code as the name.",
    accentHex: "#8b5cf6",
  },
  Call: {
    label: "Calls",
    accentHex: "#3b82f6",
  },
  Item: {
    label: "Items",
    accentHex: "#f59e0b",
  },
};

interface TypeTileProps {
  type: CRType;
  entries: CampaignEntry[];
  onComplete: (id: string) => void;
  completing: string | null;
  driveLink?: string | null;
}

function TypeTile({ type, entries, onComplete, completing, driveLink }: TypeTileProps) {
  const meta = TYPE_META[type];

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-4"
      style={{
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      {/* Tile header */}
      <div className="flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: meta.accentHex, boxShadow: `0 0 6px ${meta.accentHex}` }}
        />
        <h3 className="text-sm font-semibold text-zinc-200">{meta.label}</h3>
        <span className="text-xs text-zinc-500">({entries.length})</span>
        {meta.infoText && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-5 w-5 text-zinc-600 hover:text-zinc-400">
                <Info className="w-3.5 h-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="max-w-xs text-xs text-zinc-300 leading-relaxed">
              {meta.infoText}
            </PopoverContent>
          </Popover>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center mb-2"
            style={{ background: `${meta.accentHex}15` }}
          >
            <CheckCircle2 className="w-4 h-4" style={{ color: meta.accentHex }} />
          </div>
          <p className="text-xs text-zinc-600">All caught up!</p>
        </div>
      ) : (
        <Carousel className="w-full" opts={{ align: "start" }}>
          <CarouselContent className="-ml-3">
            {entries.map(e => (
              <CarouselItem key={e.id} className="pl-3 basis-[85%] sm:basis-[75%]">
                <EntryCard
                  entry={e}
                  onComplete={onComplete}
                  completing={completing === e.id}
                  driveLink={driveLink}
                  accentHex={meta.accentHex}
                />
              </CarouselItem>
            ))}
          </CarouselContent>
          {entries.length > 1 && (
            <>
              <CarouselPrevious className="left-0 -translate-x-1/2" />
              <CarouselNext className="right-0 translate-x-1/2" />
            </>
          )}
        </Carousel>
      )}
    </div>
  );
}

// ─── Profile Menu ─────────────────────────────────────────────────────────────

interface ProfileMenuProps {
  stageName: string;
  email: string;
  photoURL?: string | null;
}

function ProfileMenu({ stageName, email, photoURL }: ProfileMenuProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="flex items-center gap-2.5 rounded-xl px-3 py-1.5 h-auto hover:bg-white/5">
          {photoURL ? (
            <img src={photoURL} alt="" className="w-7 h-7 rounded-full object-cover ring-1 ring-white/10" />
          ) : (
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
              style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1)", color: "white" }}
            >
              {stageName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="text-sm font-medium text-zinc-200 hidden sm:block">{stageName}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0 overflow-hidden rounded-xl" style={{ background: "#111113", border: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          <p className="text-sm font-semibold text-zinc-100">{stageName}</p>
          <p className="text-xs text-zinc-500 truncate mt-0.5">{email}</p>
        </div>
        <div className="p-1.5">
          <Button
            variant="ghost"
            className="flex items-center gap-2.5 w-full px-3 py-2 h-auto text-sm text-zinc-300 hover:text-white hover:bg-white/5 rounded-lg justify-start"
            onClick={() => auth.signOut()}
          >
            <LogOut className="w-4 h-4 text-zinc-500" />
            Sign Out
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CreatorDashboardPage() {
  const { creatorUser } = useCreatorAuth();
  const router = useRouter();
  const [entries, setEntries] = useState<CampaignEntry[]>([]);
  const [completing, setCompleting] = useState<string | null>(null);

  useEffect(() => {
    if (!creatorUser) return;
    const q = query(
      collection(db, "campaign-tracking"),
      where("creatorID", "==", creatorUser.creatorID),
      where("status", "==", "In Progress")
    );
    const unsub = onSnapshot(q, snap => {
      setEntries(snap.docs.map(d => firestoreToEntry(d.id, d.data() as Record<string, unknown>)));
    }, (error) => {
      console.error('[dashboard] campaign-tracking listener error:', error);
    });
    return unsub;
  }, [creatorUser?.creatorID]);

  const handleComplete = async (id: string) => {
    setCompleting(id);
    const removed = entries.find(e => e.id === id);
    setEntries(prev => prev.filter(e => e.id !== id));
    try {
      const res = await apiRequest(`/api/campaign-tracking/${id}/creator-complete`, {
        method: "POST",
        body: JSON.stringify({ revert: false }),
      });
      if (!res.ok) throw new Error();
    } catch {
      if (removed) setEntries(prev => [...prev, removed]);
      toast.error("Failed to mark as completed");
    } finally {
      setCompleting(null);
    }
  };

  const entriesByType = useMemo(() => ({
    CR: sortByPriority(entries.filter(e => e.type === "CR")),
    Call: sortByPriority(entries.filter(e => e.type === "Call")),
    Item: sortByPriority(entries.filter(e => e.type === "Item")),
  }), [entries]);

  if (!creatorUser) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#09090b" }}>
        <div className="w-6 h-6 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin" />
      </div>
    );
  }

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
        className="sticky top-0 z-40 flex items-center justify-between px-4 sm:px-6 h-14"
        style={{
          background: "rgba(9,9,11,0.85)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <img src="/logo/bluu_long.svg" alt="Bluu" className="h-6" />
        <ProfileMenu
          stageName={creatorUser.stageName || creatorUser.displayName}
          email={creatorUser.userEmail}
          photoURL={creatorUser.photoURL}
        />
      </header>

      {/* Content */}
      <main className="max-w-4xl md:max-w-none mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-8">

        {/* Welcome */}
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-600 mb-1">Creator Portal</p>
          <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-100">
            Hey, {creatorUser.stageName || creatorUser.displayName} 👋
          </h1>
        </div>

        {/* Section 1: Outstanding Custom Requests */}
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-zinc-100">Outstanding Custom Requests</h2>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-600 hover:text-zinc-400 flex-shrink-0">
                  <Info className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="max-w-sm text-xs text-zinc-300 leading-relaxed">
                These are high-ticket custom requests your fans make. Since they are custom-made, they are sold at a significantly higher price than regular content. It is important that we get this content to them ASAP in order to maintain a good relationship. A fan who is willing to pay for one Custom Request is likely to come back for more!
              </PopoverContent>
            </Popover>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(["CR", "Call", "Item"] as CRType[]).map(type => (
              <TypeTile
                key={type}
                type={type}
                entries={entriesByType[type]}
                onComplete={handleComplete}
                completing={completing}
                driveLink={creatorUser.driveLink}
              />
            ))}
          </div>
        </section>

        {/* Section 2: Google Drive */}
        <section
          className="rounded-2xl px-5 py-4 flex items-center justify-between gap-4"
          style={{
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-semibold text-zinc-200">Google Drive Upload Link</h3>
            <p className="text-xs text-zinc-500">
              Your content folder. Please upload content in{" "}
              <span className="text-zinc-400 font-mono"># Unsorted</span>.
            </p>
          </div>
          {creatorUser.driveLink ? (
            <a
              href={creatorUser.driveLink}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl whitespace-nowrap transition-all hover:brightness-110"
              style={{
                background: "linear-gradient(135deg, rgba(59,130,246,0.2), rgba(99,102,241,0.2))",
                border: "1px solid rgba(99,102,241,0.3)",
                color: "#93c5fd",
              }}
            >
              Open Drive <ExternalLink className="w-3.5 h-3.5" />
            </a>
          ) : (
            <span className="text-xs text-zinc-600">No link configured.</span>
          )}
        </section>

        {/* Section 3: All Custom Requests */}
        <Button
          variant="ghost"
          className="w-full flex items-center justify-between px-5 py-4 h-auto rounded-2xl transition-all hover:brightness-110 active:scale-[0.99]"
          style={{
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
          onClick={() => router.push("/creator-portal/dashboard/all-customs")}
        >
          <div className="flex flex-col items-start gap-0.5">
            <span className="text-sm font-semibold text-zinc-200">All Custom Requests</span>
            <span className="text-xs text-zinc-500">View your full history</span>
          </div>
          <ChevronRight className="w-5 h-5 text-zinc-500" />
        </Button>

      </main>
    </div>
  );
}

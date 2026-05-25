"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCreatorAuth } from "@/components/CreatorAuthProvider";
import { useSearchParams } from "next/navigation";
import { auth, db } from "@/firebase-config";
import { collection, doc, getDoc, query, where, onSnapshot } from "firebase/firestore";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Carousel, CarouselContent, CarouselItem,
  CarouselPrevious, CarouselNext,
} from "@/components/ui/carousel";
import {
  Info, ExternalLink, CheckCircle2, ChevronRight, LogOut, X,
} from "lucide-react";
import {
  type CampaignEntry, type CRType, type CRPriority,
  PRIORITY_COLORS, formatAmount, formatDueDate, firestoreToEntry, sortByPriority, CAMPAIGN_TYPES,
} from "@/lib/campaignTracking";
import { orderBy } from "firebase/firestore";
import { apiRequest } from "@/lib/clientApi";
import { toast } from "sonner";

// ─── Content Planning types ───────────────────────────────────────────────────

interface CPDescriptionRow { qty: string; content: string; }

interface CPEntry {
  id: string;
  contentType: "SFW" | "NSFW";
  contentSummary: string;
  description: CPDescriptionRow[];
  comment: string;
  dueDate: string | null;
  status: "Outstanding" | "Completed";
  creatorID: string;
  isArchived: boolean;
}

function firestoreToCP(id: string, data: Record<string, unknown>): CPEntry {
  return {
    id,
    contentType: (data.contentType as "SFW" | "NSFW") ?? "SFW",
    contentSummary: (data.contentSummary as string) ?? "",
    description: (data.description as CPDescriptionRow[]) ?? [],
    comment: (data.comment as string) ?? "",
    dueDate: typeof data.dueDate === "string" ? data.dueDate : null,
    status: (data.status as "Outstanding" | "Completed") ?? "Outstanding",
    creatorID: (data.creatorID as string) ?? "",
    isArchived: (data.isArchived as boolean) ?? false,
  };
}

function isCPOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate + "T23:59:59Z") < new Date();
}

function formatCPDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch { return dateStr; }
}

// ─── Content Planning Card ────────────────────────────────────────────────────

interface CPCardProps {
  entry: CPEntry;
  onComplete: (id: string) => void;
  completing: boolean;
}

function CPCard({ entry, onComplete, completing }: CPCardProps) {
  const overdue = isCPOverdue(entry.dueDate);
  return (
    <div
      className="relative rounded-2xl border p-4 flex flex-col gap-3 h-full min-h-[240px]"
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
        borderColor: overdue ? "rgba(239,68,68,0.25)" : "rgba(255,255,255,0.08)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p className="text-sm font-semibold text-zinc-100 leading-tight flex-1">{entry.contentSummary}</p>
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md shrink-0 ${
            entry.contentType === "NSFW"
              ? "bg-orange-500/15 text-orange-400"
              : "bg-blue-500/15 text-blue-400"
          }`}
        >
          {entry.contentType}
        </span>
      </div>

      {/* Description */}
      {entry.description.length > 0 && entry.description.some(r => r.qty || r.content) && (
        <div className="flex flex-col gap-0.5">
          {entry.description.filter(r => r.qty || r.content).map((r, i) => (
            <p key={i} className="text-xs text-zinc-400">
              <span className="text-zinc-300 font-medium">{r.qty}</span>
              {r.qty && r.content ? " × " : ""}
              {r.content}
            </p>
          ))}
        </div>
      )}

      {/* Comment */}
      {entry.comment && (
        <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2">{entry.comment}</p>
      )}

      {/* Due date */}
      <p className={`text-xs mt-auto ${overdue ? "text-red-400 font-medium" : "text-zinc-500"}`}>
        {overdue ? "Overdue · " : "Due "}{formatCPDate(entry.dueDate)}
      </p>

      {/* Footer */}
      <div className="pt-1 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <Button
          onClick={() => onComplete(entry.id)}
          disabled={completing}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 h-auto rounded-lg transition-all disabled:opacity-50 w-full justify-center"
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
  );
}

// ─── CR Detail Overlay ────────────────────────────────────────────────────────

interface CRDetailOverlayProps {
  entry: CampaignEntry;
  accentHex: string;
  driveLink?: string | null;
  onComplete: (id: string) => void;
  completing: boolean;
  onClose: () => void;
}

function CRDetailOverlay({ entry, accentHex, driveLink, onComplete, completing, onClose }: CRDetailOverlayProps) {
  const dueDateLabel = entry.dueDate
    ? `${formatDueDate(entry.dueDate)}${entry.dueDateTimezone ? ` (${entry.dueDateTimezone})` : ""}`
    : null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <Card
        className="w-full max-w-md max-h-[80vh] overflow-y-auto"
        style={{ background: "#111113", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
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
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0">
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
              onClick={() => { onComplete(entry.id); onClose(); }}
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
  );
}

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

      {detailOpen && (
        <CRDetailOverlay
          entry={entry}
          accentHex={accentHex}
          driveLink={driveLink}
          onComplete={onComplete}
          completing={completing}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </>
  );
}

// ─── Type Tile ────────────────────────────────────────────────────────────────

const TYPE_META: Record<"CR" | "Call" | "Item", { label: string; infoText?: string; accentHex: string }> = {
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
  type: "CR" | "Call" | "Item";
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
  const searchParams = useSearchParams();
  const crId = searchParams.get('crId');

  const [entries, setEntries] = useState<CampaignEntry[]>([]);
  const [completing, setCompleting] = useState<string | null>(null);
  const [cpEntries, setCpEntries] = useState<CPEntry[]>([]);
  const [cpCompleting, setCpCompleting] = useState<string | null>(null);
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [linkedEntry, setLinkedEntry] = useState<CampaignEntry | null>(null);
  const [linkedError, setLinkedError] = useState<string | null>(null);
  const linkedResolvedRef = useRef(false);

  useEffect(() => {
    if (!creatorUser) return;
    const q = query(
      collection(db, "campaign-tracking"),
      where("creatorID", "==", creatorUser.creatorID),
      where("status", "==", "In Progress")
    );
    const unsub = onSnapshot(q, snap => {
      setEntries(snap.docs
        .map(d => firestoreToEntry(d.id, d.data() as Record<string, unknown>))
        .filter(e => !(CAMPAIGN_TYPES as readonly string[]).includes(e.type))
      );
      setEntriesLoaded(true);
    }, (error) => {
      console.error('[dashboard] campaign-tracking listener error:', error);
    });
    return unsub;
  }, [creatorUser?.creatorID]);

  // Resolve deep-linked CR from ?crId= query param
  useEffect(() => {
    if (!crId || !creatorUser || !entriesLoaded || linkedResolvedRef.current) return;

    const found = entries.find(e => e.id === crId);
    if (found) {
      linkedResolvedRef.current = true;
      setLinkedEntry(found);
      return;
    }

    // Not in current "In Progress" list — wait briefly for a server snapshot,
    // then fetch the doc directly to determine why.
    const timer = setTimeout(async () => {
      if (linkedResolvedRef.current) return;
      linkedResolvedRef.current = true;
      try {
        const snap = await getDoc(doc(db, 'campaign-tracking', crId));
        if (!snap.exists()) {
          toast.error('Custom request not found.');
        } else if ((snap.data() as Record<string, unknown>).creatorID !== creatorUser.creatorID) {
          setLinkedError('This request belongs to a different account.');
        } else {
          toast.error("This request isn't currently active.");
        }
      } catch {
        toast.error("This request couldn't be loaded.");
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [crId, entries, creatorUser, entriesLoaded]);

  useEffect(() => {
    if (!creatorUser) return;
    const q = query(
      collection(db, "content-planning"),
      where("creatorID", "==", creatorUser.creatorID),
      where("status", "==", "Outstanding"),
      orderBy("dueDate", "asc")
    );
    const unsub = onSnapshot(q, snap => {
      const sorted = snap.docs
        .map(d => firestoreToCP(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate.localeCompare(b.dueDate);
        });
      setCpEntries(sorted);
    }, (error) => {
      console.error('[dashboard] content-planning listener error:', error);
    });
    return unsub;
  }, [creatorUser?.creatorID]);

  const handleCpComplete = async (id: string) => {
    setCpCompleting(id);
    const removed = cpEntries.find(e => e.id === id);
    setCpEntries(prev => prev.filter(e => e.id !== id));
    try {
      const res = await apiRequest(`/api/content-planning/${id}/creator-complete`, { method: "POST" });
      if (!res.ok) throw new Error();
    } catch {
      if (removed) setCpEntries(prev => [...prev, removed].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      }));
      toast.error("Failed to mark as completed");
    } finally {
      setCpCompleting(null);
    }
  };

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

  const entriesByType = useMemo<Record<"CR" | "Call" | "Item", CampaignEntry[]>>(() => ({
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
        className="sticky top-0 z-40 flex items-center justify-between gap-2 px-3 sm:px-6 h-14 relative"
        style={{
          background: "rgba(9,9,11,0.85)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <SidebarTrigger className="text-zinc-400 hover:text-zinc-100 hover:bg-white/5" />
        <img
          src="/logo/bluu_long.svg"
          alt="Bluu Rock"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-6 pointer-events-none"
        />
        <ProfileMenu
          stageName={creatorUser.stageName || creatorUser.displayName}
          email={creatorUser.userEmail}
          photoURL={creatorUser.photoURL}
        />
      </header>

      {/* Content */}
      <main className="max-w-4xl md:max-w-none mx-auto px-3 sm:px-6 py-6 sm:py-12 flex flex-col gap-6 sm:gap-8">

        {/* Welcome */}
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-600 mb-1">Creator Portal</p>
          <h1 className="text-xl sm:text-3xl font-semibold text-zinc-100">
            Hey, {creatorUser.stageName || creatorUser.displayName} 👋
          </h1>
        </div>

        {/* Section 1: Custom Requests */}
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-zinc-100">Custom Requests</h2>
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
            {(["CR", "Call", "Item"] as ("CR" | "Call" | "Item")[]).map(type => (
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

        {/* Section 2: Content Planning */}
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-zinc-100">Content Planning</h2>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-600 hover:text-zinc-400 flex-shrink-0">
                  <Info className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="max-w-sm text-xs text-zinc-300 leading-relaxed">
                This is the content we need to maintain your page. Please try sticking to your due dates as we follow a strict content upload schedule!
              </PopoverContent>
            </Popover>
          </div>

          <div
            className="rounded-2xl p-4 w-full"
            style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            {cpEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center mb-2"
                  style={{ background: "rgba(16,185,129,0.1)" }}
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                </div>
                <p className="text-xs text-zinc-600">All caught up — no pending content requests!</p>
              </div>
            ) : (
              <Carousel className="w-full" opts={{ align: "start" }}>
                <CarouselContent className="-ml-3">
                  {cpEntries.map(e => (
                    <CarouselItem key={e.id} className="pl-3 basis-[90%] sm:basis-[48%]">
                      <CPCard
                        entry={e}
                        onComplete={handleCpComplete}
                        completing={cpCompleting === e.id}
                      />
                    </CarouselItem>
                  ))}
                </CarouselContent>
                {cpEntries.length > 1 && (
                  <>
                    <CarouselPrevious className="left-0 -translate-x-1/2" />
                    <CarouselNext className="right-0 translate-x-1/2" />
                  </>
                )}
              </Carousel>
            )}
          </div>
        </section>

        {/* Section 3: Google Drive */}
        <section
          className="rounded-2xl px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          style={{
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <div className="flex flex-col gap-0.5 min-w-0">
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
              className="flex items-center justify-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl whitespace-nowrap transition-all hover:brightness-110 self-stretch sm:self-auto"
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

      </main>

      {/* Deep-linked CR detail */}
      {linkedEntry && (
        <CRDetailOverlay
          entry={linkedEntry}
          accentHex={TYPE_META[linkedEntry.type as "CR" | "Call" | "Item"]?.accentHex ?? "#8b5cf6"}
          driveLink={creatorUser.driveLink}
          onComplete={(id) => { handleComplete(id); setLinkedEntry(null); }}
          completing={completing === linkedEntry.id}
          onClose={() => setLinkedEntry(null)}
        />
      )}

      {/* Wrong-account error */}
      {linkedError && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          onClick={() => setLinkedError(null)}
        >
          <Card
            className="w-full max-w-sm"
            style={{ background: "#111113", border: "1px solid rgba(239,68,68,0.25)", color: "white" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: "rgba(239,68,68,0.1)" }}
              >
                <X className="w-5 h-5 text-red-400" />
              </div>
              <p className="text-sm font-medium text-zinc-100">{linkedError}</p>
              <Button variant="outline" size="sm" onClick={() => setLinkedError(null)}>Dismiss</Button>
            </div>
          </Card>
        </div>,
        document.body
      )}
    </div>
  );
}

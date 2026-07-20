"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCreatorAuth } from "@/components/CreatorAuthProvider";
import { useSearchParams } from "next/navigation";
import { auth, db } from "@/firebase-config";
import { collection, doc, getDoc, query, where, onSnapshot, orderBy } from "firebase/firestore";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Info, ExternalLink, CheckCircle2, ChevronRight, LogOut } from "lucide-react";
import {
  type CampaignEntry, type CRPriority,
  PRIORITY_COLORS, formatAmount, formatDueDate, firestoreToEntry, sortByPriority, CAMPAIGN_TYPES,
} from "@/lib/campaignTracking";
import { apiRequest } from "@/lib/clientApi";
import { toast } from "sonner";
import {
  TYPE_META, SURFACE, ACCENT_BTN, COMPLETE_BTN, PAGE_GROUND_STYLE, HEADER_STYLE, contentTypeBadge,
  type CustomType,
} from "../theme";
import { CustomRequestDialog } from "../components/CustomRequestDialog";
import { CreatorDialog } from "../components/CreatorDialog";

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

function sortCP(list: CPEntry[]): CPEntry[] {
  return [...list].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
}

// ─── Content Planning Card ────────────────────────────────────────────────────

function CPCard({ entry, onComplete, completing }: {
  entry: CPEntry;
  onComplete: (id: string) => void;
  completing: boolean;
}) {
  const overdue = isCPOverdue(entry.dueDate);
  const rows = entry.description.filter(r => r.qty || r.content);
  return (
    <div
      className={`flex h-full flex-col gap-3 rounded-xl p-4 ${SURFACE.card}`}
      style={overdue ? { borderColor: "rgba(239,68,68,0.25)" } : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex-1 text-sm font-semibold leading-tight text-zinc-100">{entry.contentSummary}</p>
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${contentTypeBadge(entry.contentType)}`}>
          {entry.contentType}
        </span>
      </div>

      {rows.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {rows.map((r, i) => (
            <p key={i} className="text-xs text-zinc-400">
              <span className="font-medium text-zinc-300">{r.qty}</span>
              {r.qty && r.content ? " × " : ""}
              {r.content}
            </p>
          ))}
        </div>
      )}

      {entry.comment && (
        <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500">{entry.comment}</p>
      )}

      <p className={`mt-auto text-xs ${overdue ? "font-medium text-red-300" : "text-zinc-500"}`}>
        {overdue ? "Overdue · " : "Due "}{formatCPDate(entry.dueDate)}
      </p>

      <div className="border-t border-white/[0.06] pt-3">
        <Button
          onClick={() => onComplete(entry.id)}
          disabled={completing}
          size="sm"
          className={`group w-full gap-1.5 ${COMPLETE_BTN}`}
        >
          <CheckCircle2 className="h-3.5 w-3.5 transition-transform motion-safe:group-hover:scale-110" />
          {completing ? "Saving…" : "Mark Completed"}
        </Button>
      </div>
    </div>
  );
}

// ─── Customs Card (opens detail dialog; completion is deliberate) ─────────────

function CustomCard({ entry, accentHex, onOpen }: {
  entry: CampaignEntry;
  accentHex: string;
  onOpen: () => void;
}) {
  const dueLabel = entry.dueDate
    ? `${formatDueDate(entry.dueDate)}${entry.dueDateTimezone ? ` (${entry.dueDateTimezone})` : ""}`
    : null;
  return (
    <button
      onClick={onOpen}
      className={`flex flex-col gap-2 rounded-xl p-3 text-left transition-all ${SURFACE.card} ${SURFACE.cardHover} active:scale-[0.98]`}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="rounded-md px-2 py-0.5 font-mono text-xs font-semibold tracking-widest"
          style={{ background: `${accentHex}25`, color: accentHex }}
        >
          {entry.CR}
        </span>
        {entry.priority && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[entry.priority as CRPriority]}`}>
            {entry.priority}
          </span>
        )}
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wider text-zinc-500">Fan</p>
        <p className="truncate text-sm font-medium text-zinc-100">{entry.fanName}</p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-rose-300">{dueLabel ? `Due ${dueLabel}` : ""}</span>
        <span className="text-sm font-semibold tabular-nums text-zinc-200">{formatAmount(entry.totalAmount)}</span>
      </div>

      <span className="inline-flex items-center gap-1 text-[11px] text-violet-300">
        View details <ChevronRight className="h-3 w-3" />
      </span>
    </button>
  );
}

// ─── Type Tile ────────────────────────────────────────────────────────────────

function TypeTile({ type, entries, onOpen }: {
  type: CustomType;
  entries: CampaignEntry[];
  onOpen: (entry: CampaignEntry) => void;
}) {
  const meta = TYPE_META[type];
  return (
    <div className={`flex flex-col gap-4 rounded-2xl p-4 ${SURFACE.panel}`}>
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: meta.hex }} />
        <h3 className="text-sm font-semibold text-zinc-200">{meta.label}</h3>
        <span className="text-xs tabular-nums text-zinc-500">({entries.length})</span>
        {meta.infoText && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-5 w-5 text-zinc-500 hover:text-zinc-300">
                <Info className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="max-w-xs text-xs leading-relaxed text-zinc-300">
              {meta.infoText}
            </PopoverContent>
          </Popover>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-90 motion-safe:duration-500" style={{ background: `${meta.hex}15` }}>
            <CheckCircle2 className="h-4 w-4" style={{ color: meta.hex }} />
          </div>
          <p className="text-xs text-zinc-400">All caught up!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map(e => (
            <CustomCard key={e.id} entry={e} accentHex={meta.hex} onOpen={() => onOpen(e)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Profile Menu ─────────────────────────────────────────────────────────────

function ProfileMenu({ stageName, email, photoURL }: {
  stageName: string;
  email: string;
  photoURL?: string | null;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="h-auto items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-white/5">
          <Avatar size="sm" className="ring-1 ring-white/10">
            {photoURL && <AvatarImage src={photoURL} alt="" />}
            <AvatarFallback className="bg-violet-500/25 text-violet-100">
              {stageName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium text-zinc-200 sm:block">{stageName}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className={`w-56 overflow-hidden rounded-xl p-0 ${SURFACE.overlay}`}>
        <div className="border-b border-white/[0.07] px-4 py-3">
          <p className="text-sm font-semibold text-zinc-100">{stageName}</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">{email}</p>
        </div>
        <div className="p-1.5">
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-300 hover:bg-white/5 hover:text-white"
            onClick={() => auth.signOut()}
          >
            <LogOut className="h-4 w-4 text-zinc-500" />
            Sign Out
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Section header with info popover ─────────────────────────────────────────

function SectionHeader({ title, info }: { title: string; info: string }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-zinc-500 hover:text-zinc-300">
            <Info className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="max-w-sm text-xs leading-relaxed text-zinc-300">{info}</PopoverContent>
      </Popover>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CreatorDashboardPage() {
  const { creatorUser } = useCreatorAuth();
  const searchParams = useSearchParams();
  const crId = searchParams.get("crId");

  const [entries, setEntries] = useState<CampaignEntry[]>([]);
  const [completing, setCompleting] = useState<string | null>(null);
  const [cpEntries, setCpEntries] = useState<CPEntry[]>([]);
  const [cpCompleting, setCpCompleting] = useState<string | null>(null);
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [cpLoaded, setCpLoaded] = useState(false);
  const [detailEntry, setDetailEntry] = useState<CampaignEntry | null>(null);
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
        .filter(e => !(CAMPAIGN_TYPES as readonly string[]).includes(e.type) && e.status !== "Archived")
      );
      setEntriesLoaded(true);
    }, (error) => {
      console.error("[dashboard] campaign-tracking listener error:", error);
    });
    return unsub;
  }, [creatorUser?.creatorID]);

  // Resolve deep-linked CR from ?crId= query param
  useEffect(() => {
    if (!crId || !creatorUser || !entriesLoaded || linkedResolvedRef.current) return;

    const found = entries.find(e => e.id === crId);
    if (found) {
      linkedResolvedRef.current = true;
      setDetailEntry(found);
      return;
    }

    const timer = setTimeout(async () => {
      if (linkedResolvedRef.current) return;
      linkedResolvedRef.current = true;
      try {
        const snap = await getDoc(doc(db, "campaign-tracking", crId));
        if (!snap.exists()) {
          toast.error("Custom request not found.");
        } else if ((snap.data() as Record<string, unknown>).creatorID !== creatorUser.creatorID) {
          setLinkedError("This request belongs to a different account.");
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
      setCpEntries(sortCP(snap.docs.map(d => firestoreToCP(d.id, d.data() as Record<string, unknown>))));
      setCpLoaded(true);
    }, (error) => {
      console.error("[dashboard] content-planning listener error:", error);
    });
    return unsub;
  }, [creatorUser?.creatorID]);

  // ── Content-planning: optimistic complete with clean Undo (revert → Outstanding) ──
  const handleCpComplete = async (id: string) => {
    const removed = cpEntries.find(e => e.id === id);
    if (!removed) return;
    setCpCompleting(id);
    setCpEntries(prev => prev.filter(e => e.id !== id));
    try {
      const res = await apiRequest(`/api/content-planning/${id}/creator-complete`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Marked completed", {
        action: { label: "Undo", onClick: () => revertCp(removed) },
      });
    } catch {
      setCpEntries(prev => sortCP([...prev, removed]));
      toast.error("Failed to mark as completed");
    } finally {
      setCpCompleting(null);
    }
  };

  const revertCp = async (entry: CPEntry) => {
    setCpEntries(prev => prev.some(e => e.id === entry.id) ? prev : sortCP([...prev, entry]));
    try {
      const res = await apiRequest(`/api/content-planning/${entry.id}/creator-complete`, {
        method: "POST",
        body: JSON.stringify({ revert: true }),
      });
      if (!res.ok) throw new Error();
      toast.success("Restored");
    } catch {
      setCpEntries(prev => prev.filter(e => e.id !== entry.id));
      toast.error("Couldn't undo — please try again");
    }
  };

  // ── Customs: deliberate complete (from detail dialog) + Undo (revert → Awaiting Approval) ──
  const handleComplete = async (id: string) => {
    const removed = entries.find(e => e.id === id);
    if (!removed) return;
    setCompleting(id);
    setEntries(prev => prev.filter(e => e.id !== id));
    try {
      const res = await apiRequest(`/api/campaign-tracking/${id}/creator-complete`, {
        method: "POST",
        body: JSON.stringify({ revert: false }),
      });
      if (!res.ok) throw new Error();
      toast.success("Marked completed", {
        action: { label: "Undo", onClick: () => revertCustom(removed) },
      });
    } catch {
      setEntries(prev => [...prev, removed]);
      toast.error("Failed to mark as completed");
    } finally {
      setCompleting(null);
    }
  };

  const revertCustom = async (entry: CampaignEntry) => {
    try {
      const res = await apiRequest(`/api/campaign-tracking/${entry.id}/creator-complete`, {
        method: "POST",
        body: JSON.stringify({ revert: true }),
      });
      if (!res.ok) throw new Error();
      toast.success("Completion reversed — sent back for review");
    } catch {
      toast.error("Couldn't undo — see All Custom Requests");
    }
  };

  const entriesByType = useMemo<Record<CustomType, CampaignEntry[]>>(() => ({
    CR: sortByPriority(entries.filter(e => e.type === "CR")),
    Call: sortByPriority(entries.filter(e => e.type === "Call")),
    Item: sortByPriority(entries.filter(e => e.type === "Item")),
  }), [entries]);

  if (!creatorUser) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "#09090b" }}>
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={PAGE_GROUND_STYLE}>
      {/* Top bar */}
      <header
        className="sticky top-0 z-40 flex h-14 items-center justify-between gap-2 px-3 sm:px-6"
        style={HEADER_STYLE}
      >
        <SidebarTrigger className="text-zinc-400 hover:bg-white/5 hover:text-zinc-100" />
        <img
          src="/logo/bluu_long.svg"
          alt="Bluu Rock"
          className="pointer-events-none absolute left-1/2 top-1/2 h-6 -translate-x-1/2 -translate-y-1/2"
        />
        <ProfileMenu
          stageName={creatorUser.stageName || creatorUser.displayName}
          email={creatorUser.userEmail}
          photoURL={creatorUser.photoURL}
        />
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-3 py-6 sm:gap-8 sm:px-6 sm:py-12">
        {/* Welcome */}
        <div>
          <p className="mb-1 text-xs uppercase tracking-[0.2em] text-zinc-500">Creator Portal</p>
          <h1 className="text-2xl font-semibold text-zinc-100">
            Hey, {creatorUser.stageName || creatorUser.displayName} 👋
          </h1>
        </div>

        {/* Section 1: Custom Requests */}
        <section className="flex flex-col gap-4">
          <SectionHeader
            title="Custom Requests"
            info="These are high-ticket custom requests your fans make. Since they are custom-made, they are sold at a significantly higher price than regular content. It is important that we get this content to them ASAP in order to maintain a good relationship. A fan who is willing to pay for one Custom Request is likely to come back for more!"
          />

          {!entriesLoaded ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-48 rounded-2xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {(["CR", "Call", "Item"] as CustomType[]).map(type => (
                <TypeTile key={type} type={type} entries={entriesByType[type]} onOpen={setDetailEntry} />
              ))}
            </div>
          )}
        </section>

        {/* Section 2: Content Planning */}
        <section className="flex flex-col gap-4">
          <SectionHeader
            title="Content Planning"
            info="This is the content we need to maintain your page. Please try sticking to your due dates as we follow a strict content upload schedule!"
          />

          <div className={`w-full rounded-2xl p-4 ${SURFACE.panel}`}>
            {!cpLoaded ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
              </div>
            ) : cpEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-90 motion-safe:duration-500">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                </div>
                <p className="text-xs text-zinc-400">All caught up — no pending content requests!</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {cpEntries.map(e => (
                  <CPCard
                    key={e.id}
                    entry={e}
                    onComplete={handleCpComplete}
                    completing={cpCompleting === e.id}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Section 3: Google Drive */}
        <section className={`flex flex-col gap-3 rounded-2xl px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 ${SURFACE.panel}`}>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="text-sm font-semibold text-zinc-200">Google Drive Upload Link</h3>
            <p className="text-xs text-zinc-500">
              Your content folder. Please upload content in{" "}
              <span className="font-mono text-zinc-400"># Unsorted</span>.
            </p>
          </div>
          {creatorUser.driveLink ? (
            <a
              href={creatorUser.driveLink}
              target="_blank"
              rel="noreferrer"
              className={`flex items-center justify-center gap-1.5 self-stretch whitespace-nowrap rounded-xl px-4 py-2 text-xs font-semibold transition-colors sm:self-auto ${ACCENT_BTN}`}
            >
              Open Drive <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span className="text-xs text-zinc-500">No link configured.</span>
          )}
        </section>
      </main>

      {/* Custom request detail (shared dialog; also handles deep-linked CR) */}
      {detailEntry && (
        <CustomRequestDialog
          entry={detailEntry}
          open={!!detailEntry}
          onOpenChange={(o) => { if (!o) setDetailEntry(null); }}
          driveLink={creatorUser.driveLink}
          onComplete={() => { handleComplete(detailEntry.id); setDetailEntry(null); }}
          busy={completing === detailEntry.id}
        />
      )}

      {/* Wrong-account error */}
      <CreatorDialog
        open={!!linkedError}
        onOpenChange={(o) => { if (!o) setLinkedError(null); }}
        title="Can't open this request"
        className="sm:max-w-sm"
      >
        <p className="text-sm text-zinc-300">{linkedError}</p>
      </CreatorDialog>
    </div>
  );
}

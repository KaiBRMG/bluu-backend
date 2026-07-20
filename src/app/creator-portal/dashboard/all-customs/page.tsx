"use client";

import { useEffect, useState } from "react";
import { useCreatorAuth } from "@/components/CreatorAuthProvider";
import { db } from "@/firebase-config";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationPrevious, PaginationNext, PaginationLink, PaginationEllipsis,
} from "@/components/ui/pagination";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { MoreHorizontal } from "lucide-react";
import {
  type CampaignEntry, STATUS_COLORS, TYPE_LABELS, formatDueDate, firestoreToEntry, CAMPAIGN_TYPES,
} from "@/lib/campaignTracking";
import { apiRequest } from "@/lib/clientApi";
import { toast } from "sonner";
import { PAGE_GROUND_STYLE, HEADER_STYLE, SURFACE } from "../../theme";
import { CustomRequestDialog } from "../../components/CustomRequestDialog";

const PAGE_SIZE = 20;

export default function AllCustomsPage() {
  const { creatorUser } = useCreatorAuth();
  const [entries, setEntries] = useState<CampaignEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewEntry, setViewEntry] = useState<CampaignEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (!creatorUser) return;
    const q = query(
      collection(db, "campaign-tracking"),
      where("creatorID", "==", creatorUser.creatorID),
      where("status", "in", ["In Progress", "Completed"])
    );
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs
        .map(d => firestoreToEntry(d.id, d.data() as Record<string, unknown>))
        .filter(e => !(CAMPAIGN_TYPES as readonly string[]).includes(e.type) && e.status !== "Archived");
      docs.sort((a, b) => {
        if (a.status !== b.status) return a.status === "In Progress" ? -1 : 1;
        return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
      });
      setEntries(docs);
      setLoading(false);
    }, (error) => {
      console.error("[all-customs] campaign-tracking listener error:", error);
      setLoading(false);
    });
    return unsub;
  }, [creatorUser?.creatorID]);

  const handleStatusChange = async (entry: CampaignEntry, revert: boolean) => {
    setBusy(entry.id);
    try {
      const res = await apiRequest(`/api/campaign-tracking/${entry.id}/creator-complete`, {
        method: "POST",
        body: JSON.stringify({ revert }),
      });
      if (!res.ok) throw new Error();
      toast.success(revert ? "Marked as Awaiting Approval" : "Marked as Completed");
    } catch {
      toast.error("Failed to update status");
    } finally {
      setBusy(null);
    }
  };

  const totalPages = entries.length === 0 ? 1 : Math.ceil(entries.length / PAGE_SIZE);
  const page = Math.min(currentPage, totalPages);
  const pageEntries = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const goTo = (p: number) => setCurrentPage(Math.max(1, Math.min(p, totalPages)));

  return (
    <div className="min-h-screen" style={PAGE_GROUND_STYLE}>
      {/* Top bar */}
      <header
        className="sticky top-0 z-40 flex h-14 items-center gap-2 px-3 sm:px-6"
        style={HEADER_STYLE}
      >
        <SidebarTrigger className="text-zinc-400 hover:bg-white/5 hover:text-zinc-100" />
        <img
          src="/logo/bluu_long.svg"
          alt="Bluu Rock"
          className="pointer-events-none absolute left-1/2 top-1/2 h-6 -translate-x-1/2 -translate-y-1/2"
        />
      </header>

      <main className="mx-auto max-w-5xl px-3 py-6 sm:px-6 sm:py-8">
        <h1 className="mb-4 text-2xl font-semibold sm:mb-6">All Custom Requests</h1>

        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
          </div>
        ) : entries.length === 0 ? (
          <div className={`rounded-2xl p-12 text-center ${SURFACE.panel}`}>
            <p className="text-sm text-zinc-400">No custom requests found.</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className={`hidden overflow-hidden rounded-2xl md:block ${SURFACE.panel}`}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>CR</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Fan Name</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageEntries.map(entry => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-sm text-violet-300">{entry.CR}</TableCell>
                      <TableCell className="text-sm text-zinc-400">{TYPE_LABELS[entry.type]}</TableCell>
                      <TableCell className="text-sm">{entry.fanName}</TableCell>
                      <TableCell className="text-sm text-zinc-400">
                        {entry.dueDate ? `${formatDueDate(entry.dueDate)}${entry.dueDateTimezone ? ` (${entry.dueDateTimezone})` : ""}` : "—"}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[entry.status]}`}>
                          {entry.status}
                        </span>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setViewEntry(entry)}>View</DropdownMenuItem>
                            {entry.status === "In Progress" && (
                              <DropdownMenuItem onClick={() => handleStatusChange(entry, false)}>
                                Mark as Complete
                              </DropdownMenuItem>
                            )}
                            {entry.status === "Completed" && !entry.isArchived && (
                              <DropdownMenuItem onClick={() => handleStatusChange(entry, true)}>
                                Mark as Incomplete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile card list */}
            <div className="flex flex-col gap-2 md:hidden">
              {pageEntries.map(entry => (
                <button
                  key={entry.id}
                  onClick={() => setViewEntry(entry)}
                  className={`flex flex-col gap-2 rounded-xl px-4 py-3 text-left transition-colors active:bg-white/[0.04] ${SURFACE.panel}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold tracking-wider text-violet-300">{entry.CR}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[entry.status]}`}>
                      {entry.status}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <p className="truncate text-sm font-medium text-zinc-100">{entry.fanName}</p>
                    <p className="text-[11px] text-zinc-500">{TYPE_LABELS[entry.type]}</p>
                  </div>
                  {entry.dueDate && (
                    <p className="text-[11px] text-zinc-500">
                      Due {formatDueDate(entry.dueDate)}
                      {entry.dueDateTimezone ? ` (${entry.dueDateTimezone})` : ""}
                    </p>
                  )}
                </button>
              ))}
            </div>

            {totalPages > 1 && (
              <Pagination className="mt-6">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={e => { e.preventDefault(); goTo(page - 1); }}
                      aria-disabled={page === 1}
                      className={page === 1 ? "pointer-events-none opacity-40" : ""}
                    />
                  </PaginationItem>

                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                    .reduce<(number | "ellipsis")[]>((acc, p, idx, arr) => {
                      if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("ellipsis");
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((item, idx) =>
                      item === "ellipsis" ? (
                        <PaginationItem key={`ellipsis-${idx}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      ) : (
                        <PaginationItem key={item}>
                          <PaginationLink
                            href="#"
                            isActive={item === page}
                            onClick={e => { e.preventDefault(); goTo(item); }}
                          >
                            {item}
                          </PaginationLink>
                        </PaginationItem>
                      )
                    )}

                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={e => { e.preventDefault(); goTo(page + 1); }}
                      aria-disabled={page === totalPages}
                      className={page === totalPages ? "pointer-events-none opacity-40" : ""}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </>
        )}
      </main>

      {viewEntry && (
        <CustomRequestDialog
          entry={viewEntry}
          open={!!viewEntry}
          onOpenChange={(o) => { if (!o) setViewEntry(null); }}
          driveLink={creatorUser?.driveLink}
          onComplete={viewEntry.status === "In Progress" ? () => { handleStatusChange(viewEntry, false); setViewEntry(null); } : undefined}
          onIncomplete={viewEntry.status === "Completed" && !viewEntry.isArchived ? () => { handleStatusChange(viewEntry, true); setViewEntry(null); } : undefined}
          busy={busy === viewEntry.id}
        />
      )}
    </div>
  );
}

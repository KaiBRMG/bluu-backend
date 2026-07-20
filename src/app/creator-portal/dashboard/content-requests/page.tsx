"use client";

import { useEffect, useState } from "react";
import { useCreatorAuth } from "@/components/CreatorAuthProvider";
import { db } from "@/firebase-config";
import { collection, query, where, onSnapshot, orderBy } from "firebase/firestore";
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
import { apiRequest } from "@/lib/clientApi";
import { toast } from "sonner";
import { PAGE_GROUND_STYLE, HEADER_STYLE, SURFACE, contentTypeBadge, contentStatusBadge, type ContentType } from "../../theme";
import { ContentPlanDialog, type ContentPlanEntry } from "../../components/ContentPlanDialog";

const PAGE_SIZE = 20;

interface DescriptionRow { qty: string; content: string; }

interface CPEntry extends ContentPlanEntry {
  contentType: ContentType;
  createdAt: string | null;
  isArchived: boolean;
}

function firestoreToCP(id: string, data: Record<string, unknown>): CPEntry {
  const ts = (v: unknown): string | null => {
    if (!v) return null;
    if (typeof (v as { toDate?: unknown }).toDate === "function") return (v as { toDate: () => Date }).toDate().toISOString();
    return null;
  };
  return {
    id,
    contentType: (data.contentType as ContentType) ?? "SFW",
    contentSummary: (data.contentSummary as string) ?? "",
    description: (data.description as DescriptionRow[]) ?? [],
    comment: (data.comment as string) ?? "",
    dueDate: typeof data.dueDate === "string" ? data.dueDate : null,
    createdAt: ts(data.createdAt),
    status: (data.status as "Outstanding" | "Completed") ?? "Outstanding",
    isArchived: (data.isArchived as boolean) ?? false,
  };
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate + "T23:59:59Z") < new Date();
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = dateStr.includes("T") ? new Date(dateStr) : new Date(dateStr + "T12:00:00Z");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return dateStr; }
}

export default function AllContentRequestsPage() {
  const { creatorUser } = useCreatorAuth();
  const [entries, setEntries] = useState<CPEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewEntry, setViewEntry] = useState<CPEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (!creatorUser) return;
    const q = query(
      collection(db, "content-planning"),
      where("creatorID", "==", creatorUser.creatorID),
      where("status", "in", ["Outstanding", "Completed"]),
      orderBy("dueDate", "asc")
    );
    const unsub = onSnapshot(q, snap => {
      setEntries(snap.docs.map(d => firestoreToCP(d.id, d.data() as Record<string, unknown>)));
      setLoading(false);
    }, error => {
      console.error("[content-requests] listener error:", error);
      setLoading(false);
    });
    return unsub;
  }, [creatorUser]);

  const handleMarkComplete = async (entry: CPEntry) => {
    setBusy(entry.id);
    try {
      const res = await apiRequest(`/api/content-planning/${entry.id}/creator-complete`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Marked as completed");
    } catch {
      toast.error("Failed to update status");
    } finally {
      setBusy(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
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
        <h1 className="mb-4 text-2xl font-semibold sm:mb-6">All Content Requests</h1>

        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
          </div>
        ) : entries.length === 0 ? (
          <div className={`rounded-2xl p-12 text-center ${SURFACE.panel}`}>
            <p className="text-sm text-zinc-400">No content requests found.</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className={`hidden overflow-hidden rounded-2xl md:block ${SURFACE.panel}`}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Summary</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageEntries.map(entry => {
                    const overdue = isOverdue(entry.dueDate) && entry.status === "Outstanding";
                    return (
                      <TableRow key={entry.id}>
                        <TableCell className="max-w-[200px] truncate text-sm font-medium">{entry.contentSummary}</TableCell>
                        <TableCell>
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${contentTypeBadge(entry.contentType)}`}>
                            {entry.contentType}
                          </span>
                        </TableCell>
                        <TableCell className={`text-sm ${overdue ? "font-medium text-red-300" : "text-zinc-400"}`}>
                          {formatDate(entry.dueDate)}
                          {overdue && <span className="ml-1 text-xs">· Overdue</span>}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${contentStatusBadge(entry.status)}`}>
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
                              {entry.status === "Outstanding" && (
                                <DropdownMenuItem onClick={() => handleMarkComplete(entry)}>
                                  Mark as Complete
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile card list */}
            <div className="flex flex-col gap-2 md:hidden">
              {pageEntries.map(entry => {
                const overdue = isOverdue(entry.dueDate) && entry.status === "Outstanding";
                return (
                  <button
                    key={entry.id}
                    onClick={() => setViewEntry(entry)}
                    className={`flex flex-col gap-2 rounded-xl px-4 py-3 text-left transition-colors active:bg-white/[0.04] ${SURFACE.panel}`}
                    style={overdue ? { borderColor: "rgba(239,68,68,0.2)" } : undefined}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-zinc-100">
                        {entry.contentSummary}
                      </p>
                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${contentTypeBadge(entry.contentType)}`}>
                        {entry.contentType}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[11px] ${overdue ? "font-medium text-red-300" : "text-zinc-500"}`}>
                        {overdue ? "Overdue · " : "Due "}{formatDate(entry.dueDate)}
                      </span>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${contentStatusBadge(entry.status)}`}>
                        {entry.status}
                      </span>
                    </div>
                  </button>
                );
              })}
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
                        <PaginationItem key={`e-${idx}`}><PaginationEllipsis /></PaginationItem>
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
        <ContentPlanDialog
          entry={viewEntry}
          open={!!viewEntry}
          onOpenChange={(o) => { if (!o) setViewEntry(null); }}
          formatDate={formatDate}
          overdue={isOverdue(viewEntry.dueDate) && viewEntry.status === "Outstanding"}
          onComplete={viewEntry.status === "Outstanding" ? () => { handleMarkComplete(viewEntry); setViewEntry(null); } : undefined}
          busy={busy === viewEntry.id}
        />
      )}
    </div>
  );
}

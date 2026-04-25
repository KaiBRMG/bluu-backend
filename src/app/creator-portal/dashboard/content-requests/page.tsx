"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCreatorAuth } from "@/components/CreatorAuthProvider";
import { db } from "@/firebase-config";
import { collection, query, where, onSnapshot, orderBy } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
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
import { MoreHorizontal, ArrowLeft, CheckCircle2, X } from "lucide-react";
import { apiRequest } from "@/lib/clientApi";
import { toast } from "sonner";
import { createPortal } from "react-dom";

const PAGE_SIZE = 20;

// ─── Types ────────────────────────────────────────────────────────────────────

interface DescriptionRow { qty: string; content: string; }

interface CPEntry {
  id: string;
  contentType: "SFW" | "NSFW";
  contentSummary: string;
  description: DescriptionRow[];
  comment: string;
  dueDate: string | null;
  createdAt: string | null;
  status: "Outstanding" | "Completed";
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
    contentType: (data.contentType as "SFW" | "NSFW") ?? "SFW",
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

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    const d = dateStr.includes("T") ? new Date(dateStr) : new Date(dateStr + "T12:00:00Z");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return dateStr; }
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

interface DetailModalProps {
  entry: CPEntry;
  onClose: () => void;
  onMarkComplete?: () => void;
}

function DetailModal({ entry, onClose, onMarkComplete }: DetailModalProps) {
  const overdue = isOverdue(entry.dueDate) && entry.status === "Outstanding";
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <Card
        className="w-full max-w-md max-h-[85vh] overflow-y-auto"
        style={{ background: "#111113", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-6 pt-6 pb-0">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-base text-zinc-100">{entry.contentSummary}</CardTitle>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${
              entry.contentType === "NSFW" ? "bg-orange-500/15 text-orange-400" : "bg-blue-500/15 text-blue-400"
            }`}>
              {entry.contentType}
            </span>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <CardContent className="flex flex-col gap-4 pt-4">
          {/* Status */}
          <span className={`self-start inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            entry.status === "Completed" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
          }`}>
            {entry.status}
          </span>

          {/* Description */}
          {entry.description.some(r => r.qty || r.content) && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Description</p>
              <div className="flex flex-col gap-0.5">
                {entry.description.filter(r => r.qty || r.content).map((r, i) => (
                  <p key={i} className="text-sm text-zinc-300">
                    <span className="font-medium">{r.qty}</span>
                    {r.qty && r.content ? " × " : ""}
                    {r.content}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Comment */}
          {entry.comment && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Comment</p>
              <p className="text-sm text-zinc-300 leading-relaxed">{entry.comment}</p>
            </div>
          )}

          {/* Dates */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
            <div>
              <p className="uppercase tracking-wider text-zinc-500 mb-0.5">Due Date</p>
              <p className={overdue ? "text-red-400 font-medium" : "text-zinc-300"}>
                {overdue ? "Overdue · " : ""}{formatDate(entry.dueDate)}
              </p>
            </div>
            <div>
              <p className="uppercase tracking-wider text-zinc-500 mb-0.5">Created</p>
              <p className="text-zinc-300">{formatDate(entry.createdAt)}</p>
            </div>
          </div>
        </CardContent>

        {onMarkComplete && (
          <CardFooter className="flex gap-2 pt-0">
            <Button
              onClick={() => { onMarkComplete(); onClose(); }}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold h-9 rounded-lg"
              style={{
                background: "linear-gradient(135deg, #059669, #10b981)",
                color: "white",
                boxShadow: "0 0 12px rgba(16,185,129,0.35)",
              }}
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Completed
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>,
    document.body
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AllContentRequestsPage() {
  const { creatorUser } = useCreatorAuth();
  const router = useRouter();
  const [entries, setEntries] = useState<CPEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewEntry, setViewEntry] = useState<CPEntry | null>(null);
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
    try {
      const res = await apiRequest(`/api/content-planning/${entry.id}/creator-complete`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Marked as completed");
    } catch {
      toast.error("Failed to update status");
    }
  };

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const page = Math.min(currentPage, totalPages);
  const pageEntries = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const goTo = (p: number) => setCurrentPage(Math.max(1, Math.min(p, totalPages)));

  return (
    <div className="min-h-screen" style={{ background: "#09090b", color: "white" }}>
      {/* Top bar */}
      <header
        className="sticky top-0 z-40 flex items-center gap-3 px-4 sm:px-6 h-14"
        style={{
          background: "rgba(9,9,11,0.9)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <Button
          variant="ghost"
          className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white h-auto px-2 py-1"
          onClick={() => router.push("/creator-portal/dashboard")}
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Button>
        <span className="text-zinc-700">/</span>
        <span className="text-sm font-medium text-zinc-300">All Content Requests</span>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-semibold mb-6">All Content Requests</h1>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div
            className="rounded-2xl p-12 text-center"
            style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <p className="text-zinc-500 text-sm">No content requests found.</p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
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
                        <TableCell className="text-sm font-medium max-w-[200px] truncate">{entry.contentSummary}</TableCell>
                        <TableCell>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${
                            entry.contentType === "NSFW" ? "bg-orange-500/15 text-orange-400" : "bg-blue-500/15 text-blue-400"
                          }`}>
                            {entry.contentType}
                          </span>
                        </TableCell>
                        <TableCell className={`text-sm ${overdue ? "text-red-400 font-medium" : "text-zinc-400"}`}>
                          {formatDate(entry.dueDate)}
                          {overdue && <span className="ml-1 text-xs">· Overdue</span>}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            entry.status === "Completed" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
                          }`}>
                            {entry.status}
                          </span>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="w-4 h-4" />
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
        <DetailModal
          entry={viewEntry}
          onClose={() => setViewEntry(null)}
          onMarkComplete={viewEntry.status === "Outstanding" ? () => handleMarkComplete(viewEntry) : undefined}
        />
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCreatorAuth } from "@/components/CreatorAuthProvider";
import { db } from "@/firebase-config";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
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
import { MoreHorizontal, ArrowLeft, ExternalLink } from "lucide-react";
import { type CampaignEntry, STATUS_COLORS, TYPE_LABELS, formatAmount, formatDueDate, firestoreToEntry } from "@/lib/campaignTracking";
import { apiRequest } from "@/lib/clientApi";
import { toast } from "sonner";
const PAGE_SIZE = 20;

// ─── Detail View Card ─────────────────────────────────────────────────────────

interface DetailCardProps {
  entry: CampaignEntry;
  onClose: () => void;
  onMarkComplete?: () => void;
  onMarkIncomplete?: () => void;
}

function DetailCard({ entry, onClose, onMarkComplete, onMarkIncomplete }: DetailCardProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 overflow-y-auto py-8">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{entry.CR}</CardTitle>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[entry.status]}`}>
              {entry.status}
            </span>
          </div>
          <p className="text-sm text-zinc-400">{TYPE_LABELS[entry.type]}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 max-h-[55vh] overflow-y-auto">
          <Row label="Fan Name" value={entry.fanName} />
          {entry.profileLink && (
            <div>
              <p className="text-xs text-zinc-500 mb-0.5">Profile</p>
              <a href={entry.profileLink} target="_blank" rel="noreferrer" className="text-sm text-violet-400 flex items-center gap-1 hover:text-violet-300 transition-colors">
                View Profile <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
          <Row label="Description" value={entry.description} />
          {entry.dueDate && (
            <Row label="Due Date" value={`${formatDueDate(entry.dueDate)}${entry.dueDateTimezone ? ` (${entry.dueDateTimezone})` : ""}`} />
          )}
          {(entry.type === "CR" || entry.type === "Call") && entry.length && <Row label="Length" value={entry.length} />}
          {entry.type === "Call" && entry.socialPlatform && <Row label="Social Platform" value={entry.socialPlatform} />}
          {entry.type === "Call" && entry.socialUsername && <Row label="Social Username" value={entry.socialUsername} />}
          {entry.type === "Item" && entry.address && <Row label="Address" value={entry.address} />}
          <Row label="Total Amount" value={formatAmount(entry.totalAmount)} />
          <Row label="Amount Paid" value={formatAmount(entry.amountPaid)} />
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {onMarkComplete && (
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => { onMarkComplete(); onClose(); }}
            >
              Mark as Complete
            </Button>
          )}
          {onMarkIncomplete && (
            <Button variant="outline" onClick={() => { onMarkIncomplete(); onClose(); }}>
              Mark as Incomplete
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-sm text-zinc-200">{value}</p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AllCustomsPage() {
  const { creatorUser } = useCreatorAuth();
  const router = useRouter();
  const [entries, setEntries] = useState<CampaignEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewEntry, setViewEntry] = useState<CampaignEntry | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  useEffect(() => {
    if (!creatorUser) return;
    const q = query(
      collection(db, "campaign-tracking"),
      where("creatorID", "==", creatorUser.creatorID),
      where("status", "in", ["In Progress", "Completed"])
    );
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => firestoreToEntry(d.id, d.data() as Record<string, unknown>));
      docs.sort((a, b) => {
        if (a.status !== b.status) return a.status === "In Progress" ? -1 : 1;
        return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
      });
      setEntries(docs);
      setLoading(false);
    }, (error) => {
      console.error('[all-customs] campaign-tracking listener error:', error);
      setLoading(false);
    });
    return unsub;
  }, [creatorUser?.creatorID]);

  const handleStatusChange = async (entry: CampaignEntry, revert: boolean) => {
    try {
      const res = await apiRequest(`/api/campaign-tracking/${entry.id}/creator-complete`, {
        method: "POST",
        body: JSON.stringify({ revert }),
      });
      if (!res.ok) throw new Error();
      toast.success(revert ? "Marked as Awaiting Approval" : "Marked as Completed");
    } catch {
      toast.error("Failed to update status");
    }
  };

  const totalPages = entries.length === 0 ? 1 : Math.ceil(entries.length / PAGE_SIZE);
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
        <span className="text-sm font-medium text-zinc-300">All Custom Requests</span>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-semibold mb-6">All Custom Requests</h1>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div
            className="rounded-2xl p-12 text-center"
            style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <p className="text-zinc-500 text-sm">No custom requests found.</p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
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
                              <MoreHorizontal className="w-4 h-4" />
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
        <DetailCard
          entry={viewEntry}
          onClose={() => setViewEntry(null)}
          onMarkComplete={viewEntry.status === "In Progress" ? () => handleStatusChange(viewEntry, false) : undefined}
          onMarkIncomplete={viewEntry.status === "Completed" && !viewEntry.isArchived ? () => handleStatusChange(viewEntry, true) : undefined}
        />
      )}
    </div>
  );
}

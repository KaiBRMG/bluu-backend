"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import { useCreators } from "@/hooks/useCreators";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationPrevious, PaginationNext, PaginationLink, PaginationEllipsis,
} from "@/components/ui/pagination";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Plus, MoreHorizontal, Check, CalendarIcon, X } from "lucide-react";
import { collection, query, where, onSnapshot, orderBy } from "firebase/firestore";
import { db } from "@/firebase-config";
import { useUserData } from "@/hooks/useUserData";
import { apiRequest } from "@/lib/clientApi";
import { toast } from "sonner";
import type { Creator } from "@/lib/campaignTracking";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DescriptionRow { qty: string; content: string; }

interface CPEntry {
  id: string;
  contentType: "SFW" | "NSFW" | "OF TL" | "PPV" | "Dripfeed";
  contentSummary: string;
  description: DescriptionRow[];
  comment: string;
  dueDate: string | null;
  createdAt: string | null;
  completedAt: string | null;
  status: "Outstanding" | "Completed";
  creatorID: string;
  isArchived: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const inputClass = "w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500";

function firestoreToCP(id: string, data: Record<string, unknown>): CPEntry {
  const ts = (v: unknown) => {
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
    dueDate: typeof data.dueDate === "string" ? data.dueDate : ts(data.dueDate),
    createdAt: ts(data.createdAt),
    completedAt: ts(data.completedAt),
    status: (data.status as "Outstanding" | "Completed") ?? "Outstanding",
    creatorID: (data.creatorID as string) ?? "",
    isArchived: (data.isArchived as boolean) ?? false,
  };
}

function formatDate(isoOrDateStr: string | null, userTz?: string): string {
  if (!isoOrDateStr) return "—";
  try {
    const d = isoOrDateStr.includes("T") ? new Date(isoOrDateStr) : new Date(isoOrDateStr + "T12:00:00Z");
    return d.toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      timeZone: userTz ?? "UTC",
    });
  } catch { return isoOrDateStr; }
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate.includes("T") ? dueDate : dueDate + "T23:59:59Z");
  return due < new Date();
}

function StatusBadge({ status }: { status: "Outstanding" | "Completed" }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
      status === "Completed"
        ? "bg-emerald-500/15 text-emerald-400"
        : "bg-red-500/15 text-red-400"
    }`}>
      {status}
    </span>
  );
}

function ContentTypeBadge({ type }: { type: "SFW" | "NSFW" | "OF TL" | "PPV" | "Dripfeed" }) {
  const styles: Record<string, string> = {
    NSFW: "bg-orange-500/15 text-orange-400",
    SFW: "bg-blue-500/15 text-blue-400",
    "OF TL": "bg-purple-500/15 text-purple-400",
    PPV: "bg-pink-500/15 text-pink-400",
    Dripfeed: "bg-teal-500/15 text-teal-400",
  };
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ${styles[type] ?? "bg-zinc-500/15 text-zinc-400"}`}>
      {type}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="text-xs text-zinc-400 mb-1">{label}</p>{children}</div>;
}

// ─── Date Picker ──────────────────────────────────────────────────────────────

function DatePickerInput({ value, onChange, className }: {
  value: string; onChange: (v: string) => void; className?: string;
}) {
  const dateObj = value ? new Date(value + "T12:00:00") : undefined;
  const label = dateObj?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={`${className ?? inputClass} flex items-center gap-2 text-left`}>
          <CalendarIcon className="w-4 h-4 text-zinc-400 shrink-0" />
          {label ?? <span className="text-zinc-500">Pick a date</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={dateObj}
          onSelect={d => {
            if (!d) { onChange(""); return; }
            onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

// ─── Description Editor ───────────────────────────────────────────────────────

function DescriptionEditor({ rows, onChange }: {
  rows: DescriptionRow[];
  onChange: (rows: DescriptionRow[]) => void;
}) {
  const setRow = (i: number, field: keyof DescriptionRow) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = rows.map((r, idx) => idx === i ? { ...r, [field]: e.target.value } : r);
    onChange(next);
  };
  const addRow = () => onChange([...rows, { qty: "", content: "" }]);
  const removeRow = (i: number) => {
    if (rows.length === 1) return;
    onChange(rows.filter((_, idx) => idx !== i));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-1" style={{ gridTemplateColumns: "80px 1fr 24px" }}>
        <p className="text-xs text-zinc-500">Qty.</p>
        <p className="text-xs text-zinc-500">Content</p>
        <span />
      </div>
      {rows.map((row, i) => (
        <div key={i} className="grid gap-2 items-center" style={{ gridTemplateColumns: "80px 1fr 24px" }}>
          <input
            value={row.qty}
            onChange={setRow(i, "qty")}
            placeholder="5"
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <input
            value={row.content}
            onChange={setRow(i, "content")}
            placeholder="Selfies"
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <button
            type="button"
            onClick={() => removeRow(i)}
            className="text-zinc-600 hover:text-zinc-400 flex items-center justify-center"
            aria-label="Remove row"
            disabled={rows.length === 1}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="self-start text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1 transition-colors mt-1"
      >
        <Plus className="w-3.5 h-3.5" /> Add row
      </button>
    </div>
  );
}

// ─── Detail View / Edit Dialog ────────────────────────────────────────────────

interface DetailDialogProps {
  entry: CPEntry;
  creatorName: string;
  creators: Creator[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

function DetailDialog({ entry, creatorName, creators, onClose, onSaved, onDeleted }: DetailDialogProps) {
  const { userData } = useUserData();
  const userTz = userData?.timezone || undefined;

  const initDesc = entry.description.length > 0 ? entry.description : [{ qty: "", content: "" }];

  const [fields, setFields] = useState({
    contentType: entry.contentType as "SFW" | "NSFW" | "OF TL" | "PPV" | "Dripfeed",
    contentSummary: entry.contentSummary,
    description: initDesc as DescriptionRow[],
    comment: entry.comment,
    dueDate: entry.dueDate?.split("T")[0] ?? "",
    creatorID: entry.creatorID,
  });

  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const hasChanged =
    fields.contentType !== entry.contentType ||
    fields.contentSummary !== entry.contentSummary ||
    fields.comment !== entry.comment ||
    fields.dueDate !== (entry.dueDate?.split("T")[0] ?? "") ||
    fields.creatorID !== entry.creatorID ||
    JSON.stringify(fields.description) !== JSON.stringify(initDesc);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiRequest(`/api/content-planning/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error();
      toast.success("Saved");
      onSaved();
      onClose();
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleMarkComplete = async () => {
    setCompleting(true);
    try {
      const res = await apiRequest(`/api/content-planning/${entry.id}/manager-complete`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Marked as complete");
      onSaved();
      onClose();
    } catch {
      toast.error("Failed");
    } finally {
      setCompleting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await apiRequest(`/api/content-planning/${entry.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Deleted");
      onDeleted();
      onClose();
    } catch {
      toast.error("Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  const setField = <K extends keyof typeof fields>(k: K) => (v: (typeof fields)[K]) =>
    setFields(prev => ({ ...prev, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card className="w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
        <CardHeader className="shrink-0 pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-lg truncate">{entry.contentSummary || "Content Request"}</CardTitle>
            <StatusBadge status={entry.status} />
          </div>
          <p className="text-sm text-zinc-400">{creatorName}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 overflow-y-auto flex-1 pt-0">
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-zinc-800 bg-zinc-900/50 text-xs text-zinc-500">
            <div><p className="mb-0.5">Created</p><p className="text-zinc-300">{formatDate(entry.createdAt, userTz)}</p></div>
            <div><p className="mb-0.5">Completed</p><p className="text-zinc-300">{formatDate(entry.completedAt, userTz)}</p></div>
          </div>
          <Field label="Summary of required content">
            <Input
              value={fields.contentSummary}
              onChange={e => setField("contentSummary")(e.target.value)}
              placeholder="Instagram Content"
              className="bg-zinc-800 border-zinc-700 text-white"
            />
          </Field>
          <Field label="Content Type">
            <Select value={fields.contentType} onValueChange={v => setField("contentType")(v as "SFW" | "NSFW" | "OF TL" | "PPV" | "Dripfeed")}>
              <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SFW">SFW</SelectItem>
                <SelectItem value="NSFW">NSFW</SelectItem>
                <SelectItem value="OF TL">OF TL</SelectItem>
                <SelectItem value="PPV">PPV</SelectItem>
                <SelectItem value="Dripfeed">Dripfeed</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Creator">
            <Select value={fields.creatorID} onValueChange={v => setField("creatorID")(v)}>
              <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                {creators.map(c => <SelectItem key={c.creatorID} value={c.creatorID}>{c.stageName}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs text-zinc-400">Due Date</p>
              {isOverdue(entry.dueDate) && entry.status === "Outstanding" && (
                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-500/15 text-red-400">
                  <span className="size-1.5 rounded-full bg-red-400" />
                  Overdue
                </span>
              )}
            </div>
            <DatePickerInput value={fields.dueDate} onChange={v => setField("dueDate")(v)} />
          </div>
          <Field label="Description">
            <DescriptionEditor
              rows={fields.description}
              onChange={v => setField("description")(v)}
            />
          </Field>
          <Field label="Comment">
            <textarea
              value={fields.comment}
              onChange={e => setField("comment")(e.target.value)}
              rows={3}
              placeholder="Additional instructions, e.g. wear sunglasses and smile."
              className={`${inputClass} resize-none`}
            />
          </Field>
        </CardContent>
        <CardFooter className="flex justify-between gap-2 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">Actions</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={() => setShowCompleteConfirm(true)}
                disabled={completing || entry.status === "Completed"}
              >
                Mark as Complete
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={deleting}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !hasChanged}>
              {saving ? "Saving..." : "Update"}
            </Button>
          </div>
        </CardFooter>
      </Card>

      <AlertDialog open={showCompleteConfirm} onOpenChange={open => { if (!open) setShowCompleteConfirm(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as Complete?</AlertDialogTitle>
            <AlertDialogDescription>This will mark the content request as completed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={completing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleMarkComplete} disabled={completing}>
              {completing ? "Completing..." : "Mark as Complete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>This action is permanent and cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleting}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── New Entry Wizard ─────────────────────────────────────────────────────────

function NewEntryWizard({ creators, onClose, onCreated }: {
  creators: Creator[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    contentSummary: "",
    contentType: "SFW" as "SFW" | "NSFW" | "OF TL" | "PPV" | "Dripfeed",
    dueDate: "",
    description: [{ qty: "", content: "" }] as DescriptionRow[],
    comment: "",
    creatorID: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const setField = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const canNext = !!(form.contentSummary.trim() && form.creatorID);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await apiRequest("/api/content-planning", {
        method: "POST",
        body: JSON.stringify(form),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed"); }
      toast.success("Content request created");
      onCreated();
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Failed to create");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCreator = creators.find(c => c.creatorID === form.creatorID);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{step === 1 ? "New Content Request" : "Confirm & Submit"}</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="flex flex-col gap-4 py-2 max-h-[65vh] overflow-y-auto pr-1">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Summary of the required content</label>
              <Input
                value={form.contentSummary}
                onChange={e => setField("contentSummary")(e.target.value)}
                placeholder="Instagram Content"
                className="bg-zinc-800 border-zinc-700 text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Content Type</label>
              <Select value={form.contentType} onValueChange={v => setField("contentType")(v as "SFW" | "NSFW" | "OF TL" | "PPV" | "Dripfeed")}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SFW">SFW</SelectItem>
                  <SelectItem value="NSFW">NSFW</SelectItem>
                  <SelectItem value="OF TL">OF TL</SelectItem>
                  <SelectItem value="PPV">PPV</SelectItem>
                  <SelectItem value="Dripfeed">Dripfeed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Creator</label>
              <Select value={form.creatorID} onValueChange={v => setField("creatorID")(v)}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue placeholder="Select creator..." /></SelectTrigger>
                <SelectContent>
                  {creators.map(c => <SelectItem key={c.creatorID} value={c.creatorID}>{c.stageName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Due Date</label>
              <DatePickerInput value={form.dueDate} onChange={v => setField("dueDate")(v)} />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Description</label>
              <DescriptionEditor rows={form.description} onChange={v => setField("description")(v)} />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Comment</label>
              <textarea
                value={form.comment}
                onChange={e => setField("comment")(e.target.value)}
                rows={3}
                placeholder="Additional instructions, e.g. wear sunglasses and smile."
                className={`${inputClass} resize-none`}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => setStep(2)} disabled={!canNext}>Next</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-xs text-amber-400 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              Please notify the creator of a new content request.
            </p>
            <div className="flex flex-col gap-2 text-sm">
              {[
                ["Creator", selectedCreator?.stageName ?? "—"],
                ["Summary", form.contentSummary],
                ["Type", form.contentType],
                ["Due Date", form.dueDate ? new Date(form.dueDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"],
                ["Comment", form.comment || "—"],
              ].map(([l, v]) => (
                <div key={l} className="flex justify-between gap-4">
                  <span className="text-zinc-500 shrink-0">{l}</span>
                  <span className="text-right text-zinc-200">{v}</span>
                </div>
              ))}
              {form.description.some(r => r.qty || r.content) && (
                <div>
                  <p className="text-zinc-500 mb-1">Description</p>
                  {form.description.filter(r => r.qty || r.content).map((r, i) => (
                    <p key={i} className="text-zinc-200">{r.qty} × {r.content}</p>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Submitting..." : "Submit"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Creator Content Table ────────────────────────────────────────────────────

function CreatorContentTable({ creatorID, creatorName, creators, isActive }: {
  creatorID: string;
  creatorName: string;
  creators: Creator[];
  isActive: boolean;
}) {
  const { userData } = useUserData();
  const userTz = userData?.timezone || undefined;
  const [entries, setEntries] = useState<CPEntry[]>([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [viewEntry, setViewEntry] = useState<CPEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CPEntry | null>(null);
  const [markCompleteTarget, setMarkCompleteTarget] = useState<CPEntry | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const unsubRef = useRef<(() => void) | null>(null);

  const subscribe = useCallback(() => {
    if (unsubRef.current) unsubRef.current();
    const statusFilter: ("Outstanding" | "Completed")[] = showCompleted
      ? ["Outstanding", "Completed"]
      : ["Outstanding"];

    const q = query(
      collection(db, "content-planning"),
      where("creatorID", "==", creatorID),
      where("status", "in", statusFilter),
      orderBy("dueDate", "asc")
    );
    unsubRef.current = onSnapshot(q, snap => {
      setEntries(snap.docs.map(d => firestoreToCP(d.id, d.data() as Record<string, unknown>)));
    });
  }, [creatorID, showCompleted]);

  useEffect(() => {
    if (!isActive) {
      unsubRef.current?.();
      unsubRef.current = null;
      return;
    }
    subscribe();
    return () => { unsubRef.current?.(); };
  }, [isActive, subscribe]);

  useEffect(() => { setCurrentPage(1); }, [showCompleted]);

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const page = Math.min(currentPage, totalPages);
  const pageEntries = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const goTo = (p: number) => setCurrentPage(Math.max(1, Math.min(p, totalPages)));

  const handleMarkComplete = async (entry: CPEntry) => {
    setActionLoading(true);
    try {
      const res = await apiRequest(`/api/content-planning/${entry.id}/manager-complete`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Marked as complete");
    } catch { toast.error("Failed"); }
    setMarkCompleteTarget(null);
    setActionLoading(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      const res = await apiRequest(`/api/content-planning/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Deleted");
    } catch { toast.error("Failed to delete"); }
    setDeleteTarget(null);
    setActionLoading(false);
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2 ml-auto">
          <Switch
            checked={showCompleted}
            onCheckedChange={setShowCompleted}
            id={`cp-show-completed-${creatorID}`}
          />
          <label htmlFor={`cp-show-completed-${creatorID}`} className="text-sm text-zinc-400 cursor-pointer">
            Show Completed
          </label>
          <Button size="sm" onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg p-8 text-center" style={{ background: "var(--sidebar-background)", border: "1px solid var(--border-subtle)" }}>
          <p className="text-sm text-muted-foreground">No content requests found.</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
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
                    <TableCell><ContentTypeBadge type={entry.contentType} /></TableCell>
                    <TableCell className={`text-sm ${overdue ? "text-red-400 font-medium" : "text-zinc-400"}`}>
                      {formatDate(entry.dueDate, userTz)}
                      {overdue && <span className="ml-1 text-xs">· Overdue</span>}
                    </TableCell>
                    <TableCell><StatusBadge status={entry.status} /></TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setViewEntry(entry)}>View</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setMarkCompleteTarget(entry)}
                            disabled={actionLoading || entry.status === "Completed"}
                          >
                            <Check className="w-4 h-4 mr-2" /> Mark as Complete
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget(entry)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <Pagination className="mt-4">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href="#" onClick={e => { e.preventDefault(); goTo(page - 1); }}
                aria-disabled={page === 1} className={page === 1 ? "pointer-events-none opacity-40" : ""} />
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
                    <PaginationLink href="#" isActive={item === page} onClick={e => { e.preventDefault(); goTo(item); }}>
                      {item}
                    </PaginationLink>
                  </PaginationItem>
                )
              )}
            <PaginationItem>
              <PaginationNext href="#" onClick={e => { e.preventDefault(); goTo(page + 1); }}
                aria-disabled={page === totalPages} className={page === totalPages ? "pointer-events-none opacity-40" : ""} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      {showNew && (
        <NewEntryWizard creators={creators} onClose={() => setShowNew(false)} onCreated={() => {}} />
      )}

      {viewEntry && (
        <DetailDialog
          entry={viewEntry}
          creatorName={creatorName}
          creators={creators}
          onClose={() => setViewEntry(null)}
          onSaved={() => setViewEntry(null)}
          onDeleted={() => setViewEntry(null)}
        />
      )}

      <AlertDialog open={!!markCompleteTarget} onOpenChange={open => { if (!open) setMarkCompleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as Complete?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the content request as completed. The creator will not be notified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => markCompleteTarget && handleMarkComplete(markCompleteTarget)}
              disabled={actionLoading}
            >
              <Check className="w-4 h-4 mr-1" /> Mark as Complete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>This action is permanent and cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={actionLoading}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ creators, isActive }: { creators: Creator[]; isActive: boolean }) {
  const { userData } = useUserData();
  const userTz = userData?.timezone || undefined;
  const [completedEntries, setCompletedEntries] = useState<CPEntry[]>([]);
  const [outstandingEntries, setOutstandingEntries] = useState<CPEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewEntry, setViewEntry] = useState<CPEntry | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [dismissAllOpen, setDismissAllOpen] = useState(false);
  const [dismissAllLoading, setDismissAllLoading] = useState(false);
  const completedUnsubRef = useRef<(() => void) | null>(null);
  const outstandingUnsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isActive) {
      completedUnsubRef.current?.();
      completedUnsubRef.current = null;
      outstandingUnsubRef.current?.();
      outstandingUnsubRef.current = null;
      return;
    }
    if (completedUnsubRef.current) completedUnsubRef.current();
    const q = query(
      collection(db, "content-planning"),
      where("status", "==", "Completed"),
      where("isArchived", "==", false),
      orderBy("createdAt", "desc")
    );
    completedUnsubRef.current = onSnapshot(q, snap => {
      setCompletedEntries(snap.docs.map(d => firestoreToCP(d.id, d.data() as Record<string, unknown>)));
      setLoading(false);
    });

    if (outstandingUnsubRef.current) outstandingUnsubRef.current();
    const q2 = query(
      collection(db, "content-planning"),
      where("status", "==", "Outstanding"),
      where("isArchived", "==", false),
      orderBy("dueDate", "asc")
    );
    outstandingUnsubRef.current = onSnapshot(q2, snap => {
      setOutstandingEntries(snap.docs.map(d => firestoreToCP(d.id, d.data() as Record<string, unknown>)));
    });

    return () => {
      completedUnsubRef.current?.();
      outstandingUnsubRef.current?.();
    };
  }, [isActive]);

  const creatorMap = Object.fromEntries(creators.map(c => [c.creatorID, c.stageName]));

  // Kanban: one column per active creator that has outstanding entries
  const byCreator: Record<string, CPEntry[]> = {};
  for (const e of outstandingEntries) {
    if (!byCreator[e.creatorID]) byCreator[e.creatorID] = [];
    byCreator[e.creatorID].push(e);
  }
  const kanbanCreators = creators.filter(c => (byCreator[c.creatorID]?.length ?? 0) > 0);

  // Kanban: one column per creator that has completed entries
  const completedByCreator: Record<string, CPEntry[]> = {};
  for (const e of completedEntries) {
    if (!completedByCreator[e.creatorID]) completedByCreator[e.creatorID] = [];
    completedByCreator[e.creatorID].push(e);
  }
  const completedKanbanCreators = creators.filter(c => (completedByCreator[c.creatorID]?.length ?? 0) > 0);

  const handleDismiss = async (id: string) => {
    try {
      const res = await apiRequest(`/api/content-planning/${id}/dismiss`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Dismissed");
    } catch { toast.error("Failed to dismiss"); }
  };

  const handleDismissAll = async () => {
    setDismissAllLoading(true);
    try {
      const res = await apiRequest("/api/content-planning/dismiss-all", { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("All dismissed");
      setDismissAllOpen(false);
    } catch { toast.error("Failed to dismiss all"); }
    setDismissAllLoading(false);
  };

  if (loading) return <div className="text-sm text-zinc-500 p-8">Loading...</div>;

  return (
    <div className="flex flex-col gap-6 min-w-0">
      {/* Toolbar */}
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4 mr-1" /> New
        </Button>
      </div>

      {/* Recently Completed */}
      <div className="rounded-xl p-4 border border-emerald-500/30 bg-emerald-500/5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-emerald-400">Recently Completed</h3>
          {completedEntries.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDismissAllOpen(true)}>
              Dismiss All
            </Button>
          )}
        </div>
        {completedEntries.length === 0 ? (
          <p className="text-sm text-zinc-500">No completed content to review.</p>
        ) : (
          <div style={{ columnWidth: "13rem", columnCount: 4, columnGap: "0.75rem" }}>
            {completedKanbanCreators.map(creator => (
              <div
                key={creator.creatorID}
                className="break-inside-avoid mb-3 flex flex-col gap-1.5 rounded-xl p-2.5"
                style={{
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Avatar className="size-4 shrink-0">
                      <AvatarImage src={creator.photoURL ?? undefined} />
                      <AvatarFallback className="text-[8px]">{creator.stageName.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <p className="text-sm font-semibold text-zinc-300 truncate">{creator.stageName}</p>
                  </div>
                  <span className="text-xs text-zinc-500 shrink-0">{completedByCreator[creator.creatorID].length}</span>
                </div>
                {completedByCreator[creator.creatorID].map(e => (
                  <div
                    key={e.id}
                    className="flex flex-col gap-1.5 rounded-md border-l-2 py-1.5 pl-2 pr-1.5"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      borderLeftColor: "rgba(255,255,255,0.14)",
                    }}
                  >
                    <button
                      onClick={() => setViewEntry(e)}
                      className="text-left truncate text-xs font-medium text-zinc-200 hover:text-white hover:underline underline-offset-2 transition-colors"
                    >
                      {e.contentSummary}
                    </button>
                    <Button size="sm" variant="outline" className="h-6 w-full text-[10px]" onClick={() => handleDismiss(e.id)}>
                      Dismiss
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending Content — Kanban */}
      <div className="rounded-xl p-4 border border-zinc-700/50 bg-zinc-900/30">
        <h3 className="text-sm font-semibold text-zinc-300 mb-4">Pending Content</h3>
        {kanbanCreators.length === 0 ? (
          <p className="text-sm text-zinc-500">No outstanding content requests.</p>
        ) : (
          <div style={{ columnWidth: "13rem", columnCount: 4, columnGap: "0.75rem" }}>
            {kanbanCreators.map(creator => (
              <div
                key={creator.creatorID}
                className="break-inside-avoid mb-3 flex flex-col gap-1.5 rounded-xl p-2.5"
                style={{
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Avatar className="size-4 shrink-0">
                      <AvatarImage src={creator.photoURL ?? undefined} />
                      <AvatarFallback className="text-[8px]">{creator.stageName.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <p className="text-sm font-semibold text-zinc-300 truncate">{creator.stageName}</p>
                  </div>
                  <span className="text-xs text-zinc-500 shrink-0">{byCreator[creator.creatorID].length}</span>
                </div>
                {byCreator[creator.creatorID].map(entry => {
                  const overdue = isOverdue(entry.dueDate);
                  return (
                    <button
                      key={entry.id}
                      onClick={() => setViewEntry(entry)}
                      className="flex items-center gap-2 text-left rounded-md border-l-2 py-1.5 pl-2 pr-1.5 transition-all hover:brightness-110 active:scale-[0.98]"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        borderLeftColor: overdue ? "rgb(239,68,68)" : "rgba(255,255,255,0.14)",
                      }}
                    >
                      <span className="flex-1 min-w-0 truncate text-xs font-medium text-zinc-200">{entry.contentSummary}</span>
                      {(overdue || entry.dueDate) && (
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            overdue ? "bg-red-500/15 text-red-400" : "bg-white/5 text-zinc-400"
                          }`}
                        >
                          {overdue ? "Overdue" : formatDate(entry.dueDate, userTz)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {showNew && (
        <NewEntryWizard creators={creators} onClose={() => setShowNew(false)} onCreated={() => {}} />
      )}

      {viewEntry && (
        <DetailDialog
          entry={viewEntry}
          creatorName={creatorMap[viewEntry.creatorID] ?? viewEntry.creatorID}
          creators={creators}
          onClose={() => setViewEntry(null)}
          onSaved={() => setViewEntry(null)}
          onDeleted={() => setViewEntry(null)}
        />
      )}

      <AlertDialog open={dismissAllOpen} onOpenChange={setDismissAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dismiss all completed content?</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive all {completedEntries.length} completed content request{completedEntries.length !== 1 ? "s" : ""}. They will no longer appear in this list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dismissAllLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDismissAll} disabled={dismissAllLoading}>
              {dismissAllLoading ? "Dismissing..." : "Dismiss All"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  ); 
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ContentPlanningPage() {
  const creators = useCreators();
  const [activeTab, setActiveTab] = useState("overview");
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(() => new Set(["overview"]));

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setLoadedTabs(prev => (prev.has(value) ? prev : new Set(prev).add(value)));
  };

  return (
    <AppLayout>
      <div className="max-w-7xl min-w-0">
        <h1 className="text-2xl font-bold tracking-tight mb-2">Content Planning</h1>

        <div className="mt-6 flex items-center gap-3">
          <label htmlFor="creator-select" className="text-sm font-medium text-zinc-300 shrink-0">
            Select a Creator
          </label>
          <Select value={activeTab} onValueChange={handleTabChange}>
            <SelectTrigger id="creator-select" className="w-64 bg-zinc-800 border-zinc-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="overview">Overview</SelectItem>
              {creators.map(c => (
                <SelectItem key={c.creatorID} value={c.creatorID}>{c.stageName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-6">
          {loadedTabs.has("overview") && (
            <div className={activeTab === "overview" ? "" : "hidden"}>
              <OverviewTab creators={creators} isActive={activeTab === "overview"} />
            </div>
          )}
          {creators.map(c => (
            loadedTabs.has(c.creatorID) && (
              <div key={c.creatorID} className={activeTab === c.creatorID ? "" : "hidden"}>
                <CreatorContentTable
                  creatorID={c.creatorID}
                  creatorName={c.stageName}
                  creators={creators}
                  isActive={activeTab === c.creatorID}
                />
              </div>
            )
          ))}
        </div>
      </div>
    </AppLayout>
  );
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/components/AuthProvider";
import AppLayout from "@/components/AppLayout";
import { useCreators } from "@/hooks/useCreators";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Plus, MoreHorizontal, Check, Info, Search, CalendarIcon, Link2 } from "lucide-react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/firebase-config";
import {
  type CampaignEntry, type CRType, type CRStatus, type CRPriority, type CallType, type Creator,
  STATUS_COLORS, STATUS_DOT, PRIORITY_COLORS, TYPE_LABELS, truncate, formatAmount, sortByStatus,
  firestoreToEntry, formatInTimezone, formatDueDate, COMMON_TIMEZONES, CAMPAIGN_TYPES,
} from "@/lib/campaignTracking";
import { useUserData } from "@/hooks/useUserData";
import { apiRequest } from "@/lib/clientApi";
import { toast } from "sonner";

// ─── Date picker ─────────────────────────────────────────────────────────────

function DatePickerInput({ value, onChange, className }: {
  value: string;
  onChange: (v: string) => void;
  className: string;
}) {
  const dateObj = value ? new Date(value + "T12:00:00") : undefined;
  const label = dateObj?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={`${className} flex items-center gap-2 text-left`}>
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

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CRStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}>
      {status}
    </span>
  );
}

function StatusDot({ status }: { status: CRStatus }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[status]}`} />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="text-xs text-zinc-400 mb-1">{label}</p>{children}</div>;
}

// ─── Reject Dialog ────────────────────────────────────────────────────────────

interface RejectDialogProps {
  entry: CampaignEntry;
  onClose: () => void;
  onRejected: () => void;
}

function RejectDialog({ entry, onClose, onRejected }: RejectDialogProps) {
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const handleReject = async () => {
    setSaving(true);
    try {
      const res = await apiRequest(`/api/campaign-tracking/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "Rejected", managerComment: comment }),
      });
      if (!res.ok) throw new Error();
      toast.success("Entry rejected");
      onRejected();
      onClose();
    } catch {
      toast.error("Failed to reject");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <Card className="w-full max-w-sm mx-4">
        <CardHeader>
          <CardTitle>Reject {entry.CR}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-400 mb-3">Provide a reason for rejection. The CA will be notified.</p>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={4}
            placeholder="Enter reason..."
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 resize-none"
          />
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={handleReject}
            disabled={saving || !comment.trim()}
          >
            {saving ? "Rejecting..." : "Reject"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

// ─── Manager View Card ────────────────────────────────────────────────────────

interface ManagerViewCardProps {
  entry: CampaignEntry;
  creatorName: string;
  userNames: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
  onReject: (e: CampaignEntry) => void;
}

function ManagerViewCard({ entry, creatorName, userNames, onClose, onSaved, onDeleted, onReject }: ManagerViewCardProps) {
  const { userData } = useUserData();
  const userTz = userData?.timezone || undefined;
  const [fields, setFields] = useState({
    fanName: entry.fanName,
    profileLink: entry.profileLink,
    description: entry.description,
    length: entry.length ?? "",
    address: entry.address ?? "",
    socialUsername: entry.socialUsername ?? "",
    socialPlatform: entry.socialPlatform ?? "",
    totalAmount: String(entry.totalAmount),
    amountPaid: String(entry.amountPaid),
    dueDate: entry.dueDate ? entry.dueDate.split("T")[0] : "",
    dueTime: entry.dueDate?.includes("T") ? (entry.dueDate.split("T")[1]?.substring(0, 5) ?? "") : "",
    dueDateTimezone: entry.dueDateTimezone ?? "",
    callType: entry.callType ?? "",
  });
  const [priority, setPriority] = useState<CRPriority | "">(entry.priority ?? "");
  const [saving, setSaving] = useState(false);
  const [approveSaving, setApproveSaving] = useState(false);
  const [completeSaving, setCompleteSaving] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const hasChanged =
    fields.fanName !== entry.fanName ||
    fields.profileLink !== entry.profileLink ||
    fields.description !== entry.description ||
    fields.length !== (entry.length ?? "") ||
    fields.address !== (entry.address ?? "") ||
    fields.socialUsername !== (entry.socialUsername ?? "") ||
    fields.socialPlatform !== (entry.socialPlatform ?? "") ||
    fields.callType !== (entry.callType ?? "") ||
    fields.totalAmount !== String(entry.totalAmount) ||
    fields.amountPaid !== String(entry.amountPaid) ||
    fields.dueDate !== (entry.dueDate ? entry.dueDate.split("T")[0] : "") ||
    fields.dueTime !== (entry.dueDate?.includes("T") ? (entry.dueDate.split("T")[1]?.substring(0, 5) ?? "") : "") ||
    fields.dueDateTimezone !== (entry.dueDateTimezone ?? "") ||
    priority !== (entry.priority ?? "");

  const set = (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setFields(prev => ({ ...prev, [k]: e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const { dueTime, ...fieldsToSave } = fields;
      const saveDueDate = fields.dueDate
        ? (entry.type === "Call" && dueTime ? `${fields.dueDate}T${dueTime}` : fields.dueDate)
        : null;
      const res = await apiRequest(`/api/campaign-tracking/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...fieldsToSave,
          dueDate: saveDueDate,
          totalAmount: Number(fields.totalAmount),
          amountPaid: Number(fields.amountPaid),
          priority: priority || null,
        }),
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
    setCompleteSaving(true);
    try {
      const res = await apiRequest(`/api/campaign-tracking/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "Completed", isArchived: true }),
      });
      if (!res.ok) throw new Error();
      toast.success("Marked as complete");
      onSaved();
      onClose();
    } catch {
      toast.error("Failed to mark as complete");
    } finally {
      setCompleteSaving(false);
      setConfirmComplete(false);
    }
  };

  const handleDelete = async () => {
    setDeleteSaving(true);
    try {
      const res = await apiRequest(`/api/campaign-tracking/${entry.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Deleted");
      onDeleted?.();
      onClose();
    } catch {
      toast.error("Failed to delete");
    } finally {
      setDeleteSaving(false);
      setConfirmDelete(false);
    }
  };

  const handleApprove = async () => {
    setApproveSaving(true);
    try {
      const res = await apiRequest(`/api/campaign-tracking/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "In Progress", priority: priority || null }),
      });
      if (!res.ok) throw new Error();
      toast.success("Approved — status set to In Progress");
      onSaved();
      onClose();
    } catch {
      toast.error("Failed to approve");
    } finally {
      setApproveSaving(false);
    }
  };

  const inputClass = "w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card className="w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
        <CardHeader className="shrink-0 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">{entry.CR}</CardTitle>
              <button
                type="button"
                title="Copy creator link"
                onClick={() => {
                  const typeLabel = entry.type === "Item" ? "Item Request" : TYPE_LABELS[entry.type] ?? entry.type;
                  const url = `${window.location.origin}/creator-portal/dashboard?crId=${entry.id}`;
                  const message = `💸 You have a new ${typeLabel} from ${entry.fanName} for ${formatAmount(entry.totalAmount)}! Check your Portal for the details: ${url}`;
                  navigator.clipboard.writeText(message);
                  toast.success("Link copied");
                }}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <Link2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <StatusBadge status={entry.status} />
          </div>
          <p className="text-sm text-zinc-400">{creatorName} · {entry.type}</p>
          {(entry.status === "Awaiting Approval" || entry.status === "In Progress") && (
            <div className="mt-3 rounded-lg border border-zinc-700/60 bg-zinc-900/60 px-3 py-2.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-zinc-300">Approve this custom request?</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className="text-zinc-500 hover:text-zinc-300 transition-colors">
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="text-xs text-zinc-300 w-72">
                    Approving a CR will send it to the creator, ensure all info is 100% correct before approving. If a CR requires more info, Reject it to send it back to the CA to resubmit.
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-7 text-xs"
                  onClick={handleApprove}
                  disabled={approveSaving || entry.status === "In Progress"}
                >
                  {approveSaving ? "Approving..." : "Approve"}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1 h-7 text-xs"
                  onClick={() => onReject(entry)}
                >
                  Reject
                </Button>
              </div>
            </div>
          )}
          {entry.status === "Rejected" && (
            <p className="mt-3 text-xs text-zinc-400 rounded-lg border border-zinc-700/60 bg-zinc-900/60 px-3 py-2.5">
              This custom has been sent back to the chatter and must be resubmitted.
            </p>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4 overflow-y-auto flex-1 pt-0">
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm">
            <div><p className="text-xs text-zinc-500">Created By</p><p className="text-zinc-300">{userNames[entry.createdBy] ?? entry.createdBy}</p></div>
            <div><p className="text-xs text-zinc-500">Last Edited By</p><p className="text-zinc-300">{userNames[entry.lastEditedBy] ?? entry.lastEditedBy}</p></div>
            <div><p className="text-xs text-zinc-500">Due Date</p><p className="text-zinc-300">{formatDueDate(entry.dueDate)}</p></div>
            <div><p className="text-xs text-zinc-500">Last Edited</p><p className="text-zinc-300">{formatInTimezone(entry.lastEditedTime, userTz)}</p></div>
          </div>
          <div className={`rounded-lg p-3 border ${Number(fields.amountPaid) >= Number(fields.totalAmount) ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Total Amount"><input type="number" value={fields.totalAmount} onChange={set("totalAmount")} className={inputClass} /></Field>
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <p className="text-xs text-zinc-400">Amount Paid</p>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="text-zinc-500 hover:text-zinc-300 transition-colors">
                        <Info className="w-3 h-3" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="text-xs text-zinc-300 w-60">
                      Always aim to complete payment plans with a fan!
                    </PopoverContent>
                  </Popover>
                </div>
                <input type="number" value={fields.amountPaid} onChange={set("amountPaid")} className={inputClass} />
              </div>
            </div>
          </div>
          <Field label="Fan Name"><input value={fields.fanName} onChange={set("fanName")} className={inputClass} /></Field>
          <Field label="Profile Link"><input value={fields.profileLink} onChange={set("profileLink")} className={inputClass} /></Field>
          <Field label="Description"><textarea value={fields.description} onChange={set("description")} rows={3} className={`${inputClass} resize-none`} /></Field>
          {(entry.type === "CR" || entry.type === "Call") && (
            <Field label="Length"><input value={fields.length} onChange={set("length")} className={inputClass} /></Field>
          )}
          {entry.type === "Item" && (
            <Field label="Address"><input value={fields.address} onChange={set("address")} className={inputClass} /></Field>
          )}
          {entry.type === "Call" && (
            <>
              <Field label="Call Type">
                <Select value={fields.callType} onValueChange={v => setFields(prev => ({ ...prev, callType: v }))}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(["Clean Video", "Clean Voice", "NSFW Video", "NSFW Voice"] as CallType[]).map(ct => (
                      <SelectItem key={ct} value={ct}>{ct}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Social Platform"><input value={fields.socialPlatform} onChange={set("socialPlatform")} className={inputClass} /></Field>
              <Field label="Social Username"><input value={fields.socialUsername} onChange={set("socialUsername")} className={inputClass} /></Field>
            </>
          )}
          <Field label={entry.type === "Call" ? "Call Time" : "Due Date"}>
            {entry.type === "Call" ? (
              <div className="flex gap-2">
                <DatePickerInput
                  value={fields.dueDate}
                  onChange={v => setFields(prev => ({ ...prev, dueDate: v }))}
                  className={inputClass}
                />
                <input
                  type="time"
                  value={fields.dueTime}
                  onChange={e => setFields(prev => ({ ...prev, dueTime: e.target.value }))}
                  className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 [color-scheme:dark]"
                />
              </div>
            ) : (
              <DatePickerInput
                value={fields.dueDate}
                onChange={v => setFields(prev => ({ ...prev, dueDate: v }))}
                className={inputClass}
              />
            )}
          </Field>
          <Field label="Due Date Timezone">
            <Select value={fields.dueDateTimezone} onValueChange={v => setFields(prev => ({ ...prev, dueDateTimezone: v }))}>
              <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue placeholder="Select timezone..." /></SelectTrigger>
              <SelectContent>
                {COMMON_TIMEZONES.map(tz => <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={priority || "none"} onValueChange={v => setPriority(v === "none" ? "" : v as CRPriority)}>
              <SelectTrigger className="bg-zinc-800 border-zinc-700">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="Low">Low</SelectItem>
                <SelectItem value="Medium">Medium</SelectItem>
                <SelectItem value="High">High</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {entry.managerComment && (
            <Field label="Manager Comment">
              <p className="text-sm text-zinc-300 italic p-2 rounded bg-zinc-800">{entry.managerComment}</p>
            </Field>
          )}
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Actions</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {entry.status === "Rejected" && (
                <>
                  <DropdownMenuItem onClick={handleApprove} disabled={approveSaving}>
                    {approveSaving ? "Approving..." : "Approve"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                onClick={() => setConfirmComplete(true)}
                disabled={entry.status === "Completed"}
              >
                Mark as Complete
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !hasChanged}>{saving ? "Saving..." : "Save"}</Button>
        </CardFooter>
      </Card>

      <AlertDialog open={confirmComplete} onOpenChange={open => { if (!open) setConfirmComplete(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark {entry.CR} as Complete?</AlertDialogTitle>
            <AlertDialogDescription>This will mark the entry as completed and archive it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={completeSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleMarkComplete} disabled={completeSaving}>
              {completeSaving ? "Completing..." : "Mark as Complete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={open => { if (!open) setConfirmDelete(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {entry.CR}?</AlertDialogTitle>
            <AlertDialogDescription>This action is permanent and cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleteSaving}
            >
              {deleteSaving ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

interface OverviewProps {
  creators: Creator[];
  userNames: Record<string, string>;
}

function OverviewTab({ creators, userNames }: OverviewProps) {
  const { userData } = useUserData();
  const userTz = userData?.timezone || undefined;
  const [allEntries, setAllEntries] = useState<CampaignEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [aging, setAging] = useState({ "0-24h": 0, "1-7d": 0, "7-30d": 0, ">30d": 0 });
  const [viewEntry, setViewEntry] = useState<CampaignEntry | null>(null);
  const [rejectEntry, setRejectEntry] = useState<CampaignEntry | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (unsubRef.current) unsubRef.current();
    const q = query(
      collection(db, "campaign-tracking"),
      where("isArchived", "==", false)
    );
    unsubRef.current = onSnapshot(q, snap => {
      const entries = snap.docs
        .map(d => firestoreToEntry(d.id, d.data() as Record<string, unknown>))
        .filter(e => !(CAMPAIGN_TYPES as readonly string[]).includes(e.type));
      setAllEntries(entries);
      setLoading(false);
      const now = Date.now();
      const result = { "0-24h": 0, "1-7d": 0, "7-30d": 0, ">30d": 0 };
      for (const e of entries.filter(e => e.status === "Awaiting Approval" || e.status === "In Progress")) {
        const ageMs = now - (e.createdTime ? new Date(e.createdTime).getTime() : now);
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        if (ageDays < 1) result["0-24h"]++;
        else if (ageDays < 7) result["1-7d"]++;
        else if (ageDays < 30) result["7-30d"]++;
        else result[">30d"]++;
      }
      setAging(result);
    });
    return () => { unsubRef.current?.(); };
  }, []);

  const creatorMap = Object.fromEntries(creators.map(c => [c.creatorID, c.stageName]));

  // Awaiting count per creator
  const awaitingByCreator = Object.fromEntries(
    creators.map(c => [c.creatorID, allEntries.filter(e => e.creatorID === c.creatorID && e.status === "Awaiting Approval").length])
  );

  // In Progress count per creator
  const inProgressByCreator = Object.fromEntries(
    creators.map(c => [c.creatorID, allEntries.filter(e => e.creatorID === c.creatorID && e.status === "In Progress").length])
  );

  // Outstanding $
  const outstanding = allEntries
    .filter(e => e.status !== "Completed")
    .reduce((sum, e) => sum + (e.totalAmount - e.amountPaid), 0);

  // Recently completed (not archived)
  const recentCompleted = allEntries
    .filter(e => e.status === "Completed" && !e.isArchived)
    .sort((a, b) => new Date(b.lastEditedTime).getTime() - new Date(a.lastEditedTime).getTime());

  // Outstanding customs (Awaiting + In Progress), excluding campaign-only types which have no CR code
  const outstandingEntries = allEntries.filter(e =>
    (e.status === "Awaiting Approval" || e.status === "In Progress" || e.status === "Rejected") &&
    !(CAMPAIGN_TYPES as readonly string[]).includes(e.type)
  );
  const outstandingByCreator = Object.fromEntries(
    creators.map(c => [c.creatorID, outstandingEntries.filter(e => e.creatorID === c.creatorID)])
  );

  // Outstanding payments (any entry with amountPaid < totalAmount), excluding campaign-only types
  const outstandingPaymentEntries = allEntries.filter(e =>
    e.amountPaid < e.totalAmount &&
    !(CAMPAIGN_TYPES as readonly string[]).includes(e.type)
  );
  const outstandingPaymentsByCreator = Object.fromEntries(
    creators.map(c => [c.creatorID, outstandingPaymentEntries.filter(e => e.creatorID === c.creatorID)])
  );

  const handleDismiss = async (id: string) => {
    try {
      await apiRequest(`/api/campaign-tracking/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isArchived: true }),
      });
      toast.success("Dismissed");
    } catch {
      toast.error("Failed");
    }
  };

  const handleDismissAll = async () => {
    try {
      await Promise.all(recentCompleted.map(e =>
        apiRequest(`/api/campaign-tracking/${e.id}`, {
          method: "PATCH",
          body: JSON.stringify({ isArchived: true }),
        })
      ));
      toast.success("All dismissed");
    } catch {
      toast.error("Failed to dismiss all");
    }
  };

  if (loading) return <div className="text-sm text-zinc-500 p-8">Loading...</div>;

  return (
    <div className="flex flex-col gap-6">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryTile title="Awaiting Approval">
          <div className="flex flex-col gap-1 mt-2">
            {creators.map(c => (
              <div key={c.creatorID} className="flex justify-between items-center gap-2 text-sm">
                <span className="flex items-center gap-1.5 text-zinc-400 min-w-0">
                  <Avatar className="size-4 shrink-0">
                    <AvatarImage src={c.photoURL ?? undefined} />
                    <AvatarFallback className="text-[8px]">{c.stageName.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <span className="truncate">{c.stageName}</span>
                </span>
                <span className={`font-semibold shrink-0 ${awaitingByCreator[c.creatorID] ? "text-orange-400" : "text-zinc-500"}`}>
                  {awaitingByCreator[c.creatorID]}
                </span>
              </div>
            ))}
          </div>
        </SummaryTile>
        <SummaryTile title="In Progress">
          <div className="flex flex-col gap-1 mt-2">
            {creators.map(c => (
              <div key={c.creatorID} className="flex justify-between items-center gap-2 text-sm">
                <span className="flex items-center gap-1.5 text-zinc-400 min-w-0">
                  <Avatar className="size-4 shrink-0">
                    <AvatarImage src={c.photoURL ?? undefined} />
                    <AvatarFallback className="text-[8px]">{c.stageName.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <span className="truncate">{c.stageName}</span>
                </span>
                <span className={`font-semibold shrink-0 ${inProgressByCreator[c.creatorID] ? "text-blue-400" : "text-zinc-500"}`}>
                  {inProgressByCreator[c.creatorID]}
                </span>
              </div>
            ))}
          </div>
        </SummaryTile>
        <SummaryTile title="Outstanding Payments">
          <p className="text-2xl font-bold text-red-400 mt-2">{formatAmount(outstanding)}</p>
        </SummaryTile>
        <SummaryTile title="Aging (Awaiting + In Progress)">
          <div className="flex flex-col gap-1 mt-2">
            {(["0-24h", "1-7d", "7-30d", ">30d"] as const).map(bucket => (
              <div key={bucket} className="flex justify-between text-sm">
                <span className="text-zinc-400">{bucket}</span>
                <span className={`font-semibold ${aging[bucket] ? "text-yellow-400" : "text-zinc-500"}`}>
                  {aging[bucket]}
                </span>
              </div>
            ))}
          </div>
        </SummaryTile>
      </div>

      {/* Recently Completed */}
      {recentCompleted.length > 0 && (
        <div className="rounded-xl p-4 border border-green-500/30 bg-green-500/5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-green-400">Recently Completed</h3>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleDismissAll}>
              Dismiss All
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {recentCompleted.map(e => (
              <div key={e.id} className="grid items-center gap-4 text-sm" style={{ gridTemplateColumns: "7rem 1fr auto auto" }}>
                <button onClick={() => setViewEntry(e)} className="text-zinc-300 font-mono text-left hover:text-white hover:underline underline-offset-2 transition-colors">{e.CR}</button>
                <span className="text-zinc-400 truncate">{creatorMap[e.creatorID] ?? e.creatorID}</span>
                <span className="text-zinc-500 text-xs">{formatInTimezone(e.lastEditedTime, userTz)}</span>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleDismiss(e.id)}>
                  Dismiss
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Outstanding Customs */}
      {outstandingEntries.length > 0 && (
        <div className="rounded-xl p-4 border border-blue-500/30 bg-blue-500/5">
          <h3 className="text-sm font-semibold text-blue-400 mb-3">Outstanding Customs</h3>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr>
                  {creators.map(c => (
                    <th key={c.creatorID} className="text-left px-2 pb-2 text-zinc-400 font-medium">
                      <div className="flex items-center gap-1.5">
                        <Avatar className="size-4 shrink-0">
                          <AvatarImage src={c.photoURL ?? undefined} />
                          <AvatarFallback className="text-[8px]">{c.stageName.charAt(0)}</AvatarFallback>
                        </Avatar>
                        {c.stageName}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="align-top">
                  {creators.map(c => (
                    <td key={c.creatorID} className="px-2 pb-2">
                      <div className="flex flex-col gap-1">
                        {(outstandingByCreator[c.creatorID] ?? []).map(e => (
                          <div key={e.id} className="flex items-center gap-1.5">
                            <StatusDot status={e.status} />
                            <button onClick={() => setViewEntry(e)} className="font-mono text-zinc-300 hover:text-white hover:underline underline-offset-2 transition-colors">{e.CR}</button>
                          </div>
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Outstanding Payments */}
      {outstandingPaymentEntries.length > 0 && (
        <div className="rounded-xl p-4 border border-red-500/30 bg-red-500/5">
          <h3 className="text-sm font-semibold text-red-400 mb-3">Outstanding Payments</h3>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr>
                  {creators.map(c => (
                    <th key={c.creatorID} className="text-left px-2 pb-2 text-zinc-400 font-medium">
                      <div className="flex items-center gap-1.5">
                        <Avatar className="size-4 shrink-0">
                          <AvatarImage src={c.photoURL ?? undefined} />
                          <AvatarFallback className="text-[8px]">{c.stageName.charAt(0)}</AvatarFallback>
                        </Avatar>
                        {c.stageName}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="align-top">
                  {creators.map(c => (
                    <td key={c.creatorID} className="px-2 pb-2">
                      <div className="flex flex-col gap-1">
                        {(outstandingPaymentsByCreator[c.creatorID] ?? []).map(e => (
                          <div key={e.id} className="flex items-center gap-1.5">
                            <StatusDot status={e.status} />
                            <button onClick={() => setViewEntry(e)} className="font-mono text-zinc-300 hover:text-white hover:underline underline-offset-2 transition-colors">{e.CR}</button>
                            <span className="text-red-400 font-medium">{formatAmount(e.totalAmount - e.amountPaid)}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewEntry && (
        <ManagerViewCard
          entry={viewEntry}
          creatorName={creatorMap[viewEntry.creatorID] ?? viewEntry.creatorID}
          userNames={userNames}
          onClose={() => setViewEntry(null)}
          onSaved={() => setViewEntry(null)}
          onReject={e => { setViewEntry(null); setRejectEntry(e); }}
        />
      )}
      {rejectEntry && (
        <RejectDialog
          entry={rejectEntry}
          onClose={() => setRejectEntry(null)}
          onRejected={() => setRejectEntry(null)}
        />
      )}
    </div>
  );
}

function SummaryTile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-4 border" style={{ background: "var(--sidebar-background)", borderColor: "var(--border-subtle)" }}>
      <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{title}</p>
      {children}
    </div>
  );
}

// ─── New Entry Wizard ─────────────────────────────────────────────────────────

interface NewEntryWizardProps {
  creators: Creator[];
  onClose: () => void;
  onCreated: () => void;
}

function NewEntryWizard({ creators, onClose, onCreated }: NewEntryWizardProps) {
  const { userData } = useUserData();
  const [step, setStep] = useState(1);
  const [type, setType] = useState<CRType | "">("");
  const [form, setForm] = useState<Record<string, string>>({
    creatorID: "", fanName: "", profileLink: "", description: "",
    length: "", totalAmount: "", amountPaid: "",
    address: "", socialUsername: "", socialPlatform: "", callType: "", dueDate: "", dueTime: "",
    dueDateTimezone: userData?.timezone ?? "",
  });
  const [submitting, setSubmitting] = useState(false);

  const setField = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));
  const setVal = (k: string) => (v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const { dueTime, ...formToSave } = form;
      const saveDueDate = formToSave.dueDate
        ? (type === "Call" && dueTime ? `${formToSave.dueDate}T${dueTime}` : formToSave.dueDate)
        : "";
      const res = await apiRequest("/api/campaign-tracking/create", {
        method: "POST",
        body: JSON.stringify({ ...formToSave, dueDate: saveDueDate || null, type, totalAmount: Number(form.totalAmount), amountPaid: Number(form.amountPaid || 0) }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed"); }
      toast.success("Entry created");
      onCreated();
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Failed to create entry");
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = "w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{step === 1 ? "New Custom Request" : step === 2 ? "Enter Details" : "Confirm Entry"}</DialogTitle>
        </DialogHeader>
        {step === 1 && (
          <div className="flex flex-col gap-3 py-4">
            {(["CR", "Call", "Item"] as CRType[]).map(t => (
              <Button
                key={t}
                variant={type === t ? "default" : "outline"}
                className="w-full justify-start"
                onClick={() => setType(t)}
              >
                {t === "CR" ? "Custom Request" : t}
              </Button>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => setStep(s => s + 1)} disabled={!type}>Next</Button>
            </div>
          </div>
        )}
        {step === 2 && type && (
          <div className="flex flex-col gap-3 py-4 max-h-[60vh] overflow-y-auto">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Creator</label>
              <Select value={form.creatorID} onValueChange={setVal("creatorID")}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700">
                  <SelectValue placeholder="Select creator..." />
                </SelectTrigger>
                <SelectContent>
                  {creators.map(c => <SelectItem key={c.creatorID} value={c.creatorID}>{c.stageName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><label className="block text-xs text-zinc-400 mb-1">Fan Name</label><input value={form.fanName} onChange={setField("fanName")} required className={inputClass} /></div>
            <div><label className="block text-xs text-zinc-400 mb-1">Profile Link</label><input value={form.profileLink} onChange={setField("profileLink")} className={inputClass} /></div>
            <div><label className="block text-xs text-zinc-400 mb-1">Description</label><textarea value={form.description} onChange={setField("description")} rows={3} required className={`${inputClass} resize-none`} /></div>
            {(type === "CR" || type === "Call") && <div><label className="block text-xs text-zinc-400 mb-1">Length</label><input value={form.length} onChange={setField("length")} className={inputClass} /></div>}
            {type === "Item" && <div><label className="block text-xs text-zinc-400 mb-1">Address</label><input value={form.address} onChange={setField("address")} className={inputClass} /></div>}
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{type === "Call" ? "Call Time" : "Due Date"}</label>
              {type === "Call" ? (
                <div className="flex gap-2">
                  <DatePickerInput
                    value={form.dueDate}
                    onChange={v => setForm(prev => ({ ...prev, dueDate: v }))}
                    className={inputClass}
                  />
                  <input
                    type="time"
                    value={form.dueTime}
                    onChange={e => setForm(prev => ({ ...prev, dueTime: e.target.value }))}
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 [color-scheme:dark]"
                  />
                </div>
              ) : (
                <DatePickerInput
                  value={form.dueDate}
                  onChange={v => setForm(prev => ({ ...prev, dueDate: v }))}
                  className={inputClass}
                />
              )}
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Due Date Timezone</label>
              <Select value={form.dueDateTimezone} onValueChange={setVal("dueDateTimezone")}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue placeholder="Select timezone..." /></SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map(tz => <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {type === "Call" && <>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Call Type</label>
                <Select value={form.callType} onValueChange={setVal("callType")}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(["Clean Video", "Clean Voice", "NSFW Video", "NSFW Voice"] as CallType[]).map(ct => <SelectItem key={ct} value={ct}>{ct}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><label className="block text-xs text-zinc-400 mb-1">Social Platform</label><input value={form.socialPlatform} onChange={setField("socialPlatform")} className={inputClass} /></div>
              <div><label className="block text-xs text-zinc-400 mb-1">Social Username</label><input value={form.socialUsername} onChange={setField("socialUsername")} className={inputClass} /></div>
            </>}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-zinc-400 mb-1">Total Amount</label><input type="number" value={form.totalAmount} onChange={setField("totalAmount")} required className={inputClass} /></div>
              <div><label className="block text-xs text-zinc-400 mb-1">Amount Paid</label><input type="number" value={form.amountPaid} onChange={setField("amountPaid")} className={inputClass} /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep(s => s - 1)}>Back</Button>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => setStep(s => s + 1)}>Next</Button>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="flex flex-col gap-2 py-4 text-sm">
            <p className="text-zinc-400 mb-3">Please confirm the details below are correct before submitting.</p>
            {[["Type", type === "CR" ? "Custom Request" : type], ["Creator", creators.find(c => c.creatorID === form.creatorID)?.stageName ?? ""], ["Fan Name", form.fanName], ["Description", truncate(form.description, 120)], ["Total Amount", `$${form.totalAmount}`], ["Amount Paid", `$${form.amountPaid || "0"}`]].map(([l, v]) => (
              <div key={l} className="flex justify-between gap-4"><span className="text-zinc-500 shrink-0">{l}</span><span className="text-right text-zinc-200">{v}</span></div>
            ))}
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setStep(s => s - 1)}>Back</Button>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={submitting}>{submitting ? "Submitting..." : "Submit"}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Manager Creator Table ────────────────────────────────────────────────────

interface ManagerTableProps {
  creatorID: string;
  creatorName: string;
  creators: Creator[];
  userNames: Record<string, string>;
}

function ManagerCreatorTable({ creatorID, creatorName, creators, userNames }: ManagerTableProps) {
  const { userData } = useUserData();
  const userTz = userData?.timezone || undefined;
  const [entries, setEntries] = useState<CampaignEntry[]>([]);
  const [typeFilter, setTypeFilter] = useState<Set<CRType>>(new Set(["CR", "Call", "Item"]));
  const [showCompleted, setShowCompleted] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [viewEntry, setViewEntry] = useState<CampaignEntry | null>(null);
  const [rejectEntry, setRejectEntry] = useState<CampaignEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CampaignEntry | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const unsubRef = useRef<(() => void) | null>(null);

  const subscribe = useCallback(() => {
    if (unsubRef.current) unsubRef.current();
    const statusFilter: CRStatus[] = showCompleted
      ? ["Awaiting Approval", "In Progress", "Rejected", "Completed"]
      : ["Awaiting Approval", "In Progress", "Rejected"];

    const q = query(
      collection(db, "campaign-tracking"),
      where("creatorID", "==", creatorID),
      where("status", "in", statusFilter)
    );
    unsubRef.current = onSnapshot(q, snap => {
      const docs = snap.docs
        .map(d => firestoreToEntry(d.id, d.data() as Record<string, unknown>))
        .filter(e => !(CAMPAIGN_TYPES as readonly string[]).includes(e.type));
      setEntries(sortByStatus(docs));
    });
  }, [creatorID, showCompleted]);

  useEffect(() => {
    subscribe();
    return () => { unsubRef.current?.(); };
  }, [subscribe]);

  const typeFiltered = entries.filter(e => typeFilter.has(e.type));
  const searchLower = searchQuery.toLowerCase();
  const displayed = searchLower
    ? typeFiltered.filter(e =>
        e.CR.toLowerCase().includes(searchLower) ||
        e.fanName.toLowerCase().includes(searchLower) ||
        e.profileLink.toLowerCase().includes(searchLower) ||
        (userNames[e.createdBy] ?? e.createdBy).toLowerCase().includes(searchLower)
      )
    : typeFiltered;

  const toggleType = (t: CRType) => setTypeFilter(prev => {
    const next = new Set(prev);
    next.has(t) ? next.delete(t) : next.add(t);
    return next;
  });

  const handleMarkComplete = async (e: CampaignEntry) => {
    setActionLoading(true);
    try {
      await apiRequest(`/api/campaign-tracking/${e.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "Completed" }),
      });
      toast.success("Marked as completed");
    } catch { toast.error("Failed"); }
    setActionLoading(false);
  };

  const handleMarkIncomplete = async (e: CampaignEntry) => {
    setActionLoading(true);
    try {
      await apiRequest(`/api/campaign-tracking/${e.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "Awaiting Approval" }),
      });
      toast.success("Marked as awaiting approval");
    } catch { toast.error("Failed"); }
    setActionLoading(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      await apiRequest(`/api/campaign-tracking/${deleteTarget.id}`, { method: "DELETE" });
      toast.success("Deleted");
    } catch { toast.error("Failed to delete"); }
    setDeleteTarget(null);
    setActionLoading(false);
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-2">
          {(["CR", "Call", "Item"] as CRType[]).map(t => (
            <Button key={t} size="sm" variant={typeFilter.has(t) ? "default" : "outline"} onClick={() => toggleType(t)}>
              {TYPE_LABELS[t]}
            </Button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search for CR Code, Fans, Profile Links, Users..."
            className="pl-8 h-8 text-xs bg-zinc-800 border-zinc-700"
          />
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Switch checked={showCompleted} onCheckedChange={setShowCompleted} id={`mgr-show-completed-${creatorID}`} />
          <label htmlFor={`mgr-show-completed-${creatorID}`} className="text-sm text-zinc-400 cursor-pointer">Show Completed</label>
          <Button size="sm" onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-1" /> New</Button>
        </div>
      </div>

      {displayed.length === 0 ? (
        <div className="rounded-lg p-8 text-center" style={{ background: "var(--sidebar-background)", border: "1px solid var(--border-subtle)" }}>
          <p className="text-sm text-muted-foreground">No custom requests found.</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CR</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Fan Name</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.map(entry => (
                <TableRow key={entry.id}>
                  <TableCell className="font-mono text-sm">{entry.CR}</TableCell>
                  <TableCell className="text-sm">{TYPE_LABELS[entry.type]}</TableCell>
                  <TableCell><StatusBadge status={entry.status} /></TableCell>
                  <TableCell>
                    {entry.priority ? (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[entry.priority]}`}>
                        {entry.priority}
                      </span>
                    ) : <span className="text-zinc-600 text-xs">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-zinc-400">
                    {formatDueDate(entry.dueDate)}
                  </TableCell>
                  <TableCell className="text-sm">{entry.fanName}</TableCell>
                  <TableCell className="text-sm">{formatAmount(entry.amountPaid)}</TableCell>
                  <TableCell className="text-sm">{formatAmount(entry.totalAmount)}</TableCell>
                  <TableCell className="text-sm text-zinc-400">{userNames[entry.createdBy] ?? entry.createdBy}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setViewEntry(entry)}>View</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {entry.status !== "Completed" ? (
                          <DropdownMenuItem onClick={() => handleMarkComplete(entry)} disabled={actionLoading}>
                            <Check className="w-4 h-4 mr-2" /> Mark as Complete
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => handleMarkIncomplete(entry)} disabled={actionLoading}>
                            Mark as Incomplete
                          </DropdownMenuItem>
                        )}
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
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {showNew && <NewEntryWizard creators={creators} onClose={() => setShowNew(false)} onCreated={() => {}} />}

      {viewEntry && (
        <ManagerViewCard
          entry={viewEntry}
          creatorName={creatorName}
          userNames={userNames}
          onClose={() => setViewEntry(null)}
          onSaved={() => setViewEntry(null)}
          onReject={e => { setViewEntry(null); setRejectEntry(e); }}
        />
      )}

      {rejectEntry && (
        <RejectDialog
          entry={rejectEntry}
          onClose={() => setRejectEntry(null)}
          onRejected={() => setRejectEntry(null)}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.CR}?</AlertDialogTitle>
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ManagerCustomRequestsPage() {
  const { user } = useAuth();
  const creators = useCreators();
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    if (activeTab === "overview" && typeof window !== "undefined" && window.electronAPI) {
      window.electronAPI.window.setSize(1700, 920);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    user.getIdToken().then(token => {
      fetch("/api/users/display-names", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => {
          if (cancelled) return;
          const map: Record<string, string> = {};
          for (const u of (data.users ?? [])) map[u.uid] = u.displayName;
          setUserNames(map);
        })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, [user]);

  return (
    <AppLayout>
      <div className="max-w-7xl">
        <h1 className="text-2xl font-bold tracking-tight mb-2">Custom Requests</h1>

        <Tabs
          orientation="vertical"
          value={activeTab}
          onValueChange={setActiveTab}
          className="mt-6 flex flex-row gap-4 items-start"
        >
          <TabsList className="flex flex-col h-auto w-48 shrink-0 items-stretch p-1">
            <TabsTrigger value="overview" className="justify-start">Overview</TabsTrigger>
            {creators.map(c => (
              <TabsTrigger key={c.creatorID} value={c.creatorID} className="justify-start">
                {c.stageName}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex-1 min-w-0">
            <TabsContent value="overview">
              <OverviewTab creators={creators} userNames={userNames} />
            </TabsContent>
            {creators.map(c => (
              <TabsContent key={c.creatorID} value={c.creatorID}>
                {activeTab === c.creatorID && (
                  <ManagerCreatorTable creatorID={c.creatorID} creatorName={c.stageName} creators={creators} userNames={userNames} />
                )}
              </TabsContent>
            ))}
          </div>
        </Tabs>
      </div>
    </AppLayout>
  );
}

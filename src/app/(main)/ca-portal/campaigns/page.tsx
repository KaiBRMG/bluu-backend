"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/components/AuthProvider";
import AppLayout from "@/components/AppLayout";
import { useCreators } from "@/hooks/useCreators";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { MoreHorizontal, Plus, Info } from "lucide-react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/firebase-config";
import {
  type CampaignEntry, type Creator, type CampaignType,
  CAMPAIGN_TYPES, TYPE_LABELS, formatAmount, formatInTimezone, firestoreToEntry,
} from "@/lib/campaignTracking";
import { useUserData } from "@/hooks/useUserData";
import { apiRequest } from "@/lib/clientApi";
import { toast } from "sonner";

// ─── Shared constants ─────────────────────────────────────────────────────────

const inputClass = "w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500";
const readOnlyClass = "w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-300";
const PAGE_SIZE = 20;

const TYPE_BUTTON_LABELS: Record<CampaignType, string> = {
  BFE: "BF Experience",
  Hubby: "Hubby",
  VIP: "VIP",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-zinc-400 mb-1">{label}</p>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-zinc-500 shrink-0">{label}</span>
      <span className="text-right text-zinc-200">{value}</span>
    </div>
  );
}

// ─── View / Edit Card ─────────────────────────────────────────────────────────

interface ViewCardProps {
  entry: CampaignEntry;
  creatorName: string;
  userNames: Record<string, string>;
  onClose: () => void;
}

function CampaignViewCard({ entry, creatorName, userNames, onClose }: ViewCardProps) {
  const { userData } = useUserData();
  const userTz = userData?.timezone || undefined;
  const [fanName, setFanName] = useState(entry.fanName);
  const [profileLink, setProfileLink] = useState(entry.profileLink ?? "");
  const [description, setDescription] = useState(entry.description ?? "");
  const [amountPaid, setAmountPaid] = useState(String(entry.amountPaid));
  const [length, setLength] = useState(entry.length ?? "");
  const [saving, setSaving] = useState(false);

  const hasChanged =
    fanName !== entry.fanName ||
    profileLink !== (entry.profileLink ?? "") ||
    description !== (entry.description ?? "") ||
    amountPaid !== String(entry.amountPaid) ||
    (entry.type === "BFE" && length !== (entry.length ?? ""));

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        fanName,
        profileLink,
        description,
        amountPaid: Number(amountPaid),
      };
      if (entry.type === "BFE") body.length = length;
      const res = await apiRequest(`/api/campaign-tracking/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Saved");
      onClose();
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 overflow-y-auto py-8">
      <Card className="w-full max-w-lg mx-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{entry.fanName}</CardTitle>
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-300 font-medium">
              {TYPE_LABELS[entry.type]}
            </span>
          </div>
          <p className="text-sm text-zinc-400">{creatorName}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm">
            <div>
              <p className="text-xs text-zinc-500">Created By</p>
              <p className="text-zinc-300">{userNames[entry.createdBy] ?? entry.createdBy}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Last Edited By</p>
              <p className="text-zinc-300">{userNames[entry.lastEditedBy] ?? entry.lastEditedBy}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Created</p>
              <p className="text-zinc-300">{formatInTimezone(entry.createdTime, userTz)}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Last Edited</p>
              <p className="text-zinc-300">{formatInTimezone(entry.lastEditedTime, userTz)}</p>
            </div>
          </div>
          <div className={`rounded-lg p-3 border ${Number(amountPaid) >= entry.totalAmount ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Total Amount">
                <p className={readOnlyClass}>{formatAmount(entry.totalAmount)}</p>
              </Field>
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
                <input
                  type="number"
                  value={amountPaid}
                  onChange={e => setAmountPaid(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          </div>
          <Field label="Fan Name">
            <input value={fanName} onChange={e => setFanName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Profile Link">
            <input value={profileLink} onChange={e => setProfileLink(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Description">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={`${inputClass} resize-none`} />
          </Field>
          {entry.type === "BFE" && (
            <Field label="Length">
              <input value={length} onChange={e => setLength(e.target.value)} className={inputClass} />
            </Field>
          )}
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={handleSave} disabled={saving || !hasChanged}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

// ─── New Campaign Wizard ──────────────────────────────────────────────────────

interface WizardProps {
  creators: Creator[];
  defaultCreatorID?: string;
  onClose: () => void;
}

function NewCampaignWizard({ creators, defaultCreatorID, onClose }: WizardProps) {
  const [step, setStep] = useState(1);
  const [type, setType] = useState<CampaignType | "">("");
  const [form, setForm] = useState<Record<string, string>>({
    creatorID: defaultCreatorID ?? "",
    fanName: "",
    profileLink: "",
    description: "",
    totalAmount: "",
    amountPaid: "",
    length: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const setField = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));
  const setVal = (k: string) => (v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const canAdvanceStep2 = !!form.creatorID && !!form.fanName && !!form.totalAmount;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        creatorID: form.creatorID,
        type,
        fanName: form.fanName,
        profileLink: form.profileLink,
        description: form.description,
        totalAmount: Number(form.totalAmount),
        amountPaid: Number(form.amountPaid || 0),
      };
      if (type === "BFE") body.length = form.length;
      const res = await apiRequest("/api/campaign-tracking/create", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed");
      }
      toast.success("Entry created");
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Failed to create entry");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? "New Campaign Entry" : step === 2 ? "Enter Details" : "Confirm Entry"}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Select type */}
        {step === 1 && (
          <div className="flex flex-col gap-3 py-4">
            {(CAMPAIGN_TYPES as readonly CampaignType[]).map(t => (
              <Button
                key={t}
                variant={type === t ? "default" : "outline"}
                className="w-full justify-start"
                onClick={() => setType(t)}
              >
                {TYPE_BUTTON_LABELS[t]}
              </Button>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => setStep(2)} disabled={!type}>Next</Button>
            </div>
          </div>
        )}

        {/* Step 2: Input fields */}
        {step === 2 && type && (
          <div className="flex flex-col gap-3 py-4 max-h-[60vh] overflow-y-auto">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Creator</label>
              <Select value={form.creatorID} onValueChange={setVal("creatorID")}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700">
                  <SelectValue placeholder="Select creator..." />
                </SelectTrigger>
                <SelectContent>
                  {creators.map(c => (
                    <SelectItem key={c.creatorID} value={c.creatorID}>{c.stageName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Fan Name</label>
              <input value={form.fanName} onChange={setField("fanName")} required className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Profile Link</label>
              <input value={form.profileLink} onChange={setField("profileLink")} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Description</label>
              <textarea value={form.description} onChange={setField("description")} rows={3} className={`${inputClass} resize-none`} />
            </div>
            {type === "BFE" && (
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Length</label>
                <input value={form.length} onChange={setField("length")} className={inputClass} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Total Amount</label>
                <input type="number" value={form.totalAmount} onChange={setField("totalAmount")} required className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Amount Paid</label>
                <input type="number" value={form.amountPaid} onChange={setField("amountPaid")} className={inputClass} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => setStep(3)} disabled={!canAdvanceStep2}>Next</Button>
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === 3 && (
          <div className="flex flex-col gap-2 py-4 text-sm">
            <p className="text-zinc-400 mb-3">Please confirm the details below are correct before submitting.</p>
            <Row label="Type" value={TYPE_BUTTON_LABELS[type as CampaignType] ?? type} />
            <Row label="Creator" value={creators.find(c => c.creatorID === form.creatorID)?.stageName ?? form.creatorID} />
            <Row label="Fan Name" value={form.fanName} />
            {form.description && (
              <Row label="Description" value={form.description.slice(0, 120) + (form.description.length > 120 ? "…" : "")} />
            )}
            <Row label="Total Amount" value={`$${form.totalAmount}`} />
            <Row label="Amount Paid" value={`$${form.amountPaid || "0"}`} />
            {type === "BFE" && form.length && <Row label="Length" value={form.length} />}
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
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

// ─── Overview Panel ───────────────────────────────────────────────────────────

interface OverviewPanelProps {
  creators: Creator[];
  userNames: Record<string, string>;
  isActive: boolean;
  uid: string;
}

function OverviewPanel({ creators, userNames, isActive, uid }: OverviewPanelProps) {
  const { userData } = useUserData();
  const userTz = userData?.timezone || undefined;
  const [entries, setEntries] = useState<CampaignEntry[]>([]);
  const [viewEntry, setViewEntry] = useState<CampaignEntry | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isActive || !uid) {
      unsubRef.current?.();
      unsubRef.current = null;
      return;
    }

    const q = query(
      collection(db, "campaign-tracking"),
      where("createdBy", "==", uid),
      where("type", "in", [...CAMPAIGN_TYPES]),
      where("isArchived", "==", false)
    );
    unsubRef.current = onSnapshot(q, snap => {
      setEntries(snap.docs.map(d => firestoreToEntry(d.id, d.data() as Record<string, unknown>)));
    });

    return () => { unsubRef.current?.(); unsubRef.current = null; };
  }, [isActive, uid]);

  const creatorMap = Object.fromEntries(creators.map(c => [c.creatorID, c.stageName]));
  const creatorPhotoMap = Object.fromEntries(creators.map(c => [c.creatorID, c.photoURL ?? undefined]));
  const pendingPayments = entries.filter(e => e.amountPaid < e.totalAmount);
  const outstandingTotal = pendingPayments.reduce((sum, e) => sum + (e.totalAmount - e.amountPaid), 0);

  return (
    <div>
      {/* Top row: outstanding tile + New button */}
      <div className="flex items-start gap-4 mb-6">
        <div className="rounded-xl p-4 border" style={{ background: "var(--sidebar-background)", borderColor: "var(--border-subtle)" }}>
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Outstanding Payments</p>
          <p className="text-2xl font-bold text-red-400 mt-2">{formatAmount(outstandingTotal)}</p>
          <p className="text-xs text-zinc-500 mt-1">
            {pendingPayments.length} entr{pendingPayments.length === 1 ? "y" : "ies"} unpaid
          </p>
        </div>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setShowWizard(true)}>
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        </div>
      </div>

      {/* Pending Payments list */}
      {pendingPayments.length === 0 ? (
        <div className="rounded-lg p-8 text-center" style={{ background: "var(--sidebar-background)", border: "1px solid var(--border-subtle)" }}>
          <p className="text-sm text-muted-foreground">No pending payments.</p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border-subtle)", background: "var(--sidebar-background)" }}>
            <p className="text-sm font-semibold text-zinc-300">Pending Payments</p>
          </div>
          <div className="divide-y divide-zinc-800">
            {pendingPayments.map(entry => (
              <button
                key={entry.id}
                className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-zinc-800/40 transition-colors"
                onClick={() => setViewEntry(entry)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300 font-medium">
                      {TYPE_LABELS[entry.type]}
                    </span>
                    <Avatar className="size-4 shrink-0">
                      <AvatarImage src={creatorPhotoMap[entry.creatorID]} />
                      <AvatarFallback className="text-[8px]">{(creatorMap[entry.creatorID] ?? entry.creatorID).charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span className="text-xs text-zinc-500">{creatorMap[entry.creatorID] ?? entry.creatorID}</span>
                  </div>
                  <p className="text-sm text-zinc-200 truncate">{entry.fanName}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{formatInTimezone(entry.createdTime, userTz)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-medium text-red-400">{formatAmount(entry.amountPaid)}</p>
                  <p className="text-xs text-zinc-500">/ {formatAmount(entry.totalAmount)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {viewEntry && (
        <CampaignViewCard
          entry={viewEntry}
          creatorName={creatorMap[viewEntry.creatorID] ?? viewEntry.creatorID}
          userNames={userNames}
          onClose={() => setViewEntry(null)}
        />
      )}
      {showWizard && (
        <NewCampaignWizard
          creators={creators}
          onClose={() => setShowWizard(false)}
        />
      )}
    </div>
  );
}

// ─── Per-Creator Table ────────────────────────────────────────────────────────

interface CreatorTableProps {
  creatorID: string;
  creatorName: string;
  creators: Creator[];
  userNames: Record<string, string>;
  isActive: boolean;
}

function CreatorCampaignsTable({ creatorID, creatorName, creators, userNames, isActive }: CreatorTableProps) {
  const { userData } = useUserData();
  const userTz = userData?.timezone || undefined;
  const [entries, setEntries] = useState<CampaignEntry[]>([]);
  const [typeFilters, setTypeFilters] = useState<Set<CampaignType>>(new Set(CAMPAIGN_TYPES as readonly CampaignType[]));
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [viewEntry, setViewEntry] = useState<CampaignEntry | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  const toggleType = (t: CampaignType) => {
    setTypeFilters(prev => {
      if (prev.size === 1 && prev.has(t)) return prev;
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
    setPage(0);
  };

  const subscribe = useCallback(() => {
    unsubRef.current?.();
    const q = query(
      collection(db, "campaign-tracking"),
      where("creatorID", "==", creatorID),
      where("type", "in", [...typeFilters])
    );
    unsubRef.current = onSnapshot(q, snap => {
      setEntries(snap.docs.map(d => firestoreToEntry(d.id, d.data() as Record<string, unknown>)));
    });
  }, [creatorID, typeFilters]);

  useEffect(() => {
    if (!isActive) {
      unsubRef.current?.();
      unsubRef.current = null;
      return;
    }
    subscribe();
    return () => { unsubRef.current?.(); unsubRef.current = null; };
  }, [isActive, subscribe]);

  const filtered = entries.filter(e => showArchived || !e.isArchived);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const displayed = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const handleArchive = async (entry: CampaignEntry) => {
    if (entry.amountPaid < entry.totalAmount) {
      toast.error("Cannot archive — payment is still outstanding");
      return;
    }
    try {
      const res = await apiRequest(`/api/campaign-tracking/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isArchived: true }),
      });
      if (!res.ok) throw new Error();
      toast.success("Archived");
    } catch {
      toast.error("Failed to archive");
    }
  };

  const handleUnarchive = async (entry: CampaignEntry) => {
    try {
      const res = await apiRequest(`/api/campaign-tracking/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isArchived: false }),
      });
      if (!res.ok) throw new Error();
      toast.success("Unarchived");
    } catch {
      toast.error("Failed to unarchive");
    }
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-2">
          {(CAMPAIGN_TYPES as readonly CampaignType[]).map(t => (
            <Button
              key={t}
              size="sm"
              variant={typeFilters.has(t) ? "default" : "outline"}
              onClick={() => toggleType(t)}
            >
              {TYPE_BUTTON_LABELS[t]}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Switch
            checked={showArchived}
            onCheckedChange={v => { setShowArchived(v); setPage(0); }}
            id={`show-archived-${creatorID}`}
          />
          <label htmlFor={`show-archived-${creatorID}`} className="text-sm text-zinc-400 cursor-pointer">
            Show Archived
          </label>
          <Button size="sm" onClick={() => setShowWizard(true)}>
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        </div>
      </div>

      {/* Table */}
      {displayed.length === 0 ? (
        <div className="rounded-lg p-8 text-center" style={{ background: "var(--sidebar-background)", border: "1px solid var(--border-subtle)" }}>
          <p className="text-sm text-muted-foreground">No entries found.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created By</TableHead>
                  <TableHead>Fan Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Amount Paid</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayed.map(entry => (
                  <TableRow key={entry.id} className={entry.isArchived ? "opacity-50" : ""}>
                    <TableCell className="text-sm text-zinc-400">
                      {userNames[entry.createdBy] ?? entry.createdBy}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{entry.fanName}</TableCell>
                    <TableCell>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300 font-medium">
                        {TYPE_LABELS[entry.type]}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-zinc-400">
                      {formatInTimezone(entry.createdTime, userTz)}
                    </TableCell>
                    <TableCell
                      className={`text-sm font-medium ${
                        entry.amountPaid < entry.totalAmount ? "text-red-400" : "text-green-400"
                      }`}
                    >
                      {formatAmount(entry.amountPaid)}
                    </TableCell>
                    <TableCell className="text-sm">{formatAmount(entry.totalAmount)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setViewEntry(entry)}>View</DropdownMenuItem>
                          {!entry.isArchived && (
                            <DropdownMenuItem
                              onClick={() => handleArchive(entry)}
                              className={entry.amountPaid < entry.totalAmount ? "opacity-40 cursor-not-allowed" : ""}
                            >
                              Archive
                            </DropdownMenuItem>
                          )}
                          {entry.isArchived && (
                            <DropdownMenuItem onClick={() => handleUnarchive(entry)}>
                              Unarchive
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
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={e => { e.preventDefault(); setPage(p => Math.max(0, p - 1)); }}
                    aria-disabled={safePage === 0}
                    className={safePage === 0 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
                {Array.from({ length: totalPages }, (_, i) => {
                  if (totalPages <= 7 || i === 0 || i === totalPages - 1 || Math.abs(i - safePage) <= 1) {
                    return (
                      <PaginationItem key={i}>
                        <PaginationLink
                          isActive={i === safePage}
                          onClick={e => { e.preventDefault(); setPage(i); }}
                          className="cursor-pointer"
                        >
                          {i + 1}
                        </PaginationLink>
                      </PaginationItem>
                    );
                  }
                  if (i === 1 && safePage > 3) {
                    return <PaginationItem key="ellipsis-start"><PaginationEllipsis /></PaginationItem>;
                  }
                  if (i === totalPages - 2 && safePage < totalPages - 4) {
                    return <PaginationItem key="ellipsis-end"><PaginationEllipsis /></PaginationItem>;
                  }
                  return null;
                })}
                <PaginationItem>
                  <PaginationNext
                    onClick={e => { e.preventDefault(); setPage(p => Math.min(totalPages - 1, p + 1)); }}
                    aria-disabled={safePage === totalPages - 1}
                    className={safePage === totalPages - 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}

      {viewEntry && (
        <CampaignViewCard
          entry={viewEntry}
          creatorName={creatorName}
          userNames={userNames}
          onClose={() => setViewEntry(null)}
        />
      )}
      {showWizard && (
        <NewCampaignWizard
          creators={creators}
          defaultCreatorID={creatorID}
          onClose={() => setShowWizard(false)}
        />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CACampaignsPage() {
  const { user } = useAuth();
  const creators = useCreators();
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState("overview");
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(() => new Set(["overview"]));

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setLoadedTabs(prev => (prev.has(value) ? prev : new Set(prev).add(value)));
  };

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
        <h1 className="text-2xl font-bold tracking-tight mb-2">Campaigns</h1>

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
              <OverviewPanel
                creators={creators}
                userNames={userNames}
                isActive={activeTab === "overview"}
                uid={user?.uid ?? ""}
              />
            </div>
          )}
          {creators.map(c => (
            loadedTabs.has(c.creatorID) && (
              <div key={c.creatorID} className={activeTab === c.creatorID ? "" : "hidden"}>
                <CreatorCampaignsTable
                  creatorID={c.creatorID}
                  creatorName={c.stageName}
                  creators={creators}
                  userNames={userNames}
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

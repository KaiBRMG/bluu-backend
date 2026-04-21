"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/components/AuthProvider";
import AppLayout from "@/components/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext } from "@/components/ui/carousel";
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
import { MoreHorizontal, Plus, AlertCircle } from "lucide-react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/firebase-config";
import {
  type CampaignEntry, type CRType, type CRStatus, type CallType, type Creator,
  STATUS_COLORS, STATUS_SORT, PRIORITY_COLORS, TYPE_LABELS, truncate, formatAmount, sortByStatus,
  firestoreToEntry, formatInTimezone, COMMON_TIMEZONES,
} from "@/lib/campaignTracking";
import { useUserData } from "@/hooks/useUserData";
import { apiRequest } from "@/lib/clientApi";
import { toast } from "sonner";

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CRStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}>
      {status}
    </span>
  );
}

// ─── Entry View / Edit Card ───────────────────────────────────────────────────

interface ViewCardProps {
  entry: CampaignEntry;
  creatorName: string;
  readOnly: boolean;
  onClose: () => void;
}

function ViewCard({ entry, creatorName, readOnly, onClose }: ViewCardProps) {
  const { userData } = useUserData();
  const userTz = userData?.timezone || undefined;
  const [amountPaid, setAmountPaid] = useState(String(entry.amountPaid));
  const [fanName, setFanName] = useState(entry.fanName);
  const [profileLink, setProfileLink] = useState(entry.profileLink);
  const [description, setDescription] = useState(entry.description);
  const [length, setLength] = useState(entry.length ?? "");
  const [address, setAddress] = useState(entry.address ?? "");
  const [socialUsername, setSocialUsername] = useState(entry.socialUsername ?? "");
  const [socialPlatform, setSocialPlatform] = useState(entry.socialPlatform ?? "");
  const [totalAmount, setTotalAmount] = useState(String(entry.totalAmount));
  const [dueDate, setDueDate] = useState(entry.dueDate ? entry.dueDate.split("T")[0] : "");
  const [dueDateTimezone, setDueDateTimezone] = useState(entry.dueDateTimezone ?? "");
  const [saving, setSaving] = useState(false);

  const isEditable = !readOnly || entry.status === "Awaiting Approval";

  const hasChanged =
    amountPaid !== String(entry.amountPaid) ||
    fanName !== entry.fanName ||
    profileLink !== entry.profileLink ||
    description !== entry.description ||
    length !== (entry.length ?? "") ||
    address !== (entry.address ?? "") ||
    socialUsername !== (entry.socialUsername ?? "") ||
    socialPlatform !== (entry.socialPlatform ?? "") ||
    totalAmount !== String(entry.totalAmount) ||
    dueDate !== (entry.dueDate ? entry.dueDate.split("T")[0] : "") ||
    dueDateTimezone !== (entry.dueDateTimezone ?? "");

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { amountPaid: Number(amountPaid) };
      if (isEditable) {
        body.fanName = fanName;
        body.profileLink = profileLink;
        body.description = description;
        body.totalAmount = Number(totalAmount);
        body.dueDate = dueDate || null;
        body.dueDateTimezone = dueDateTimezone || null;
        if (entry.type !== "Item") body.length = length;
        if (entry.type === "Item") body.address = address;
        if (entry.type === "Call") {
          body.socialUsername = socialUsername;
          body.socialPlatform = socialPlatform;
        }
      }
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

  const inputClass = "w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500";
  const readOnlyClass = "w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-300";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 overflow-y-auto py-8">
      <Card className="w-full max-w-lg mx-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{entry.CR}</CardTitle>
            <StatusBadge status={entry.status} />
          </div>
          <p className="text-sm text-zinc-400">{creatorName} · {entry.type}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
          {entry.managerComment && (
            <div className="rounded-lg p-3 bg-red-500/10 border border-red-500/30">
              <p className="text-xs font-medium text-red-400 mb-1">Manager Comment</p>
              <p className="text-sm text-zinc-300 italic">{entry.managerComment}</p>
            </div>
          )}

          <Field label="Fan Name">
            <input value={fanName} onChange={e => setFanName(e.target.value)} disabled={!isEditable} className={isEditable ? inputClass : readOnlyClass} />
          </Field>
          <Field label="Profile Link">
            <input value={profileLink} onChange={e => setProfileLink(e.target.value)} disabled={!isEditable} className={isEditable ? inputClass : readOnlyClass} />
          </Field>
          <Field label="Description">
            <textarea value={description} onChange={e => setDescription(e.target.value)} disabled={!isEditable} rows={3} className={`${isEditable ? inputClass : readOnlyClass} resize-none`} />
          </Field>
          {(entry.type === "CR" || entry.type === "Call") && (
            <Field label="Length">
              <input value={length} onChange={e => setLength(e.target.value)} disabled={!isEditable} className={isEditable ? inputClass : readOnlyClass} />
            </Field>
          )}
          {entry.type === "Item" && (
            <Field label="Address">
              <input value={address} onChange={e => setAddress(e.target.value)} disabled={!isEditable} className={isEditable ? inputClass : readOnlyClass} />
            </Field>
          )}
          {entry.type === "Call" && (
            <>
              <Field label="Social Platform">
                <input value={socialPlatform} onChange={e => setSocialPlatform(e.target.value)} disabled={!isEditable} className={isEditable ? inputClass : readOnlyClass} />
              </Field>
              <Field label="Social Username">
                <input value={socialUsername} onChange={e => setSocialUsername(e.target.value)} disabled={!isEditable} className={isEditable ? inputClass : readOnlyClass} />
              </Field>
            </>
          )}
          <Field label="Due Date">
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} disabled={!isEditable} className={isEditable ? inputClass : readOnlyClass} />
          </Field>
          <Field label="Due Date Timezone">
            {isEditable ? (
              <Select value={dueDateTimezone} onValueChange={setDueDateTimezone}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue placeholder="Select timezone..." /></SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map(tz => <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <p className={readOnlyClass}>{dueDateTimezone || "—"}</p>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Total Amount">
              <input type="number" value={totalAmount} onChange={e => setTotalAmount(e.target.value)} disabled={!isEditable} className={isEditable ? inputClass : readOnlyClass} />
            </Field>
            <Field label="Amount Paid">
              <input type="number" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} className={inputClass} />
            </Field>
          </div>
          {entry.priority && (
            <div>
              <p className="text-xs text-zinc-400 mb-1">Priority</p>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[entry.priority]}`}>
                {entry.priority}
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-zinc-500">Created</p>
              <p className="text-zinc-300">{formatInTimezone(entry.createdTime, userTz)}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Last Edited</p>
              <p className="text-zinc-300">{formatInTimezone(entry.lastEditedTime, userTz)}</p>
            </div>
          </div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-zinc-400 mb-1">{label}</p>
      {children}
    </div>
  );
}

// ─── Rejected Edit Card (My Customs) ─────────────────────────────────────────

interface RejectedCardProps {
  entry: CampaignEntry;
  creatorName: string;
  onClose: () => void;
}

function RejectedCard({ entry, creatorName, onClose }: RejectedCardProps) {
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
    dueDateTimezone: entry.dueDateTimezone ?? "",
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFields(prev => ({ ...prev, [k]: e.target.value }));
    setDirty(true);
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const updatedComment = entry.managerComment
        ? `${entry.managerComment}\n*Resubmitted*`
        : "*Resubmitted*";
      const res = await apiRequest(`/api/campaign-tracking/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          fanName: fields.fanName,
          profileLink: fields.profileLink,
          description: fields.description,
          length: fields.length,
          address: fields.address,
          socialUsername: fields.socialUsername,
          socialPlatform: fields.socialPlatform,
          totalAmount: Number(fields.totalAmount),
          amountPaid: Number(fields.amountPaid),
          dueDate: fields.dueDate || null,
          dueDateTimezone: fields.dueDateTimezone || null,
          status: "Awaiting Approval",
          managerComment: updatedComment,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Resubmitted");
      onClose();
    } catch {
      toast.error("Failed to resubmit");
    } finally {
      setSaving(false);
    }
  };

  const inputClass = "w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 overflow-y-auto py-8">
      <Card className="w-full max-w-lg mx-4">
        <CardHeader>
          <CardTitle>{entry.CR} — Edit &amp; Resubmit</CardTitle>
          <p className="text-sm text-zinc-400">{creatorName}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
          {entry.managerComment && (
            <div className="rounded-lg p-3 bg-red-500/10 border border-red-500/30">
              <p className="text-xs font-medium text-red-400 mb-1">Manager Comment</p>
              <p className="text-sm text-zinc-300 italic">{entry.managerComment}</p>
            </div>
          )}
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
              <Field label="Social Platform"><input value={fields.socialPlatform} onChange={set("socialPlatform")} className={inputClass} /></Field>
              <Field label="Social Username"><input value={fields.socialUsername} onChange={set("socialUsername")} className={inputClass} /></Field>
            </>
          )}
          <Field label="Due Date"><input type="date" value={fields.dueDate} onChange={set("dueDate")} className={inputClass} /></Field>
          <Field label="Due Date Timezone">
            <Select value={fields.dueDateTimezone} onValueChange={v => { setFields(prev => ({ ...prev, dueDateTimezone: v })); setDirty(true); }}>
              <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue placeholder="Select timezone..." /></SelectTrigger>
              <SelectContent>
                {COMMON_TIMEZONES.map(tz => <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Total Amount"><input type="number" value={fields.totalAmount} onChange={set("totalAmount")} className={inputClass} /></Field>
            <Field label="Amount Paid"><input type="number" value={fields.amountPaid} onChange={set("amountPaid")} className={inputClass} /></Field>
          </div>
        </CardContent>
        {dirty && (
          <CardFooter className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>{saving ? "Submitting..." : "Submit"}</Button>
          </CardFooter>
        )}
        {!dirty && (
          <CardFooter className="flex justify-end">
            <Button variant="outline" onClick={onClose}>Close</Button>
          </CardFooter>
        )}
      </Card>
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
  const [step, setStep] = useState(1);
  const [type, setType] = useState<CRType | "">("");
  const { userData } = useUserData();
  const [form, setForm] = useState<Record<string, string>>({
    creatorID: "",
    fanName: "",
    profileLink: "",
    description: "",
    length: "",
    totalAmount: "",
    amountPaid: "",
    address: "",
    socialUsername: "",
    socialPlatform: "",
    callType: "",
    dueDate: "",
    dueDateTimezone: userData?.timezone ?? "",
  });
  const [submitting, setSubmitting] = useState(false);

  const setField = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));
  const setVal = (k: string) => (v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleNext = () => {
    if (step === 1 && !type) return;
    setStep(s => s + 1);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await apiRequest("/api/campaign-tracking/create", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          type,
          totalAmount: Number(form.totalAmount),
          amountPaid: Number(form.amountPaid || 0),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed");
      }
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
          <DialogTitle>
            {step === 1 ? "New Custom Request" : step === 2 ? "Enter Details" : "Confirm Entry"}
          </DialogTitle>
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
              <Button onClick={handleNext} disabled={!type}>Next</Button>
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
                  {creators.map(c => (
                    <SelectItem key={c.creatorID} value={c.creatorID}>{c.stageName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><label className="block text-xs text-zinc-400 mb-1">Fan Name</label><input value={form.fanName} onChange={setField("fanName")} required className={inputClass} /></div>
            <div><label className="block text-xs text-zinc-400 mb-1">Profile Link</label><input value={form.profileLink} onChange={setField("profileLink")} className={inputClass} /></div>
            <div><label className="block text-xs text-zinc-400 mb-1">Description</label><textarea value={form.description} onChange={setField("description")} rows={3} required className={`${inputClass} resize-none`} /></div>
            {(type === "CR" || type === "Call") && (
              <div><label className="block text-xs text-zinc-400 mb-1">Length</label><input value={form.length} onChange={setField("length")} className={inputClass} /></div>
            )}
            {type === "Item" && (
              <div><label className="block text-xs text-zinc-400 mb-1">Address</label><input value={form.address} onChange={setField("address")} className={inputClass} /></div>
            )}
            <div><label className="block text-xs text-zinc-400 mb-1">Due Date</label><input type="date" value={form.dueDate} onChange={setField("dueDate")} className={inputClass} /></div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Due Date Timezone</label>
              <Select value={form.dueDateTimezone} onValueChange={setVal("dueDateTimezone")}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue placeholder="Select timezone..." /></SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map(tz => <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {type === "Call" && (
              <>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Call Type</label>
                  <Select value={form.callType} onValueChange={setVal("callType")}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-700">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(["Clean Video", "Clean Voice", "NSFW Video", "NSFW Voice"] as CallType[]).map(ct => (
                        <SelectItem key={ct} value={ct}>{ct}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><label className="block text-xs text-zinc-400 mb-1">Social Platform</label><input value={form.socialPlatform} onChange={setField("socialPlatform")} className={inputClass} /></div>
                <div><label className="block text-xs text-zinc-400 mb-1">Social Username</label><input value={form.socialUsername} onChange={setField("socialUsername")} className={inputClass} /></div>
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-zinc-400 mb-1">Total Amount</label><input type="number" value={form.totalAmount} onChange={setField("totalAmount")} required className={inputClass} /></div>
              <div><label className="block text-xs text-zinc-400 mb-1">Amount Paid</label><input type="number" value={form.amountPaid} onChange={setField("amountPaid")} className={inputClass} /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep(s => s - 1)}>Back</Button>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleNext}>Next</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-2 py-4 text-sm">
            <p className="text-zinc-400 mb-3">Please confirm the details below are correct before submitting.</p>
            <Row label="Type" value={type === "CR" ? "Custom Request" : type} />
            <Row label="Creator" value={creators.find(c => c.creatorID === form.creatorID)?.stageName ?? form.creatorID} />
            <Row label="Fan Name" value={form.fanName} />
            <Row label="Description" value={truncate(form.description, 120)} />
            <Row label="Total Amount" value={`$${form.totalAmount}`} />
            <Row label="Amount Paid" value={`$${form.amountPaid || "0"}`} />
            {form.length && <Row label="Length" value={form.length} />}
            {form.address && <Row label="Address" value={form.address} />}
            {form.callType && <Row label="Call Type" value={form.callType} />}
            {form.dueDate && <Row label="Due Date" value={form.dueDate} />}
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setStep(s => s - 1)}>Back</Button>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-zinc-500 shrink-0">{label}</span>
      <span className="text-right text-zinc-200">{value}</span>
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

// ─── Creator Requests Table ───────────────────────────────────────────────────

interface CreatorTableProps {
  creatorID: string;
  creatorName: string;
  creators: Creator[];
  userNames: Record<string, string>;
  onCreated: () => void;
}

const PAGE_SIZE = 20;

function CreatorRequestsTable({ creatorID, creatorName, creators, userNames, onCreated }: CreatorTableProps) {
  const { userData } = useUserData();
  const userTz = userData?.timezone || undefined;
  const [entries, setEntries] = useState<CampaignEntry[]>([]);
  const [typeFilter, setTypeFilter] = useState<Set<CRType>>(new Set(["CR", "Call", "Item"]));
  const [showCompleted, setShowCompleted] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [page, setPage] = useState(0);
  const [viewEntry, setViewEntry] = useState<CampaignEntry | null>(null);
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
      const docs = snap.docs.map(d => firestoreToEntry(d.id, d.data() as Record<string, unknown>));
      setEntries(sortByStatus(docs));
    });
  }, [creatorID, showCompleted]);

  useEffect(() => {
    subscribe();
    return () => { unsubRef.current?.(); };
  }, [subscribe]);

  const filtered = entries.filter(e => typeFilter.has(e.type));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const displayed = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const toggleType = (t: CRType) => {
    setTypeFilter(prev => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      setPage(0);
      return next;
    });
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-2">
          {(["CR", "Call", "Item"] as CRType[]).map(t => (
            <Button
              key={t}
              size="sm"
              variant={typeFilter.has(t) ? "default" : "outline"}
              onClick={() => toggleType(t)}
            >
              {TYPE_LABELS[t]}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Switch checked={showCompleted} onCheckedChange={v => { setShowCompleted(v); setPage(0); }} id={`show-completed-${creatorID}`} />
          <label htmlFor={`show-completed-${creatorID}`} className="text-sm text-zinc-400 cursor-pointer">
            Show Completed
          </label>
          <Button size="sm" onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        </div>
      </div>

      {/* Table */}
      {displayed.length === 0 ? (
        <div className="rounded-lg p-8 text-center" style={{ background: "var(--sidebar-background)", border: "1px solid var(--border-subtle)" }}>
          <p className="text-sm text-muted-foreground">No custom requests found.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CR</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
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
                    <TableCell className="text-sm text-zinc-400">
                      {formatInTimezone(entry.createdTime, userTz)}
                    </TableCell>
                    <TableCell className="text-sm">{entry.fanName}</TableCell>
                    <TableCell className={`text-sm font-medium ${entry.amountPaid < entry.totalAmount ? "text-red-400" : "text-green-400"}`}>{formatAmount(entry.amountPaid)}</TableCell>
                    <TableCell className="text-sm">{formatAmount(entry.totalAmount)}</TableCell>
                    <TableCell className="text-sm text-zinc-400">{userNames[entry.createdBy] ?? entry.createdBy}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setViewEntry(entry)}>View</DropdownMenuItem>
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
                  if (i === 1 && safePage > 3) return <PaginationItem key="ellipsis-start"><PaginationEllipsis /></PaginationItem>;
                  if (i === totalPages - 2 && safePage < totalPages - 4) return <PaginationItem key="ellipsis-end"><PaginationEllipsis /></PaginationItem>;
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

      {showNew && (
        <NewEntryWizard
          creators={creators}
          onClose={() => setShowNew(false)}
          onCreated={onCreated}
        />
      )}
      {viewEntry && (
        <ViewCard
          entry={viewEntry}
          creatorName={creatorName}
          readOnly={viewEntry.status === "In Progress" || viewEntry.status === "Completed"}
          onClose={() => setViewEntry(null)}
        />
      )}
    </div>
  );
}

// ─── My Customs Kanban ────────────────────────────────────────────────────────

interface MyCustomsProps {
  currentUserUid: string;
  creators: Creator[];
}

function MyCustomsKanban({ currentUserUid, creators }: MyCustomsProps) {
  const { userData } = useUserData();
  const userTz = userData?.timezone || undefined;
  const [activeEntries, setActiveEntries] = useState<CampaignEntry[]>([]);
  const [rejectedEntries, setRejectedEntries] = useState<CampaignEntry[]>([]);
  const [viewEntry, setViewEntry] = useState<CampaignEntry | null>(null);
  const [showNew, setShowNew] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "campaign-tracking"),
      where("createdBy", "==", currentUserUid),
      where("status", "in", ["Awaiting Approval", "In Progress", "Rejected"])
    );
    unsubRef.current = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => firestoreToEntry(d.id, d.data() as Record<string, unknown>));
      const active = docs.filter(e => e.status !== "Rejected");
      active.sort((a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status]);
      setActiveEntries(active);
      setRejectedEntries(docs.filter(e => e.status === "Rejected"));
    });

    return () => { unsubRef.current?.(); };
  }, [currentUserUid]);

  const creatorMap = Object.fromEntries(creators.map(c => [c.creatorID, c.stageName]));

  // Group active entries by creator
  const byCreator: Record<string, CampaignEntry[]> = {};
  for (const e of activeEntries) {
    if (!byCreator[e.creatorID]) byCreator[e.creatorID] = [];
    byCreator[e.creatorID].push(e);
  }

  const activeCreators = creators.filter(c => byCreator[c.creatorID]?.length);

  const outstandingAmount = [...activeEntries, ...rejectedEntries]
    .reduce((sum, e) => sum + (e.totalAmount - e.amountPaid), 0);

  const isRejectedView = viewEntry && viewEntry.status === "Rejected";

  return (
    <div>
      {/* Summary tiles */}
      <div className="flex items-center gap-4 mb-6">
        <SummaryTile title="Outstanding Payments">
          <p className="text-2xl font-bold text-red-400 mt-2">{formatAmount(outstandingAmount)}</p>
        </SummaryTile>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        </div>
      </div>

      {/* Needs Info Section */}
      {rejectedEntries.length > 0 && (
        <div className="mb-6 rounded-xl p-4 border border-red-500/40 bg-red-500/5">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <h3 className="text-sm font-semibold text-red-400">Needs Info</h3>
          </div>
          <Carousel className="w-full">
            <CarouselContent>
              {rejectedEntries.map(e => (
                <CarouselItem key={e.id} className="basis-64">
                  <Button
                    variant="ghost"
                    className="w-full h-auto text-left p-3 rounded-lg border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 flex-col items-start"
                    onClick={() => setViewEntry(e)}
                  >
                    <p className="font-mono text-sm font-semibold text-red-300">{e.CR}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{creatorMap[e.creatorID] ?? e.creatorID}</p>
                    {e.managerComment && (
                      <p className="text-xs text-zinc-300 mt-2 italic line-clamp-3">{e.managerComment}</p>
                    )}
                  </Button>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious />
            <CarouselNext />
          </Carousel>
        </div>
      )}

      {/* Kanban Board */}
      {activeCreators.length === 0 ? (
        <div className="rounded-lg p-8 text-center" style={{ background: "var(--sidebar-background)", border: "1px solid var(--border-subtle)" }}>
          <p className="text-sm text-muted-foreground">No active custom requests.</p>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {activeCreators.map(creator => (
            <div key={creator.creatorID} className="shrink-0 w-72">
              <div className="mb-3 px-1">
                <h3 className="text-sm font-semibold text-zinc-300">{creator.stageName}</h3>
                <p className="text-xs text-zinc-500">{byCreator[creator.creatorID].length} active</p>
              </div>
              <div className="flex flex-col gap-3">
                {byCreator[creator.creatorID].map(entry => (
                  <div
                    key={entry.id}
                    className="w-full text-left p-3 rounded-xl border transition-colors"
                    style={{ background: "var(--sidebar-background)", borderColor: "var(--border-subtle)" }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="font-mono text-xs text-zinc-400">{entry.CR}</span>
                      <StatusBadge status={entry.status} />
                    </div>
                    <p className="text-sm font-medium text-zinc-200 mb-1">{entry.fanName}</p>
                    <p className="text-xs text-zinc-500 mb-3">{formatInTimezone(entry.createdTime, userTz)}</p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">{entry.type}</span>
                      <span>
                        <span className={`font-medium ${entry.amountPaid < entry.totalAmount ? "text-red-400" : "text-green-400"}`}>{formatAmount(entry.amountPaid)}</span>
                        <span className="text-zinc-300"> / {formatAmount(entry.totalAmount)}</span>
                      </span>
                    </div>
                    <div className="mt-3 pt-2 border-t border-zinc-800">
                      <button
                        className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors underline underline-offset-2"
                        onClick={() => setViewEntry(entry)}
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <NewEntryWizard
          creators={creators}
          onClose={() => setShowNew(false)}
          onCreated={() => {}}
        />
      )}
      {viewEntry && isRejectedView && (
        <RejectedCard
          entry={viewEntry}
          creatorName={creatorMap[viewEntry.creatorID] ?? viewEntry.creatorID}
          onClose={() => setViewEntry(null)}
        />
      )}
      {viewEntry && !isRejectedView && (
        <ViewCard
          entry={viewEntry}
          creatorName={creatorMap[viewEntry.creatorID] ?? viewEntry.creatorID}
          readOnly={viewEntry.status === "In Progress" || viewEntry.status === "Completed"}
          onClose={() => setViewEntry(null)}
        />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CACustomRequestsPage() {
  const { user } = useAuth();
  const [creators, setCreators] = useState<Creator[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState("my-customs");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    user.getIdToken().then(token => {
      const headers = { Authorization: `Bearer ${token}` };
      Promise.all([
        fetch("/api/disputes/creators", { headers }).then(r => r.json()),
        fetch("/api/users/display-names", { headers }).then(r => r.json()),
      ]).then(([creatorsData, usersData]) => {
        if (cancelled) return;
        setCreators(creatorsData.creators ?? []);
        const map: Record<string, string> = {};
        for (const u of (usersData.users ?? [])) map[u.uid] = u.displayName;
        setUserNames(map);
      }).catch(() => {});
    });
    return () => { cancelled = true; };
  }, [user]);

  const uid = user?.uid ?? "";

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
            <TabsTrigger value="my-customs" className="justify-start">My Customs</TabsTrigger>
            {creators.map(c => (
              <TabsTrigger key={c.creatorID} value={c.creatorID} className="justify-start">
                {c.stageName}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex-1 min-w-0">
            <TabsContent value="my-customs">
              {uid && <MyCustomsKanban currentUserUid={uid} creators={creators} />}
            </TabsContent>
            {creators.map(c => (
              <TabsContent key={c.creatorID} value={c.creatorID}>
                {activeTab === c.creatorID && (
                  <CreatorRequestsTable
                    creatorID={c.creatorID}
                    creatorName={c.stageName}
                    creators={creators}
                    userNames={userNames}
                    onCreated={() => {}}
                  />
                )}
              </TabsContent>
            ))}
          </div>
        </Tabs>
      </div>
    </AppLayout>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useAuth } from "@/components/AuthProvider";
import AppLayout from "@/components/AppLayout";
import { useCreators } from "@/hooks/useCreators";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
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
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { TimezoneCombobox } from "@/components/ui/timezone-combobox";
import { Calendar } from "@/components/ui/calendar";
import { MoreHorizontal, Plus, AlertCircle, Info, Search, CalendarIcon } from "lucide-react";
import { resolveUserName } from "@/components/DeletedUser";
import { useUserName } from "@/hooks/useUserName";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/firebase-config";
import {
  type CampaignEntry, type CRType, type CRStatus, type CallType, type Creator,
  STATUS_COLORS, STATUS_SORT, PRIORITY_COLORS, TYPE_LABELS, truncate, formatAmount, sortByStatus,
  firestoreToEntry, formatInTimezone, formatDueDate, CAMPAIGN_TYPES,
} from "@/lib/campaignTracking";
import { useUserData } from "@/hooks/useUserData";
import { apiRequest } from "@/lib/clientApi";
import { toast } from "sonner";
import { TransferDialog, ConfirmDialog, ARCHIVE_CR_TEXT, UNARCHIVE_CR_TEXT } from "@/components/campaign/entryActions";
import { OutstandingPaymentsDonut } from "@/components/campaign/OutstandingPaymentsDonut";

// ─── Date picker ─────────────────────────────────────────────────────────────

function DatePickerInput({ value, onChange, disabled, className, disabledClassName }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className: string;
  disabledClassName?: string;
}) {
  const dateObj = value ? new Date(value + "T12:00:00") : undefined;
  const label = dateObj?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (disabled) {
    return <p className={disabledClassName ?? className}>{label ?? "—"}</p>;
  }
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

// ─── Entry View / Edit Card ───────────────────────────────────────────────────

interface ViewCardProps {
  entry: CampaignEntry;
  creatorName: string;
  onClose: () => void;
  userNames?: Record<string, string>;
}

function ViewCard({ entry, creatorName, onClose, userNames = {} }: ViewCardProps) {
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
  const [dueTime, setDueTime] = useState(entry.dueDate?.includes("T") ? (entry.dueDate.split("T")[1]?.substring(0, 5) ?? "") : "");
  const [dueDateTimezone, setDueDateTimezone] = useState(entry.dueDateTimezone ?? "");
  const [saving, setSaving] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmUnarchive, setConfirmUnarchive] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const isArchivedStatus = entry.status === "Archived";

  const doArchive = async () => {
    setActionLoading(true);
    try {
      const res = await apiRequest(`/api/campaign-tracking/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "Archived", totalAmount: entry.amountPaid, isArchived: false }),
      });
      if (!res.ok) throw new Error();
      toast.success("Archived");
      onClose();
    } catch {
      toast.error("Failed to archive");
    } finally {
      setActionLoading(false);
      setConfirmArchive(false);
    }
  };

  const doUnarchive = async () => {
    setActionLoading(true);
    try {
      const res = await apiRequest(`/api/campaign-tracking/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "In Progress", isArchived: false }),
      });
      if (!res.ok) throw new Error();
      toast.success("Unarchived");
      onClose();
    } catch {
      toast.error("Failed to unarchive");
    } finally {
      setActionLoading(false);
      setConfirmUnarchive(false);
    }
  };

  const isEditable = true;

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
    dueTime !== (entry.dueDate?.includes("T") ? (entry.dueDate.split("T")[1]?.substring(0, 5) ?? "") : "") ||
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
        body.dueDate = dueDate
          ? (entry.type === "Call" && dueTime ? `${dueDate}T${dueTime}` : dueDate)
          : null;
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
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm">
            <div>
              <p className="text-xs text-zinc-500">Created By</p>
              <p className="text-zinc-300">{resolveUserName(entry.createdBy, userNames)}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Last Edited By</p>
              <p className="text-zinc-300">{resolveUserName(entry.lastEditedBy, userNames)}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Due Date</p>
              <p className="text-zinc-300">{formatDueDate(entry.dueDate)}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Last Edited</p>
              <p className="text-zinc-300">{formatInTimezone(entry.lastEditedTime, userTz)}</p>
            </div>
          </div>
          <div className={`rounded-lg p-3 border ${Number(amountPaid) >= Number(totalAmount) ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Total Amount">
                <input type="number" value={totalAmount} onChange={e => setTotalAmount(e.target.value)} disabled={!isEditable} className={isEditable ? inputClass : readOnlyClass} />
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
                <input type="number" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} className={inputClass} />
              </div>
            </div>
          </div>
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
          <Field label={entry.type === "Call" ? "Call Time" : "Due Date"}>
            {entry.type === "Call" ? (
              <div className="flex gap-2">
                <DatePickerInput
                  value={dueDate}
                  onChange={setDueDate}
                  disabled={!isEditable}
                  className={inputClass}
                  disabledClassName={readOnlyClass}
                />
                {isEditable ? (
                  <input
                    type="time"
                    value={dueTime}
                    onChange={e => setDueTime(e.target.value)}
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 [color-scheme:dark]"
                  />
                ) : (
                  <p className={readOnlyClass}>{dueTime || "—"}</p>
                )}
              </div>
            ) : (
              <DatePickerInput
                value={dueDate}
                onChange={setDueDate}
                disabled={!isEditable}
                className={inputClass}
                disabledClassName={readOnlyClass}
              />
            )}
          </Field>
          <Field label="Due Date Timezone">
            {isEditable ? (
              <TimezoneCombobox value={dueDateTimezone} onChange={setDueDateTimezone} />
            ) : (
              <p className={readOnlyClass}>{dueDateTimezone || "—"}</p>
            )}
          </Field>
          {entry.priority && (
            <div>
              <p className="text-xs text-zinc-400 mb-1">Priority</p>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[entry.priority]}`}>
                {entry.priority}
              </span>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Actions</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowTransfer(true)}>Transfer</DropdownMenuItem>
              {isArchivedStatus ? (
                <DropdownMenuItem onClick={() => setConfirmUnarchive(true)}>Unarchive</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => setConfirmArchive(true)}>Archive</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={handleSave} disabled={saving || !hasChanged}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </CardFooter>
      </Card>

      {showTransfer && (
        <TransferDialog entryId={entry.id} onClose={() => setShowTransfer(false)} onTransferred={onClose} />
      )}
      {confirmArchive && (
        <ConfirmDialog
          title="Archive Custom"
          description={ARCHIVE_CR_TEXT}
          onConfirm={doArchive}
          onClose={() => setConfirmArchive(false)}
          loading={actionLoading}
        />
      )}
      {confirmUnarchive && (
        <ConfirmDialog
          title="Unarchive Custom"
          description={UNARCHIVE_CR_TEXT}
          onConfirm={doUnarchive}
          onClose={() => setConfirmUnarchive(false)}
          loading={actionLoading}
        />
      )}
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
    dueTime: entry.dueDate?.includes("T") ? (entry.dueDate.split("T")[1]?.substring(0, 5) ?? "") : "",
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
          dueDate: fields.dueDate
            ? (entry.type === "Call" && fields.dueTime ? `${fields.dueDate}T${fields.dueTime}` : fields.dueDate)
            : null,
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
          <Field label={entry.type === "Call" ? "Call Time" : "Due Date"}>
            {entry.type === "Call" ? (
              <div className="flex gap-2">
                <DatePickerInput
                  value={fields.dueDate}
                  onChange={v => { setFields(prev => ({ ...prev, dueDate: v })); setDirty(true); }}
                  className={inputClass}
                />
                <input
                  type="time"
                  value={fields.dueTime}
                  onChange={e => { setFields(prev => ({ ...prev, dueTime: e.target.value })); setDirty(true); }}
                  className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 [color-scheme:dark]"
                />
              </div>
            ) : (
              <DatePickerInput
                value={fields.dueDate}
                onChange={v => { setFields(prev => ({ ...prev, dueDate: v })); setDirty(true); }}
                className={inputClass}
              />
            )}
          </Field>
          <Field label="Due Date Timezone">
            <TimezoneCombobox value={fields.dueDateTimezone} onChange={v => { setFields(prev => ({ ...prev, dueDateTimezone: v })); setDirty(true); }} />
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
    dueTime: "",
    dueDateTimezone: userData?.timezone ?? "",
  });
  const [submitting, setSubmitting] = useState(false);

  const setField = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));
  const setVal = (k: string) => (v: string) => setForm(prev => ({ ...prev, [k]: v }));
  const setCreator = (creatorID: string) => {
    const creator = creators.find(c => c.creatorID === creatorID);
    setForm(prev => ({
      ...prev,
      creatorID,
      dueDateTimezone: creator?.defaultTimezone ?? prev.dueDateTimezone,
    }));
  };

  const handleNext = () => {
    if (step === 1 && !type) return;
    setStep(s => s + 1);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const { dueTime, ...formToSave } = form;
      const saveDueDate = formToSave.dueDate
        ? (type === "Call" && dueTime ? `${formToSave.dueDate}T${dueTime}` : formToSave.dueDate)
        : "";
      const res = await apiRequest("/api/campaign-tracking/create", {
        method: "POST",
        body: JSON.stringify({
          ...formToSave,
          dueDate: saveDueDate || null,
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
              <Select value={form.creatorID} onValueChange={setCreator}>
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
            <div>
              <div className="flex items-center gap-1 mb-1">
                <label className="block text-xs text-zinc-400">Description</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className="text-zinc-500 hover:text-zinc-300 transition-colors">
                      <Info size={12} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="max-w-xs text-xs" side="right">
                    This is the instructions for the creator. Ensure you describe in detail what they need to do and what is expected of them. Ensure it is clear and legible, the creator will see this!
                  </PopoverContent>
                </Popover>
              </div>
              <textarea value={form.description} onChange={setField("description")} rows={3} required className={`${inputClass} resize-none`} />
            </div>
            {(type === "CR" || type === "Call") && (
              <div><label className="block text-xs text-zinc-400 mb-1">Length</label><input value={form.length} onChange={setField("length")} className={inputClass} /></div>
            )}
            {type === "Item" && (
              <div><label className="block text-xs text-zinc-400 mb-1">Address</label><input value={form.address} onChange={setField("address")} className={inputClass} /></div>
            )}
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
              <div className="flex items-center gap-1 mb-1">
                <label className="block text-xs text-zinc-400">Due Date Timezone</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className="text-zinc-500 hover:text-zinc-300 transition-colors">
                      <Info size={12} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="max-w-xs text-xs" side="right">
                    This is the creator&apos;s default time zone. If this custom requires a different time zone, please select it here.
                  </PopoverContent>
                </Popover>
              </div>
              <TimezoneCombobox value={form.dueDateTimezone} onChange={setVal("dueDateTimezone")} />
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
            {form.dueDate && <Row label={type === "Call" ? "Call Time" : "Due Date"} value={type === "Call" && form.dueTime ? `${form.dueDate} at ${form.dueTime}` : form.dueDate} />}
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

// ─── Creator Requests Table ───────────────────────────────────────────────────

interface CreatorTableProps {
  creatorID: string;
  creatorName: string;
  creators: Creator[];
  userNames: Record<string, string>;
  onCreated: () => void;
  isActive: boolean;
}

const PAGE_SIZE = 20;

function CreatorRequestsTable({ creatorID, creatorName, creators, userNames, onCreated, isActive }: CreatorTableProps) {
  const [entries, setEntries] = useState<CampaignEntry[]>([]);
  const [typeFilter, setTypeFilter] = useState<Set<CRType>>(new Set(["CR", "Call", "Item"]));
  const [showCompleted, setShowCompleted] = useState(false);
  const [archivedOnly, setArchivedOnly] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewEntry, setViewEntry] = useState<CampaignEntry | null>(null);
  const [transferEntry, setTransferEntry] = useState<CampaignEntry | null>(null);
  const [archiveEntry, setArchiveEntry] = useState<CampaignEntry | null>(null);
  const [unarchiveEntry, setUnarchiveEntry] = useState<CampaignEntry | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  const doArchive = async () => {
    if (!archiveEntry) return;
    setActionLoading(true);
    try {
      const res = await apiRequest(`/api/campaign-tracking/${archiveEntry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "Archived", totalAmount: archiveEntry.amountPaid, isArchived: false }),
      });
      if (!res.ok) throw new Error();
      toast.success("Archived");
    } catch {
      toast.error("Failed to archive");
    } finally {
      setActionLoading(false);
      setArchiveEntry(null);
    }
  };

  const doUnarchive = async () => {
    if (!unarchiveEntry) return;
    setActionLoading(true);
    try {
      const res = await apiRequest(`/api/campaign-tracking/${unarchiveEntry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "In Progress", isArchived: false }),
      });
      if (!res.ok) throw new Error();
      toast.success("Unarchived");
    } catch {
      toast.error("Failed to unarchive");
    } finally {
      setActionLoading(false);
      setUnarchiveEntry(null);
    }
  };

  const subscribe = useCallback(() => {
    if (unsubRef.current) unsubRef.current();
    // Archived is always loaded so it stays searchable and available to the
    // Archived badge without a re-subscribe.
    const statusFilter: CRStatus[] = showCompleted
      ? ["Awaiting Approval", "In Progress", "Rejected", "Completed", "Archived"]
      : ["Awaiting Approval", "In Progress", "Rejected", "Archived"];

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
    if (!isActive) {
      unsubRef.current?.();
      unsubRef.current = null;
      return;
    }
    subscribe();
    return () => { unsubRef.current?.(); };
  }, [isActive, subscribe]);

  const searchLower = searchQuery.toLowerCase();
  const matchesSearch = (e: CampaignEntry) =>
    e.CR.toLowerCase().includes(searchLower) ||
    e.fanName.toLowerCase().includes(searchLower) ||
    e.profileLink.toLowerCase().includes(searchLower) ||
    (userNames[e.createdBy] ?? e.createdBy).toLowerCase().includes(searchLower);
  // Search spans all loaded entries (including archived); otherwise the Archived
  // badge shows only archived entries and the default view hides them.
  const filtered = searchLower
    ? entries.filter(matchesSearch)
    : archivedOnly
      ? entries.filter(e => e.status === "Archived")
      : entries.filter(e => e.status !== "Archived" && typeFilter.has(e.type));
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
            <Badge
              key={t}
              variant={!archivedOnly && typeFilter.has(t) ? "default" : "outline"}
              onClick={() => { if (!archivedOnly) toggleType(t); }}
              className={archivedOnly ? "opacity-40 pointer-events-none select-none" : "cursor-pointer select-none"}
            >
              {TYPE_LABELS[t]}
            </Badge>
          ))}
          <Badge
            variant={archivedOnly ? "destructive" : "outline"}
            onClick={() => { setArchivedOnly(v => !v); setPage(0); }}
            className="cursor-pointer select-none"
          >
            Archived
          </Badge>
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setPage(0); }}
            placeholder="Search for CR Code, Fans, Profile Links, Users..."
            className="pl-8 h-8 text-xs bg-zinc-800 border-zinc-700"
          />
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Switch
            checked={showCompleted}
            onCheckedChange={v => { setShowCompleted(v); setPage(0); }}
            id={`show-completed-${creatorID}`}
            disabled={archivedOnly}
          />
          <label htmlFor={`show-completed-${creatorID}`} className={archivedOnly ? "text-sm text-zinc-600 cursor-not-allowed" : "text-sm text-zinc-400 cursor-pointer"}>
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
                    <TableCell className="text-sm text-zinc-400">
                      {formatDueDate(entry.dueDate)}
                    </TableCell>
                    <TableCell className="text-sm">{entry.fanName}</TableCell>
                    <TableCell className={`text-sm font-medium ${entry.amountPaid < entry.totalAmount ? "text-red-400" : "text-green-400"}`}>{formatAmount(entry.amountPaid)}</TableCell>
                    <TableCell className="text-sm">{formatAmount(entry.totalAmount)}</TableCell>
                    <TableCell className="text-sm text-zinc-400">{resolveUserName(entry.createdBy, userNames)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setViewEntry(entry)}>View</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setTransferEntry(entry)}>Transfer</DropdownMenuItem>
                          {entry.status === "Archived" ? (
                            <DropdownMenuItem onClick={() => setUnarchiveEntry(entry)}>Unarchive</DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => setArchiveEntry(entry)}>Archive</DropdownMenuItem>
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
          onClose={() => setViewEntry(null)}
          userNames={userNames}
        />
      )}
      {transferEntry && (
        <TransferDialog entryId={transferEntry.id} onClose={() => setTransferEntry(null)} />
      )}
      {archiveEntry && (
        <ConfirmDialog
          title="Archive Custom"
          description={ARCHIVE_CR_TEXT}
          onConfirm={doArchive}
          onClose={() => setArchiveEntry(null)}
          loading={actionLoading}
        />
      )}
      {unarchiveEntry && (
        <ConfirmDialog
          title="Unarchive Custom"
          description={UNARCHIVE_CR_TEXT}
          onConfirm={doUnarchive}
          onClose={() => setUnarchiveEntry(null)}
          loading={actionLoading}
        />
      )}
    </div>
  );
}

// ─── My Customs Kanban ────────────────────────────────────────────────────────

interface MyCustomsProps {
  currentUserUid: string;
  creators: Creator[];
  userNames: Record<string, string>;
  isActive: boolean;
}

function MyCustomsKanban({ currentUserUid, creators, userNames, isActive }: MyCustomsProps) {
  const { userData } = useUserData();
  const userTz = userData?.timezone || undefined;
  const [activeEntries, setActiveEntries] = useState<CampaignEntry[]>([]);
  const [rejectedEntries, setRejectedEntries] = useState<CampaignEntry[]>([]);
  const [completedUnpaidEntries, setCompletedUnpaidEntries] = useState<CampaignEntry[]>([]);
  const [viewEntry, setViewEntry] = useState<CampaignEntry | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [page, setPage] = useState(0);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isActive) {
      unsubRef.current?.();
      unsubRef.current = null;
      return;
    }
    const q = query(
      collection(db, "campaign-tracking"),
      where("createdBy", "==", currentUserUid),
      where("status", "in", ["Awaiting Approval", "In Progress", "Rejected", "Completed"])
    );
    unsubRef.current = onSnapshot(q, snap => {
      const docs = snap.docs
        .map(d => firestoreToEntry(d.id, d.data() as Record<string, unknown>))
        .filter(e => !(CAMPAIGN_TYPES as readonly string[]).includes(e.type));
      const active = docs.filter(e => e.status === "Awaiting Approval" || e.status === "In Progress");
      active.sort((a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status]);
      const completedUnpaid = docs.filter(e => e.status === "Completed" && e.amountPaid < e.totalAmount);
      setActiveEntries(active);
      setRejectedEntries(docs.filter(e => e.status === "Rejected"));
      setCompletedUnpaidEntries(completedUnpaid);
    });

    return () => { unsubRef.current?.(); };
  }, [isActive, currentUserUid]);

  const creatorMap = Object.fromEntries(creators.map(c => [c.creatorID, c.stageName]));

  // Drop entries whose creator is archived/inactive (absent from the active
  // creator list) from every view and from the outstanding total.
  const activeCreatorIds = new Set(creators.map(c => c.creatorID));
  const visibleActive = activeEntries.filter(e => activeCreatorIds.has(e.creatorID));
  const visibleCompletedUnpaid = completedUnpaidEntries.filter(e => activeCreatorIds.has(e.creatorID));
  const visibleRejected = rejectedEntries.filter(e => activeCreatorIds.has(e.creatorID));

  // Group active + completed-unpaid entries by creator
  const kanbanEntries = [...visibleActive, ...visibleCompletedUnpaid];
  const byCreator: Record<string, CampaignEntry[]> = {};
  for (const e of kanbanEntries) {
    if (!byCreator[e.creatorID]) byCreator[e.creatorID] = [];
    byCreator[e.creatorID].push(e);
  }

  const activeCreators = creators.filter(c => byCreator[c.creatorID]?.length);

  const CREATORS_PER_PAGE = 9;
  const totalPages = Math.max(1, Math.ceil(activeCreators.length / CREATORS_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedCreators = activeCreators.slice(safePage * CREATORS_PER_PAGE, (safePage + 1) * CREATORS_PER_PAGE);

  const outstandingEntries = [...visibleActive, ...visibleCompletedUnpaid, ...visibleRejected];

  const isRejectedView = viewEntry && viewEntry.status === "Rejected";

  return (
    <div>
      {/* Summary tiles */}
      <div className="flex items-start gap-4 mb-6">
        <div className="w-64 shrink-0">
          <OutstandingPaymentsDonut entries={outstandingEntries} creators={creators} />
        </div>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        </div>
      </div>

      {/* Needs Info Section */}
      {visibleRejected.length > 0 && (
        <div className="mb-6 rounded-xl p-4 border border-red-500/40 bg-red-500/5">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <h3 className="text-sm font-semibold text-red-400">Needs Info</h3>
          </div>
          <Carousel className="w-full">
            <CarouselContent>
              {visibleRejected.map(e => (
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
        <>
        <div className="grid grid-cols-3 gap-4 pb-4">
          {pagedCreators.map(creator => (
            <div key={creator.creatorID} className="min-w-0">
              <div className="mb-3 px-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <Avatar className="size-6 shrink-0">
                    <AvatarImage src={creator.photoURL ?? undefined} />
                    <AvatarFallback className="text-[10px]">{creator.stageName.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <h3 className="text-sm font-semibold text-zinc-300">{creator.stageName}</h3>
                </div>
                <p className="text-xs text-zinc-500">{byCreator[creator.creatorID].length} entries</p>
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
                      <div className="flex flex-col items-end gap-1">
                        <StatusBadge status={entry.status} />
                        {entry.amountPaid < entry.totalAmount && (
                          <span className="text-xs font-medium text-red-400">Unpaid</span>
                        )}
                      </div>
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
        </>
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
          onClose={() => setViewEntry(null)}
          userNames={userNames}
        />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CACustomRequestsPage() {
  const { user } = useAuth();
  const creators = useCreators();
  const { names: userNames } = useUserName();
  const [activeTab, setActiveTab] = useState("my-customs");
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(() => new Set(["my-customs"]));

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setLoadedTabs(prev => (prev.has(value) ? prev : new Set(prev).add(value)));
  };

  const uid = user?.uid ?? "";

  // Merge creator names into the name map so creator UIDs (e.g. a creator who
  // last edited a CR from the portal) resolve to their stage name, not the raw UID.
  const nameMap = useMemo(() => {
    const m = { ...userNames };
    for (const c of creators) m[c.creatorID] = c.stageName;
    return m;
  }, [userNames, creators]);

  return (
    <AppLayout>
      <div className="max-w-7xl">
        <h1 className="text-2xl font-bold tracking-tight mb-2">Custom Requests</h1>

        <div className="mt-6 flex items-center gap-3">
          <label htmlFor="creator-select" className="text-sm font-medium text-zinc-300 shrink-0">
            Select a Creator
          </label>
          <Select value={activeTab} onValueChange={handleTabChange}>
            <SelectTrigger id="creator-select" className="w-64 bg-zinc-800 border-zinc-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="my-customs">My Customs</SelectItem>
              {creators.map(c => (
                <SelectItem key={c.creatorID} value={c.creatorID}>{c.stageName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-6">
          {loadedTabs.has("my-customs") && uid && (
            <div className={activeTab === "my-customs" ? "" : "hidden"}>
              <MyCustomsKanban currentUserUid={uid} creators={creators} userNames={nameMap} isActive={activeTab === "my-customs"} />
            </div>
          )}
          {creators.map(c => (
            loadedTabs.has(c.creatorID) && (
              <div key={c.creatorID} className={activeTab === c.creatorID ? "" : "hidden"}>
                <CreatorRequestsTable
                  creatorID={c.creatorID}
                  creatorName={c.stageName}
                  creators={creators}
                  userNames={nameMap}
                  onCreated={() => {}}
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

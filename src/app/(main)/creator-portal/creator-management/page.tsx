"use client";

import { Fragment, useState, useEffect, useRef, useCallback } from 'react';
import { getAuth } from 'firebase/auth';
import AppLayout from "@/components/AppLayout";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { MoreHorizontal, UserCircle, Copy, Check, Info, ChevronRight, CornerDownRight, Plus, Loader2Icon } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { timezoneLabel } from "@/lib/timezone";
import { toast } from "sonner";
import { CreatorAvatar } from '@/components/creators/CreatorChip';
import { SubAccountsDialog } from '@/components/admin/creators/SubAccountsDialog';
import { useRefreshCreators } from '@/hooks/useCreators';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Creator {
  uid: string;
  creatorID: string;
  stageName: string;
  displayName: string;
  photoURL: string | null;
  photoStoragePath: string | null;
  OFID: string;
  isActive: boolean;
  isArchived: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  driveLink?: string;
  defaultTimezone?: string;
  /** Null until the creator spends their one-time link in Telegram. Since
   *  Telegram is the only way into the creator portal, this doubles as "can
   *  this creator actually sign in yet?". */
  telegram?: { username: string | null; linkedAt: string | null } | null;
  /** Other accounts this creator runs, archived ones included. Projected by
   *  GET /api/admin/creators so the table needs no request per row. */
  subAccounts: SubAccountSummary[];
}

interface SubAccountSummary {
  subAccountId: string;
  label: string;
  stageName: string;
  OFID: string;
  isArchived: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const user = getAuth().currentUser;
  if (!user) throw new Error('Not authenticated');
  return user.getIdToken();
}

async function apiRequest(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Creator Form Dialog ──────────────────────────────────────────────────────

/** The server's own message names the rule that failed; fall back to the status. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === 'string' && body.error) return body.error;
  } catch {
    /* non-JSON error body — keep the fallback */
  }
  return `${fallback} (${res.status})`;
}

/**
 * Mint a one-time Telegram connection link. Minting voids any previous
 * outstanding link for this creator — it is not idempotent, it revokes. The link
 * is never stored anywhere readable, so there is no "show it again": lose it,
 * mint another.
 */
async function mintTelegramLink(uid: string): Promise<string> {
  const res = await apiRequest(`/api/admin/creators/${uid}/telegram-link`, { method: 'POST' });
  if (!res.ok) throw new Error(await errorMessage(res, 'Could not generate a connection link'));
  const { url } = (await res.json()) as { url: string };
  return url;
}

interface TelegramLinkFieldProps {
  uid: string;
  connected: boolean;
  /** A link minted by the caller (the add flow mints one on create). */
  initialUrl?: string | null;
}

/**
 * The creator's Telegram connection link with a copy button — Telegram is the
 * only way into the creator portal, so this is what the admin sends. Generating
 * is an immediate action, separate from the form's Save.
 */
function TelegramLinkField({ uid, connected, initialUrl = null }: TelegramLinkFieldProps) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy the link.');
    }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const next = await mintTelegramLink(uid);
      setUrl(next);
      await copy(next);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not generate a connection link.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`creator-telegram-${uid}`} className="text-xs text-zinc-400">Telegram link</Label>
      {url ? (
        <div className="relative">
          <Input
            id={`creator-telegram-${uid}`}
            value={url}
            readOnly
            onFocus={e => e.currentTarget.select()}
            className="pr-10 text-zinc-300"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => copy(url)}
            aria-label={copied ? 'Link copied' : 'Copy Telegram link'}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 text-zinc-400 hover:text-white"
          >
            {copied ? <Check aria-hidden className="text-green-400" /> : <Copy aria-hidden />}
          </Button>
        </div>
      ) : (
        <Button
          id={`creator-telegram-${uid}`}
          type="button"
          variant="outline"
          onClick={generate}
          disabled={generating}
          className="w-full"
        >
          {generating ? <Loader2Icon aria-hidden className="activity-spinner" /> : <Copy aria-hidden />}
          {connected ? 'Copy new Telegram link' : 'Copy Telegram link'}
        </Button>
      )}
      <p className="text-xs text-zinc-400">
        {url
          ? 'Single use, expires in 7 days. Generating another voids this one.'
          : connected
            ? 'Already connected. A new link is only needed if they lost their Telegram account.'
            : 'Not connected yet. They cannot sign in until they open this link in Telegram.'}
      </p>
    </div>
  );
}

interface CreatorFormProps {
  initial: Creator | null;
  onSaved: () => void;
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
  /** Refetch without closing — the add flow stays open to hand over the link. */
  onRefresh: () => void;
}

function CreatorForm({ initial, onSaved, onCancel, onBusyChange, onRefresh }: CreatorFormProps) {
  const isEdit = !!initial;
  const [stageName, setStageName] = useState(initial?.stageName ?? '');
  const [OFID, setOFID] = useState(initial?.OFID ?? '');
  const [driveLink, setDriveLink] = useState(initial?.driveLink ?? '');
  // Read-only: `defaultTimezone` is detected from the creator's own device when
  // they sign in (POST /api/creator/timezone) and is the basis of every due-date
  // calculation. An admin value here would be silently overwritten at their next
  // sign-in, so the field reports rather than edits.
  const detectedTimezone = initial?.defaultTimezone ?? '';
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(initial?.photoURL ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Set once the add succeeds: the dialog then turns into the link hand-over.
  const [created, setCreated] = useState<{ uid: string; url: string | null } | null>(null);

  // A picked photo previews from an object URL; release it when it is replaced
  // or the dialog closes, or every re-pick leaks the whole image.
  useEffect(() => {
    if (!photoPreview?.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const uploadPhoto = async (uid: string, file: File) => {
    const imageData = await toBase64(file);
    return apiRequest(`/api/admin/creators/${uid}/photo`, {
      method: 'POST',
      body: JSON.stringify({ imageData, contentType: file.type }),
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    onBusyChange(true);

    try {
      if (isEdit && initial) {
        const res = await apiRequest(`/api/admin/creators/${initial.uid}`, {
          method: 'PUT',
          body: JSON.stringify({ stageName, OFID, driveLink }),
        });
        if (!res.ok) throw new Error(await errorMessage(res, 'Could not save changes'));

        if (photoFile) {
          const photoRes = await uploadPhoto(initial.uid, photoFile);
          if (!photoRes.ok) throw new Error(await errorMessage(photoRes, 'Details saved, but the photo did not upload'));
        }
        toast.success(`${stageName} updated`);
      } else {
        const res = await apiRequest('/api/admin/creators', {
          method: 'POST',
          body: JSON.stringify({ stageName, OFID, driveLink }),
        });
        if (!res.ok) throw new Error(await errorMessage(res, 'Could not add the creator'));
        const { uid } = (await res.json()) as { uid: string };

        // The account exists at this point, so a failed photo or link must not
        // read as a failed create — the admin would add them a second time.
        const photoRes = photoFile ? await uploadPhoto(uid, photoFile).catch(() => null) : undefined;
        if (photoRes === null || (photoRes && !photoRes.ok)) {
          toast.warning(`${stageName} added, but the photo did not upload.`, {
            description: 'Edit the creator to try the photo again.',
          });
        }
        // A failed mint leaves the field's own generate button to retry with.
        const url = await mintTelegramLink(uid).catch(() => null);
        setCreated({ uid, url });
        onRefresh();
        return;
      }

      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  };

  if (created) {
    return (
      <div className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{stageName} added</DialogTitle>
          <DialogDescription>
            Send them this link. Opening it in Telegram connects their account and signs them in.
          </DialogDescription>
        </DialogHeader>
        <TelegramLinkField uid={created.uid} connected={false} initialUrl={created.url} />
        <DialogFooter>
          <Button type="button" onClick={onCancel}>Done</Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{isEdit ? `Edit ${initial?.stageName}` : 'Add creator'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Changes apply to their portal account straight away.'
            : 'Creates their portal account. They sign in through Telegram once you send them a link.'}
        </DialogDescription>
      </DialogHeader>

      {/* One target for the photo: the avatar and its caption are one button. */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="group mx-auto flex flex-col items-center gap-2 rounded-lg p-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Avatar className="size-20 border border-white/[0.07]">
          {photoPreview && <AvatarImage src={photoPreview} alt="" className="object-cover" />}
          <AvatarFallback className="bg-white/[0.04]">
            <UserCircle aria-hidden className="size-10 text-zinc-500" />
          </AvatarFallback>
        </Avatar>
        <span className="text-xs text-zinc-400 transition-colors group-hover:text-white">
          {photoPreview ? 'Change photo' : 'Upload photo'}
        </span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={handlePhotoChange}
      />

      <div className="space-y-1.5">
        <Label htmlFor="creator-stage-name" className="text-xs text-zinc-400">Stage name</Label>
        <Input
          id="creator-stage-name"
          value={stageName}
          onChange={e => setStageName(e.target.value)}
          required
          autoFocus={!isEdit}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="creator-ofid" className="text-xs text-zinc-400">OFID</Label>
        <div className="flex">
          <span
            aria-hidden
            className="flex items-center rounded-l-md border border-r-0 border-input bg-white/[0.04] px-3 text-sm text-zinc-400"
          >
            @
          </span>
          <Input
            id="creator-ofid"
            value={OFID.startsWith('@') ? OFID.slice(1) : OFID}
            onChange={e => setOFID('@' + e.target.value.replace(/^@+/, ''))}
            required
            placeholder="handle"
            autoComplete="off"
            className="rounded-l-none"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="creator-drive" className="text-xs text-zinc-400">
          Google Drive link <span className="font-normal">(optional)</span>
        </Label>
        <Input
          id="creator-drive"
          type="url"
          value={driveLink}
          onChange={e => setDriveLink(e.target.value)}
          placeholder="https://drive.google.com/…"
        />
      </div>

      {/* Timezone — reported, not set. See `detectedTimezone` above. */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-zinc-400">Timezone</p>
        <p className="text-sm">
          {detectedTimezone ? timezoneLabel(detectedTimezone) : <span className="text-zinc-400">Not detected yet</span>}
        </p>
        <p className="text-xs text-zinc-400">
          {detectedTimezone
            ? "Detected from this creator's device. Due dates are judged against it."
            : 'Detected automatically the first time this creator signs in.'}
        </p>
      </div>

      {isEdit && initial && (
        <TelegramLinkField uid={initial.uid} connected={!!initial.telegram} />
      )}

      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2Icon aria-hidden className="activity-spinner" />}
          {isEdit ? 'Save changes' : 'Add creator'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Creator Table ────────────────────────────────────────────────────────────

interface CreatorTableProps {
  list: Creator[];
  /** The one quiet line shown when the list is empty. */
  emptyMessage: string;
  onEdit: (creator: Creator) => void;
  onToggleActive: (creator: Creator) => void;
  onArchive: (creator: Creator) => void;
  onRestore: (creator: Creator) => void;
  onDelete: (creator: Creator) => void;
  onTelegramLink: (creator: Creator) => void;
  onTelegramDisconnect: (creator: Creator) => void;
  onManageSubAccounts: (creator: Creator) => void;
}

function CreatorTable({
  list, emptyMessage, onEdit, onToggleActive, onArchive, onRestore, onDelete,
  onTelegramLink, onTelegramDisconnect, onManageSubAccounts,
}: CreatorTableProps) {
  // Tracks the *collapsed* rows rather than the expanded ones, so every creator
  // — including one added after mount — starts expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggle = (uid: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  if (list.length === 0) {
    return (
      <p className="py-8 text-sm text-zinc-400">{emptyMessage}</p>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-subtle)' }}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8"><span className="sr-only">Expand</span></TableHead>
            <TableHead className="w-12"><span className="sr-only">Photo</span></TableHead>
            <TableHead>Stage name</TableHead>
            <TableHead>OFID</TableHead>
            <TableHead>
              <span className="inline-flex items-center gap-1.5">
                Status
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="About deactivating and archiving"
                      className="rounded-sm text-zinc-500 outline-none transition-colors hover:text-zinc-300 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <Info aria-hidden className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="font-medium">Deactivate</p>
                    <p className="mb-1.5">Blocks the creator from logging into their creator portal. Their data stays fully visible to employees.</p>
                    <p className="font-medium">Archive</p>
                    <p>Removes the creator and their data from the employee-facing side (Custom Requests, Campaigns, Content Planning) and blocks portal login. Nothing is deleted, and it can be restored.</p>
                  </TooltipContent>
                </Tooltip>
              </span>
            </TableHead>
            <TableHead>
              <span className="inline-flex items-center gap-1.5">
                Telegram
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="About Telegram sign-in"
                      className="rounded-sm text-zinc-500 outline-none transition-colors hover:text-zinc-300 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <Info aria-hidden className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>Telegram is the only way into the Creator Portal. A creator who has not connected cannot sign in — send them a connection link from the row menu.</p>
                  </TooltipContent>
                </Tooltip>
              </span>
            </TableHead>
            <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map(creator => {
            const subAccounts = creator.subAccounts ?? [];
            const hasSubAccounts = subAccounts.length > 0;
            const expanded = hasSubAccounts && !collapsed.has(creator.uid);
            return (
              <Fragment key={creator.uid}>
                <TableRow>
                  <TableCell className="pr-0">
                    {hasSubAccounts && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Hide' : 'Show'} ${creator.stageName}'s sub-accounts`}
                        className="text-zinc-400"
                        onClick={() => toggle(creator.uid)}
                      >
                        <ChevronRight
                          aria-hidden
                          className={cn('transition-transform duration-150', expanded && 'rotate-90')}
                        />
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    <CreatorAvatar
                      creatorId={creator.uid}
                      name={creator.stageName}
                      photoURL={creator.photoURL}
                      className="size-8 text-xs"
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {creator.stageName}
                    {hasSubAccounts && !expanded && (
                      <span className="ml-2 text-xs font-normal text-zinc-400 tabular-nums">
                        +{subAccounts.length} sub-account{subAccounts.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-zinc-400">{creator.OFID}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      creator.isActive
                        ? 'bg-green-500/10 text-green-400'
                        : 'bg-zinc-500/10 text-zinc-400'
                    }`}>
                      {creator.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell>
                    {creator.telegram ? (
                      <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
                        {creator.telegram.username ? `@${creator.telegram.username}` : 'Connected'}
                      </span>
                    ) : (
                      // Orange, not zinc: for a creator this is "awaiting action",
                      // not a neutral resting state — they cannot get in until it
                      // changes. STATUS_COLORS' warning triad.
                      <span className="inline-flex items-center rounded-full bg-orange-500/10 px-2 py-0.5 text-xs font-medium text-orange-400">
                        Not connected
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${creator.stageName}`}>
                          <MoreHorizontal aria-hidden className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(creator)}>
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onManageSubAccounts(creator)}>
                          Sub-accounts
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onTelegramLink(creator)}>
                          {creator.telegram ? 'Copy new Telegram link' : 'Copy Telegram link'}
                        </DropdownMenuItem>
                        {creator.telegram && (
                          <DropdownMenuItem onClick={() => onTelegramDisconnect(creator)}>
                            Disconnect Telegram
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => onToggleActive(creator)}>
                          {creator.isActive ? 'Deactivate' : 'Reactivate'}
                        </DropdownMenuItem>
                        {!creator.isArchived && (
                          <DropdownMenuItem onClick={() => onArchive(creator)}>
                            Archive
                          </DropdownMenuItem>
                        )}
                        {creator.isArchived && (
                          <DropdownMenuItem onClick={() => onRestore(creator)}>
                            Restore
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => onDelete(creator)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>

                {/* Sub-accounts are assignable peers of their parent for shifts and
                    pay, but they have no login — hence no status or Telegram
                    of their own. Managed through the parent's Sub-accounts dialog. */}
                {expanded && subAccounts.map(sub => (
                  <TableRow key={sub.subAccountId} className={cn(sub.isArchived && 'opacity-60')}>
                    <TableCell className="pr-0" />
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <CornerDownRight aria-hidden className="size-3.5 shrink-0 text-zinc-500" />
                        <CreatorAvatar
                          creatorId={sub.subAccountId}
                          name={sub.stageName}
                          photoURL={creator.photoURL}
                          className="size-6 text-[10px]"
                        />
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{sub.stageName}</TableCell>
                    <TableCell className="text-zinc-400">{sub.OFID}</TableCell>
                    <TableCell>
                      {sub.isArchived && (
                        <span className="inline-flex items-center rounded-full bg-zinc-500/10 px-2 py-0.5 text-xs font-medium text-zinc-400">
                          Archived
                        </span>
                      )}
                    </TableCell>
                    <TableCell />
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`Actions for ${sub.stageName}`}
                          >
                            <MoreHorizontal aria-hidden className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onManageSubAccounts(creator)}>
                            Manage sub-accounts
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CreatorManagementPage() {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  // Dialog state. `formTarget` is `'new'` for Add, a creator for Edit, null closed.
  const [formTarget, setFormTarget] = useState<Creator | 'new' | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<Creator | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Creator | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Creator | null>(null);
  const [subAccountTarget, setSubAccountTarget] = useState<Creator | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchCreators = useCallback(async () => {
    try {
      const res = await apiRequest('/api/admin/creators');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setCreators(data.creators ?? []);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCreators(); }, [fetchCreators]);

  // `CreatorAvatar` renders the roster's inlined thumbnail in preference to this
  // page's own `photoURL`, and the roster is cached for five minutes — so
  // without this an admin would upload a new photo, see this page's list update,
  // and still be shown the *old* face in the avatar beside it. Refetching the
  // shared store is the only thing that clears that.
  const refreshCreators = useRefreshCreators();

  const handleFormSaved = () => {
    setFormTarget(null);
    fetchCreators();
    refreshCreators();
  };

  /**
   * One write against a creator, reported either way. Every action on this page
   * used to fire and forget — a refused archive or delete looked exactly like a
   * successful one, because nothing read the response.
   */
  const runAction = async (
    request: () => Promise<Response>,
    success: string,
    failure: string,
  ): Promise<boolean> => {
    setActionLoading(true);
    try {
      const res = await request();
      if (!res.ok) {
        toast.error(await errorMessage(res, failure));
        return false;
      }
      toast.success(success);
      await fetchCreators();
      refreshCreators();
      return true;
    } catch {
      toast.error(`${failure}. Check your connection and try again.`);
      return false;
    } finally {
      setActionLoading(false);
    }
  };

  const updateCreator = (creator: Creator, body: Record<string, unknown>) => () =>
    apiRequest(`/api/admin/creators/${creator.uid}`, { method: 'PUT', body: JSON.stringify(body) });

  const handleToggleActive = async (creator: Creator) => {
    await runAction(
      updateCreator(creator, { isActive: !creator.isActive }),
      creator.isActive ? `${creator.stageName} deactivated` : `${creator.stageName} reactivated`,
      creator.isActive ? `Could not deactivate ${creator.stageName}` : `Could not reactivate ${creator.stageName}`,
    );
    setDeactivateTarget(null);
  };

  const handleArchive = async (creator: Creator) => {
    await runAction(
      updateCreator(creator, { isArchived: true, isActive: false }),
      `${creator.stageName} archived`,
      `Could not archive ${creator.stageName}`,
    );
    setArchiveTarget(null);
    setDeleteTarget(null);
  };

  const handleRestore = (creator: Creator) =>
    void runAction(
      // Restore only un-archives (restores employee-side visibility). Portal
      // login is governed independently by isActive — use Reactivate to grant
      // it back — so restoring a creator who was deactivated before archiving
      // must not silently re-enable their portal access.
      updateCreator(creator, { isArchived: false }),
      `${creator.stageName} restored`,
      `Could not restore ${creator.stageName}`,
    );

  /** Mint a one-time connection link (see `mintTelegramLink`) and put it on the
   *  clipboard for the admin to send. */
  const handleTelegramLink = async (creator: Creator) => {
    setActionLoading(true);
    try {
      const url = await mintTelegramLink(creator.uid);
      await navigator.clipboard.writeText(url);
      toast.success(`Connection link copied — send it to ${creator.stageName}.`, {
        description: 'Single use, expires in 7 days.',
      });
      await fetchCreators();
    } catch (err: unknown) {
      console.error('[creator-management] telegram link failed:', err);
      toast.error('Could not generate a connection link.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTelegramDisconnect = async (creator: Creator) => {
    setActionLoading(true);
    try {
      const res = await apiRequest(`/api/admin/creators/${creator.uid}/telegram-link`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`${creator.stageName} disconnected from Telegram.`, {
        description: 'They cannot open the portal until they use a new link.',
      });
      await fetchCreators();
    } catch (err: unknown) {
      console.error('[creator-management] telegram disconnect failed:', err);
      toast.error('Could not disconnect Telegram.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (creator: Creator) => {
    await runAction(
      () => apiRequest(`/api/admin/creators/${creator.uid}`, { method: 'DELETE' }),
      `${creator.stageName} deleted`,
      `Could not delete ${creator.stageName}`,
    );
    setDeleteTarget(null);
  };

  const activeCreators = creators.filter(c => !c.isArchived);
  const archivedCreators = creators.filter(c => c.isArchived);

  const tableHandlers = {
    onEdit: setFormTarget,
    onToggleActive: setDeactivateTarget,
    onArchive: setArchiveTarget,
    onRestore: handleRestore,
    onDelete: setDeleteTarget,
    onManageSubAccounts: setSubAccountTarget,
    onTelegramLink: handleTelegramLink,
    onTelegramDisconnect: handleTelegramDisconnect,
  };

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="mb-1 text-2xl font-bold tracking-tight">Creator Management</h1>
            <p className="text-sm text-zinc-400">
              Creators&apos; portal accounts, the other accounts they run, and how each one signs in.
            </p>
          </div>
          <Button onClick={() => setFormTarget('new')}>
            <Plus aria-hidden />
            Add creator
          </Button>
        </div>

        {loading ? (
          // Shaped to the table: tab strip, then avatar + four text columns.
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading creators">
            <Skeleton className="h-9 w-56 rounded-lg" />
            <div className="rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="ml-auto h-5 w-16 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        ) : loadFailed && creators.length === 0 ? (
          <p role="alert" className="py-8 text-sm text-zinc-400">
            Could not load creators.{' '}
            <button
              type="button"
              onClick={() => { setLoading(true); fetchCreators(); }}
              className="rounded-sm text-zinc-200 underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Try again
            </button>
          </p>
        ) : (
          <Tabs defaultValue="active" className="gap-4">
            <TabsList>
              <TabsTrigger value="active">
                Active <span className="text-zinc-400 tabular-nums">{activeCreators.length}</span>
              </TabsTrigger>
              <TabsTrigger value="archived">
                Archived <span className="text-zinc-400 tabular-nums">{archivedCreators.length}</span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="active">
              <CreatorTable
                list={activeCreators}
                emptyMessage="No creators yet. Add one to give them a portal account."
                {...tableHandlers}
              />
            </TabsContent>
            <TabsContent value="archived">
              <CreatorTable
                list={archivedCreators}
                emptyMessage="No archived creators."
                {...tableHandlers}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Add / Edit. The form is keyed so each open starts from its own record,
          and the dialog cannot be dismissed mid-save. */}
      <Dialog
        open={formTarget !== null}
        onOpenChange={open => { if (!open && !formBusy) setFormTarget(null); }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          {formTarget !== null && (
            <CreatorForm
              key={formTarget === 'new' ? 'new' : formTarget.uid}
              initial={formTarget === 'new' ? null : formTarget}
              onSaved={handleFormSaved}
              onCancel={() => setFormTarget(null)}
              onBusyChange={setFormBusy}
              onRefresh={() => { fetchCreators(); refreshCreators(); }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Sub-accounts — the other accounts a creator runs. Each is assignable
          to a shift on its own and counts once toward that agent's hourly rate,
          which is why this lives here rather than being inferred from anything. */}
      <SubAccountsDialog
        creator={subAccountTarget}
        onClose={() => setSubAccountTarget(null)}
        onChanged={fetchCreators}
        apiRequest={apiRequest}
      />

      {/* Deactivate / Reactivate dialog */}
      <AlertDialog open={!!deactivateTarget} onOpenChange={open => { if (!open) setDeactivateTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deactivateTarget?.isActive ? `Deactivate ${deactivateTarget.stageName}?` : `Reactivate ${deactivateTarget?.stageName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deactivateTarget?.isActive
                ? `${deactivateTarget.stageName}'s access to the creator portal will be removed. No data will be deleted.`
                : `${deactivateTarget?.stageName} will be able to log in to the creator portal again.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={actionLoading}
              onClick={() => deactivateTarget && handleToggleActive(deactivateTarget)}
            >
              {deactivateTarget?.isActive ? 'Deactivate' : 'Reactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive dialog */}
      <AlertDialog open={!!archiveTarget} onOpenChange={open => { if (!open) setArchiveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiveTarget?.stageName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate {archiveTarget?.stageName}&apos;s account and remove them from active operations. Their data will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={actionLoading}
              onClick={() => archiveTarget && handleArchive(archiveTarget)}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.stageName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Deletion is permanent and cannot be undone. Consider archiving instead to preserve data while removing access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              disabled={actionLoading}
              onClick={() => deleteTarget && handleArchive(deleteTarget)}
            >
              Archive instead
            </Button>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              disabled={actionLoading}
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

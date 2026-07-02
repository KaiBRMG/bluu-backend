"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { getAuth } from 'firebase/auth';
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
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
import {
  Card, CardHeader, CardTitle, CardContent, CardFooter,
} from "@/components/ui/card";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { MoreHorizontal, UserCircle, Copy, Check, Info } from "lucide-react";
import { TimezoneCombobox } from "@/components/ui/timezone-combobox";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Creator {
  uid: string;
  creatorID: string;
  stageName: string;
  userEmail: string;
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

// ─── Creator Form Card ────────────────────────────────────────────────────────

interface CreatorFormCardProps {
  initial?: Creator | null;
  onSave: () => void;
  onCancel: () => void;
}

function CreatorFormCard({ initial, onSave, onCancel }: CreatorFormCardProps) {
  const isEdit = !!initial;
  const [stageName, setStageName] = useState(initial?.stageName ?? '');
  const [OFID, setOFID] = useState(initial?.OFID ?? '');
  const [userEmail, setUserEmail] = useState(initial?.userEmail ?? '');
  const [driveLink, setDriveLink] = useState(initial?.driveLink ?? '');
  const [defaultTimezone, setDefaultTimezone] = useState(initial?.defaultTimezone ?? '');
  const [password, setPassword] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(initial?.photoURL ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const copyPassword = () => {
    if (!password) return;
    navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      if (isEdit && initial) {
        // Update existing
        const updateBody: Record<string, unknown> = { stageName, OFID, driveLink, defaultTimezone };
        if (password) updateBody.newPassword = password;
        const res = await apiRequest(`/api/admin/creators/${initial.uid}`, {
          method: 'PUT',
          body: JSON.stringify(updateBody),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? 'Update failed');
        }

        // Upload photo if changed
        if (photoFile) {
          const imageData = await toBase64(photoFile);
          const photoRes = await apiRequest(`/api/admin/creators/${initial.uid}/photo`, {
            method: 'POST',
            body: JSON.stringify({ imageData, contentType: photoFile.type }),
          });
          if (!photoRes.ok) throw new Error('Photo upload failed');
        }
      } else {
        // Create new
        const res = await apiRequest('/api/admin/creators', {
          method: 'POST',
          body: JSON.stringify({ stageName, userEmail, password, OFID, driveLink, defaultTimezone }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Create failed');

        // Upload photo for new creator
        if (photoFile && data.uid) {
          const imageData = await toBase64(photoFile);
          await apiRequest(`/api/admin/creators/${data.uid}/photo`, {
            method: 'POST',
            body: JSON.stringify({ imageData, contentType: photoFile.type }),
          });
        }
      }

      onSave();
    } catch (err: unknown) {
      setError((err as Error).message ?? 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{isEdit ? 'Edit Creator' : 'Add Creator'}</CardTitle>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="flex flex-col gap-4">
            {/* Profile picture */}
            <div className="flex flex-col items-center gap-2">
              <div
                className="w-20 h-20 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center cursor-pointer border border-zinc-700"
                onClick={() => fileInputRef.current?.click()}
              >
                {photoPreview
                  ? <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                  : <UserCircle className="w-10 h-10 text-zinc-500" />
                }
              </div>
              <Button
                type="button"
                variant="ghost"
                className="text-xs text-zinc-400 hover:text-white h-auto px-2 py-1"
                onClick={() => fileInputRef.current?.click()}
              >
                {photoPreview ? 'Change photo' : 'Upload photo'}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={handlePhotoChange}
              />
            </div>

            {/* Stage name */}
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Stage Name</label>
              <input
                type="text"
                value={stageName}
                onChange={e => setStageName(e.target.value)}
                required
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
              />
            </div>

            {/* OFID */}
            <div>
              <label className="block text-sm text-zinc-400 mb-1">OFID</label>
              <div className="flex">
                <span className="bg-zinc-700 border border-r-0 border-zinc-700 rounded-l-lg px-3 py-2 text-sm text-zinc-400">@</span>
                <input
                  type="text"
                  value={OFID.startsWith('@') ? OFID.slice(1) : OFID}
                  onChange={e => setOFID('@' + e.target.value)}
                  required
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-r-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  placeholder="handle"
                />
              </div>
            </div>

            {/* Drive Link */}
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Google Drive Link</label>
              <input
                type="url"
                value={driveLink}
                onChange={e => setDriveLink(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                placeholder="https://drive.google.com/..."
              />
            </div>

            {/* Default Timezone */}
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Default Timezone</label>
              <TimezoneCombobox value={defaultTimezone} onChange={setDefaultTimezone} />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Email</label>
              <input
                type="email"
                value={userEmail}
                onChange={e => setUserEmail(e.target.value)}
                required={!isEdit}
                disabled={isEdit}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm text-zinc-400 mb-1">
                {isEdit ? 'New Password (optional)' : 'Password'}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required={!isEdit}
                  autoComplete="new-password"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 pr-10 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  placeholder={isEdit ? 'Leave blank to keep current' : 'Enter password'}
                />
                <button
                  type="button"
                  onClick={copyPassword}
                  disabled={!password}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}
          </CardContent>
          <CardFooter className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Creator'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

// ─── Creator Table ────────────────────────────────────────────────────────────

interface CreatorTableProps {
  list: Creator[];
  onEdit: (creator: Creator) => void;
  onToggleActive: (creator: Creator) => void;
  onArchive: (creator: Creator) => void;
  onRestore: (creator: Creator) => void;
  onDelete: (creator: Creator) => void;
}

function CreatorTable({ list, onEdit, onToggleActive, onArchive, onRestore, onDelete }: CreatorTableProps) {
  if (list.length === 0) {
    return (
      <div className="rounded-lg p-8 text-center mt-4" style={{ background: 'var(--sidebar-background)', border: '1px solid var(--border-subtle)' }}>
        <p className="text-sm text-muted-foreground">No creators found.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-subtle)' }}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12"></TableHead>
            <TableHead>Stage Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>OFID</TableHead>
            <TableHead>
              <span className="inline-flex items-center gap-1.5">
                Status
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-zinc-500 hover:text-zinc-300 transition-colors">
                      <Info className="w-3.5 h-3.5" />
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
            <TableHead className="w-12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map(creator => (
            <TableRow key={creator.uid}>
              <TableCell>
                {creator.photoURL
                  ? <img src={creator.photoURL} alt="" className="w-8 h-8 rounded-full object-cover" />
                  : (
                    <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-medium text-zinc-300">
                      {creator.stageName.charAt(0).toUpperCase()}
                    </div>
                  )
                }
              </TableCell>
              <TableCell className="font-medium">{creator.stageName}</TableCell>
              <TableCell className="text-muted-foreground">{creator.userEmail}</TableCell>
              <TableCell className="text-muted-foreground">{creator.OFID}</TableCell>
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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(creator)}>
                      Edit
                    </DropdownMenuItem>
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
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CreatorManagementPage() {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Card / dialog state
  const [showAddCard, setShowAddCard] = useState(false);
  const [editingCreator, setEditingCreator] = useState<Creator | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Creator | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Creator | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Creator | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchCreators = useCallback(async () => {
    try {
      const res = await apiRequest('/api/admin/creators');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setCreators(data.creators ?? []);
    } catch {
      setError('Failed to load creators');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCreators(); }, [fetchCreators]);

  const handleFormSave = () => {
    setShowAddCard(false);
    setEditingCreator(null);
    fetchCreators();
  };

  const handleToggleActive = async (creator: Creator) => {
    setActionLoading(true);
    try {
      await apiRequest(`/api/admin/creators/${creator.uid}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !creator.isActive }),
      });
      await fetchCreators();
    } finally {
      setDeactivateTarget(null);
      setActionLoading(false);
    }
  };

  const handleArchive = async (creator: Creator) => {
    setActionLoading(true);
    try {
      await apiRequest(`/api/admin/creators/${creator.uid}`, {
        method: 'PUT',
        body: JSON.stringify({ isArchived: true, isActive: false }),
      });
      await fetchCreators();
    } finally {
      setArchiveTarget(null);
      setDeleteTarget(null);
      setActionLoading(false);
    }
  };

  const handleRestore = async (creator: Creator) => {
    setActionLoading(true);
    try {
      await apiRequest(`/api/admin/creators/${creator.uid}`, {
        method: 'PUT',
        // Restore only un-archives (restores employee-side visibility). Portal
        // login is governed independently by isActive — use Reactivate to grant
        // it back — so restoring a creator who was deactivated before archiving
        // must not silently re-enable their portal access.
        body: JSON.stringify({ isArchived: false }),
      });
      await fetchCreators();
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (creator: Creator) => {
    setActionLoading(true);
    try {
      await apiRequest(`/api/admin/creators/${creator.uid}`, { method: 'DELETE' });
      await fetchCreators();
    } finally {
      setDeleteTarget(null);
      setActionLoading(false);
    }
  };

  const activeCreators = creators.filter(c => !c.isArchived);
  const archivedCreators = creators.filter(c => c.isArchived);

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Creator Management</h1>
          <Button onClick={() => setShowAddCard(true)}>Add Creator</Button>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}

        {!loading && (
          <Tabs defaultValue="active">
            <TabsList>
              <TabsTrigger value="active">Active ({activeCreators.length})</TabsTrigger>
              <TabsTrigger value="archived">Archived ({archivedCreators.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="active">
              <CreatorTable
                list={activeCreators}
                onEdit={setEditingCreator}
                onToggleActive={setDeactivateTarget}
                onArchive={setArchiveTarget}
                onRestore={handleRestore}
                onDelete={setDeleteTarget}
              />
            </TabsContent>
            <TabsContent value="archived">
              <CreatorTable
                list={archivedCreators}
                onEdit={setEditingCreator}
                onToggleActive={setDeactivateTarget}
                onArchive={setArchiveTarget}
                onRestore={handleRestore}
                onDelete={setDeleteTarget}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Add / Edit form */}
      {(showAddCard || editingCreator) && (
        <CreatorFormCard
          initial={editingCreator}
          onSave={handleFormSave}
          onCancel={() => { setShowAddCard(false); setEditingCreator(null); }}
        />
      )}

      {/* Deactivate / Reactivate dialog */}
      <AlertDialog open={!!deactivateTarget} onOpenChange={open => { if (!open) setDeactivateTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deactivateTarget?.isActive ? 'Deactivate Creator' : 'Reactivate Creator'}
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
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive dialog */}
      <AlertDialog open={!!archiveTarget} onOpenChange={open => { if (!open) setArchiveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Creator</AlertDialogTitle>
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
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Creator</AlertDialogTitle>
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
              Archive Instead
            </Button>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={actionLoading}
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              Confirm Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

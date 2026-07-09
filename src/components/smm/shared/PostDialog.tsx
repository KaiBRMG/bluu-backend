'use client';

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/smm/shared/ConfirmDialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { UserChip } from '@/components/UserChip';
import { useUserName } from '@/hooks/useUserName';
import { useBasicUsers } from '@/hooks/useBasicUsers';
import { DatePicker } from '@/components/smm/shared/DatePicker';
import { LinkWithCopy } from '@/components/smm/shared/LinkWithCopy';
import type { SmmAccount, SmmPost } from '@/types/firestore';
import type { SmmPostPayload } from '@/hooks/useSmmPosts';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-baseline gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/**
 * Post view/edit dialog shared by the week calendar, Show All Posts table and
 * account Content tab. "Actions" reveals Edit / Delete / 💰 Submit for Bonus.
 */
export function PostDialog({
  post,
  accounts,
  open,
  onOpenChange,
  onSave,
  onDelete,
  onSubmitBonus,
  startInEdit = false,
}: {
  post: SmmPost | null;
  accounts: SmmAccount[]; // caller's active accounts, for the Edit account dropdown
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (post: SmmPost, updates: Partial<SmmPostPayload>) => Promise<void>;
  onDelete: (post: SmmPost) => Promise<void>;
  onSubmitBonus?: (post: SmmPost) => void; // absent on the admin page
  startInEdit?: boolean; // open straight into edit mode (row "Edit" actions)
}) {
  const { names } = useUserName();
  const { users } = useBasicUsers();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  const [caption, setCaption] = useState('');
  const [accountId, setAccountId] = useState('');
  const [postDate, setPostDate] = useState<Date | undefined>(undefined);
  const [postLink, setPostLink] = useState('');

  // Reset the form whenever a different post is shown or the dialog reopens.
  useEffect(() => {
    if (!post || !open) return;
    setEditing(startInEdit);
    setCaption(post.caption);
    setAccountId(post.accountId);
    setPostDate(post.postDate ? new Date(post.postDate) : undefined);
    setPostLink(post.postLink);
  }, [post, open, startInEdit]);

  const postedByName = post ? names[post.postedBy] ?? '' : '';
  const postedByPhoto = post ? users.find((u) => u.uid === post.postedBy)?.photoURL ?? null : null;

  // Single source of the changed fields — `dirty` and the save body both
  // derive from it.
  const updates = useMemo(() => {
    if (!post) return {} as Partial<SmmPostPayload>;
    const u: Partial<SmmPostPayload> = {};
    if (caption !== post.caption) u.caption = caption;
    if (accountId !== post.accountId) u.accountId = accountId;
    if (postLink !== post.postLink) u.postLink = postLink;
    const origIso = post.postDate ? new Date(post.postDate).toISOString() : null;
    if ((postDate?.toISOString() ?? null) !== origIso && postDate) {
      u.postDate = postDate.toISOString();
    }
    return u;
  }, [post, caption, accountId, postLink, postDate]);
  const dirty = Object.keys(updates).length > 0;

  if (!post) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(post, updates);
      toast.success('Post updated');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update post');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setConfirmDelete(false);
    try {
      await onDelete(post);
      toast.success('Post deleted');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete post');
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{post.accountName}</DialogTitle>
            {!editing && post.caption && (
              <DialogDescription className="whitespace-pre-wrap break-words">{post.caption}</DialogDescription>
            )}
          </DialogHeader>

          {editing ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Account</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    {/* Keep the current account selectable even if it's no longer in the caller's list */}
                    {!accounts.some((a) => a.id === post.accountId) && (
                      <SelectItem value={post.accountId}>{post.accountName}</SelectItem>
                    )}
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.accountName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Caption</Label>
                <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} />
              </div>
              <div className="space-y-1.5">
                <Label>Post date</Label>
                <DatePicker value={postDate} onChange={setPostDate} className="w-full" />
              </div>
              <div className="space-y-1.5">
                <Label>Post link</Label>
                <Input value={postLink} onChange={(e) => setPostLink(e.target.value)} placeholder="https://x.com/..." />
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <Field label="Post date">
                {post.postDate ? format(new Date(post.postDate), 'PPP') : '—'}
              </Field>
              <Field label="Post link">
                {post.postLink ? <LinkWithCopy url={post.postLink} /> : '—'}
              </Field>
              <Field label="Posted by">
                <UserChip name={postedByName} photoURL={postedByPhoto} />
              </Field>
            </div>
          )}

          <DialogFooter>
            {editing ? (
              <>
                <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={!dirty || saving}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </>
            ) : (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline">Actions</Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-52 p-1">
                  <div className="flex flex-col gap-0.5">
                    <button
                      className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted transition-colors"
                      onClick={() => setEditing(true)}
                    >
                      Edit
                    </button>
                    <button
                      className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted transition-colors text-red-600"
                      onClick={() => setConfirmDelete(true)}
                    >
                      Delete
                    </button>
                    {onSubmitBonus && (
                      <button
                        className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted transition-colors"
                        onClick={() => {
                          onOpenChange(false);
                          onSubmitBonus(post);
                        }}
                      >
                        💰 Submit for Bonus
                      </button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this post?"
        description="This removes the post from the content schedule permanently."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </>
  );
}

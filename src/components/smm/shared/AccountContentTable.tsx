'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/smm/shared/ConfirmDialog';
import { PostDialog } from '@/components/smm/shared/PostDialog';
import { PostsTable, type PostAction } from '@/components/smm/shared/PostsTable';
import { useSmmPosts, type SmmPostPayload } from '@/hooks/useSmmPosts';
import type { SmmAccount, SmmPost } from '@/types/firestore';

/**
 * The account dialog's Content tab: all scheduled posts for one account.
 * Editable per SMM.md even when the rest of the dialog is read-only.
 */
export function AccountContentTable({
  accountId,
  accounts,
}: {
  accountId: string;
  accounts: SmmAccount[]; // for the post edit dialog's account dropdown
}) {
  const { fetchAccountPosts, updatePost, deletePost } = useSmmPosts();
  const [posts, setPosts] = useState<SmmPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SmmPost | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [startInEdit, setStartInEdit] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SmmPost | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPosts(await fetchAccountPosts(accountId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load content');
    } finally {
      setLoading(false);
    }
  }, [fetchAccountPosts, accountId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAction = (action: PostAction, post: SmmPost) => {
    if (action === 'delete') {
      setPendingDelete(post);
      return;
    }
    setSelected(post);
    setStartInEdit(action === 'edit');
    setDialogOpen(true);
  };

  const handleSave = async (post: SmmPost, updates: Partial<SmmPostPayload>) => {
    await updatePost(post.accountId, post.id, updates);
    await load();
  };

  const handleDelete = async (post: SmmPost) => {
    await deletePost(post.accountId, post.id);
    await load();
  };

  const confirmRowDelete = async () => {
    if (!pendingDelete) return;
    const post = pendingDelete;
    setPendingDelete(null);
    try {
      await handleDelete(post);
      toast.success('Post deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete post');
    }
  };

  return (
    <>
      <PostsTable
        posts={posts}
        columns={['caption', 'postDate', 'postLink']}
        actions={['view', 'edit', 'delete']}
        loading={loading}
        onAction={handleAction}
      />

      <PostDialog
        post={selected}
        accounts={accounts}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSave}
        onDelete={handleDelete}
        startInEdit={startInEdit}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete this post?"
        description="This removes the post from the content schedule permanently."
        confirmLabel="Delete"
        destructive
        onConfirm={confirmRowDelete}
      />
    </>
  );
}

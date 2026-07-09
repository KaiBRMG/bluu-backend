'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PostsTable, type PostAction } from '@/components/smm/shared/PostsTable';
import { useSmmPosts } from '@/hooks/useSmmPosts';
import type { SmmPost } from '@/types/firestore';

/**
 * Large dialog listing every post the caller has scheduled, paginated.
 * Row actions bubble up to the dashboard, which owns the post/bonus dialogs.
 */
export function ShowAllPostsDialog({
  open,
  onOpenChange,
  refreshKey,
  onAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refreshKey: number; // bumped by the parent after a mutation to force a reload
  onAction: (action: PostAction, post: SmmPost) => void;
}) {
  const { fetchAllPosts } = useSmmPosts();
  const [posts, setPosts] = useState<SmmPost[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const data = await fetchAllPosts(p);
      setPosts(data.posts);
      setTotalPages(data.totalPages);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load posts');
    } finally {
      setLoading(false);
    }
  }, [fetchAllPosts]);

  useEffect(() => {
    if (open) load(page);
  }, [open, page, load, refreshKey]);

  // Reset to the first page whenever the dialog is opened afresh.
  useEffect(() => {
    if (open) setPage(1);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>All posts</DialogTitle>
        </DialogHeader>
        <PostsTable
          posts={posts}
          columns={['accountName', 'postDate', 'postLink', 'caption']}
          actions={['view', 'edit', 'delete', 'bonus']}
          loading={loading}
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          onAction={onAction}
        />
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { WeekCalendar, weekRange } from '@/components/smm/dashboard/WeekCalendar';
import { PostDialog } from '@/components/smm/shared/PostDialog';
import { UserAvatarLabel } from '@/components/UserAvatarLabel';
import { useSmmPosts, type SmmPostPayload } from '@/hooks/useSmmPosts';
import { useSmmAccounts } from '@/hooks/useSmmAccounts';
import type { SmmPost } from '@/types/firestore';

/**
 * Admin content schedule: the same week calendar as the dashboard, but showing
 * every user's posts with the poster's avatar on each card (instead of the
 * caption). Clicking a card opens the shared post dialog for view/edit/delete.
 */
export function ContentScheduleTab() {
  const { fetchWeekAll, updatePost, deletePost } = useSmmPosts();
  // Slim active-account list for the post dialog's account dropdown.
  const { accounts } = useSmmAccounts('active');

  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [weekPosts, setWeekPosts] = useState<SmmPost[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedPost, setSelectedPost] = useState<SmmPost | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [startInEdit, setStartInEdit] = useState(false);

  const loadWeek = useCallback(async (anchor: Date) => {
    setLoading(true);
    try {
      const { start, end } = weekRange(anchor);
      setWeekPosts(await fetchWeekAll(start, end));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, [fetchWeekAll]);

  useEffect(() => {
    loadWeek(anchorDate);
  }, [anchorDate, loadWeek]);

  const handleSave = useCallback(async (post: SmmPost, updates: Partial<SmmPostPayload>) => {
    await updatePost(post.accountId, post.id, updates);
    await loadWeek(anchorDate);
  }, [updatePost, loadWeek, anchorDate]);

  const handleDelete = useCallback(async (post: SmmPost) => {
    await deletePost(post.accountId, post.id);
    await loadWeek(anchorDate);
  }, [deletePost, loadWeek, anchorDate]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Content Schedule</h1>
      <WeekCalendar
        posts={weekPosts}
        loading={loading}
        anchorDate={anchorDate}
        onWeekChange={setAnchorDate}
        onPostClick={(post) => { setSelectedPost(post); setStartInEdit(false); setDialogOpen(true); }}
        renderCardBody={(post) => (
          <UserAvatarLabel name={post.postedByName ?? ''} photoURL={post.postedByPhotoURL ?? null} />
        )}
      />

      <PostDialog
        post={selectedPost}
        accounts={accounts}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSave}
        onDelete={handleDelete}
        startInEdit={startInEdit}
      />
    </div>
  );
}

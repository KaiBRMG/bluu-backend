'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import { WeekCalendar, weekRange } from '@/components/smm/dashboard/WeekCalendar';
import { AccountsKanban } from '@/components/smm/dashboard/AccountsKanban';
import { ShowAllPostsDialog } from '@/components/smm/dashboard/ShowAllPostsDialog';
import { BonusSection } from '@/components/smm/dashboard/BonusSection';
import { PostDialog } from '@/components/smm/shared/PostDialog';
import { CreatePostDialog, type PostFormDraft } from '@/components/smm/shared/CreatePostDialog';
import { AccountDialog } from '@/components/smm/shared/AccountDialog';
import { BonusWizard } from '@/components/smm/shared/BonusWizard';
import { ConfirmDialog } from '@/components/smm/shared/ConfirmDialog';
import { ViralCopyDialog, type ViralCopyDeclaration } from '@/components/smm/shared/ViralCopyDialog';
import { useSmmAccounts } from '@/hooks/useSmmAccounts';
import { useSmmPosts, type SmmPostPayload } from '@/hooks/useSmmPosts';
import type { PostAction } from '@/components/smm/shared/PostsTable';
import { isBonusAccountType, type SmmAccount, type SmmPost } from '@/types/firestore';

export default function SmmDashboardPage() {
  const { accounts, loading: accountsLoading } = useSmmAccounts('mine');
  const { fetchWeek, createPost, updatePost, deletePost } = useSmmPosts();

  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [weekPosts, setWeekPosts] = useState<SmmPost[]>([]);
  const [weekLoading, setWeekLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Dialog state
  const [selectedPost, setSelectedPost] = useState<SmmPost | null>(null);
  const [postDialogOpen, setPostDialogOpen] = useState(false);
  const [postDialogEdit, setPostDialogEdit] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState<Date | undefined>(undefined);
  // Scheduling a post is a two-step flow: the viral-copy question, then the
  // schedule form (which writes). `viralAnswer` carries step one's verdict —
  // `undefined` = not asked yet, `null` = "No", an object = a verified copy —
  // and `draft` preserves step two's form across a "Back", so nothing typed in
  // either step is lost.
  const [viralOpen, setViralOpen] = useState(false);
  const [viralAnswer, setViralAnswer] = useState<ViralCopyDeclaration | null | undefined>(undefined);
  const [draft, setDraft] = useState<PostFormDraft | null>(null);
  const [notBonusAccount, setNotBonusAccount] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<SmmAccount | null>(null);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [showAllOpen, setShowAllOpen] = useState(false);
  const [bonusPost, setBonusPost] = useState<SmmPost | null>(null);
  const [bonusOpen, setBonusOpen] = useState(false);

  const loadWeek = useCallback(async (anchor: Date, force = false) => {
    setWeekLoading(true);
    try {
      const { start, end } = weekRange(anchor);
      setWeekPosts(await fetchWeek(start, end, force));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load schedule');
    } finally {
      setWeekLoading(false);
    }
  }, [fetchWeek]);

  useEffect(() => {
    loadWeek(anchorDate);
  }, [anchorDate, loadWeek]);

  // Any post mutation clears the hook cache; reload the visible week + Show All.
  const afterMutation = useCallback(async () => {
    setRefreshKey((k) => k + 1);
    await loadWeek(anchorDate, true);
  }, [anchorDate, loadWeek]);

  const handleCreate = useCallback(async (payload: SmmPostPayload) => {
    await createPost(payload);
    await afterMutation();
  }, [createPost, afterMutation]);

  const handleSave = useCallback(async (post: SmmPost, updates: Partial<SmmPostPayload>) => {
    await updatePost(post.accountId, post.id, updates);
    await afterMutation();
  }, [updatePost, afterMutation]);

  const handleDelete = useCallback(async (post: SmmPost) => {
    await deletePost(post.accountId, post.id);
    await afterMutation();
  }, [deletePost, afterMutation]);

  // Only accounts whose type contains 'Bonus' may be submitted — say so up
  // front instead of letting the submit fail server-side.
  const openBonus = useCallback((post: SmmPost) => {
    const account = accounts.find((a) => a.id === post.accountId);
    if (account && !isBonusAccountType(account.type)) {
      setNotBonusAccount(account.accountName);
      return;
    }
    setBonusPost(post);
    setBonusOpen(true);
  }, [accounts]);

  // Row actions from Show All Posts.
  const handleTableAction = useCallback((action: PostAction, post: SmmPost) => {
    if (action === 'bonus') { openBonus(post); return; }
    if (action === 'delete') {
      handleDelete(post).then(() => toast.success('Post deleted')).catch((err) =>
        toast.error(err instanceof Error ? err.message : 'Failed to delete post'));
      return;
    }
    setSelectedPost(post);
    setPostDialogEdit(action === 'edit');
    setPostDialogOpen(true);
  }, [openBonus, handleDelete]);

  return (
    <AppLayout>
      <div className="max-w-7xl space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left ~75%: upload schedule */}
          <section className="lg:col-span-3 space-y-3">
            <div className="space-y-0.5">
              <h2 className="text-lg font-semibold">📅 Upload Schedule</h2>
              <p className="text-sm text-muted-foreground">Click on a day to schedule a post</p>
            </div>
            <WeekCalendar
              posts={weekPosts}
              loading={weekLoading}
              anchorDate={anchorDate}
              onWeekChange={setAnchorDate}
              onPostClick={(post) => { setSelectedPost(post); setPostDialogEdit(false); setPostDialogOpen(true); }}
              onDayClick={(date) => {
                setCreateDate(date);
                setDraft(null);
                setViralAnswer(undefined);
                setViralOpen(true);
              }}
              onShowAll={() => setShowAllOpen(true)}
            />
            <BonusSection />
          </section>

          {/* Right ~25%: my accounts */}
          <section className="lg:col-span-1 space-y-3">
            <h2 className="text-lg font-semibold">👤 My Accounts</h2>
            <AccountsKanban
              accounts={accounts}
              loading={accountsLoading}
              onCardClick={(account) => { setSelectedAccount(account); setAccountDialogOpen(true); }}
            />
          </section>
        </div>
      </div>

      {/* Dialogs */}
      <PostDialog
        post={selectedPost}
        accounts={accounts}
        open={postDialogOpen}
        onOpenChange={setPostDialogOpen}
        onSave={handleSave}
        onDelete={handleDelete}
        onSubmitBonus={openBonus}
        startInEdit={postDialogEdit}
      />

      {/* Step 1 — the viral-copy question. Writes nothing; its answer decides
          whether the post created in step 2 carries a copy declaration. A
          failed gate can only go Back, so no blocked copy reaches step 2. */}
      <ViralCopyDialog
        open={viralOpen}
        onOpenChange={setViralOpen}
        initialOriginalLink={viralAnswer?.originalLink}
        onAnswered={(declaration) => {
          setViralAnswer(declaration);
          setViralOpen(false);
          setCreateOpen(true);
        }}
      />

      {/* Step 2 — the post itself, which is what creates it. */}
      <CreatePostDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        accounts={accounts}
        defaultDate={createDate}
        draft={draft}
        originalLink={viralAnswer?.originalLink}
        onBack={(current) => { setDraft(current); setCreateOpen(false); setViralOpen(true); }}
        onSubmit={async (next) => {
          await handleCreate({ ...next, originalLink: viralAnswer?.originalLink });
          toast.success('Post scheduled');
          setCreateOpen(false);
          setDraft(null);
          setViralAnswer(undefined);
        }}
      />

      <AccountDialog
        account={selectedAccount}
        open={accountDialogOpen}
        onOpenChange={setAccountDialogOpen}
        mode="view"
        postEditAccounts={accounts}
      />

      <ShowAllPostsDialog
        open={showAllOpen}
        onOpenChange={setShowAllOpen}
        refreshKey={refreshKey}
        onAction={handleTableAction}
      />

      <BonusWizard
        post={bonusPost}
        open={bonusOpen}
        onOpenChange={setBonusOpen}
        onSubmitted={afterMutation}
      />

      <ConfirmDialog
        open={notBonusAccount !== null}
        onOpenChange={(open) => !open && setNotBonusAccount(null)}
        title="Not a bonus account"
        description={`${notBonusAccount ?? 'This account'} is not a bonus account, so its posts can’t be submitted for a bonus. An admin must add “Bonus” to the account’s type first.`}
        confirmLabel="OK"
        hideCancel
        onConfirm={() => setNotBonusAccount(null)}
      />
    </AppLayout>
  );
}

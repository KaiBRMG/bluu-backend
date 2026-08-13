'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useUserData } from '@/hooks/useUserData';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useOnlyFansChats, type OFChatRow } from '@/hooks/useOnlyFansChats';
import ChatList from './_components/ChatList';
import ChatThread from './_components/ChatThread';

/**
 * OF Manager — the messaging console.
 *
 * Scope of this iteration is deliberately one account and one job: read the fan
 * inbox, open a thread, scroll back through its history, reply. Vault, PPV
 * composition, per-function permissions, audit logging and earnings all land on
 * top of this shell later — hence the adapter seam in `src/lib/onlyfans` and the
 * account-scoped Firestore mirror, neither of which assumes a single account.
 */
export default function OfManagerPage() {
  const { userData } = useUserData();
  const authFetch = useAuthFetch();
  const { accountId, chats, loading, refreshing, error, hasMore, refresh, loadMore } =
    useOnlyFansChats();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Threads already marked read this session — marking costs a provider call.
  const markedRef = useRef<Set<string>>(new Set());
  // Refreshing the list must also refresh the thread being read, or the operator
  // presses refresh and the one pane they are looking at is the one that does
  // not move. The list is a Firestore mirror the sync route rewrites; the thread
  // is provider history the sync never touches, so it needs its own nudge.
  const [threadReloadToken, setThreadReloadToken] = useState(0);

  const selected = chats.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const select = useCallback(
    (chat: OFChatRow) => {
      setSelectedId(chat.id);
      if (chat.unreadCount > 0 && !markedRef.current.has(chat.id)) {
        markedRef.current.add(chat.id);
        // Fire-and-forget: a failed mark-as-read costs the user nothing but a
        // stale badge, which the next sync corrects.
        authFetch(`/api/onlyfans/chats/${chat.id}/read`, { method: 'POST' }).catch(() => {
          markedRef.current.delete(chat.id);
        });
      }
    },
    [authFetch],
  );

  const handleRefresh = useCallback(() => {
    setThreadReloadToken((n) => n + 1);
    refresh();
  }, [refresh]);

  return (
    // `h-full w-full`, not `h-screen w-screen` — the layout's fixed inset-0 box
    // already spans exactly the client area. See the note there.
    <main className="flex h-full w-full overflow-hidden bg-background">
      <ChatList
        chats={chats}
        selectedId={selectedId}
        onSelect={select}
        loading={loading}
        refreshing={refreshing}
        hasMore={hasMore}
        onRefresh={handleRefresh}
        onLoadMore={loadMore}
        timeZone={userData?.timezone}
      />

      {selected ? (
        // Keyed on the chat so switching threads remounts: draft, scroll
        // position and the older-page cursor all reset together, with no
        // reset-on-prop-change effects to keep in sync.
        <ChatThread
          key={selected.id}
          accountId={accountId}
          chat={selected}
          timeZone={userData?.timezone}
          reloadToken={threadReloadToken}
        />
      ) : (
        <section className="flex flex-1 items-center justify-center">
          <p className="text-sm text-zinc-400">Select a chat to start messaging.</p>
        </section>
      )}
    </main>
  );
}

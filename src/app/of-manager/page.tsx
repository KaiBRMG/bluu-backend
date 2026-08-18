'use client';

import { useCallback, useRef, useState } from 'react';
import { useUserData } from '@/hooks/useUserData';
import { useNetworkStatus } from '@/contexts/NetworkStatusContext';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useOnlyFansChats, type OFChatRow } from '@/hooks/useOnlyFansChats';
import ChatList from './_components/ChatList';
import ChatThread from './_components/ChatThread';
import FanPanel from './_components/FanPanel';

/**
 * Whether the fan panel is open, remembered across window closes.
 *
 * Not per account or per chat: it is a working style ("I keep context open"),
 * not a fact about a fan.
 */
const FAN_PANEL_KEY = 'bluu_of_fan_panel_v1';

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
  const { isOnline } = useNetworkStatus();
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

  /**
   * Default **closed**, deliberately.
   *
   * A satellite window's minimum is 900px, and three panes at that width leaves
   * the thread — the reason the window exists — under 280px. Opening the panel
   * is therefore the operator's trade to make on a wide monitor, not one made
   * for them on a narrow one. Read lazily so the first paint is already correct.
   */
  const [fanPanelOpen, setFanPanelOpen] = useState(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem(FAN_PANEL_KEY) === '1';
    } catch {
      // Private mode. Closed is the safe default.
      return false;
    }
  });

  const toggleFanPanel = useCallback(() => {
    setFanPanelOpen((open) => {
      try {
        localStorage.setItem(FAN_PANEL_KEY, open ? '0' : '1');
      } catch {
        // A forgotten preference is not a broken window.
      }
      return !open;
    });
  }, []);

  const selected = chats.find((c) => c.id === selectedId) ?? null;

  // Deliberately no toast for this one. The chat-list error is *persistent
  // state*, not an event: it is rendered inline above the list with a Retry, so
  // a toast beside it would report the same fact twice and then disappear —
  // leaving the actionable copy on screen and the transient copy remembered.
  // Send failures still toast, because those genuinely are events.

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
        error={error}
        offline={!isOnline}
      />

      {selected ? (
        // Keyed on the chat so switching threads remounts: draft, scroll
        // position and the older-page cursor all reset together, with no
        // reset-on-prop-change effects to keep in sync.
        <ChatThread
          key={`thread-${selected.id}`}
          accountId={accountId}
          chat={selected}
          timeZone={userData?.timezone}
          reloadToken={threadReloadToken}
          fanPanelOpen={fanPanelOpen}
          onToggleFanPanel={toggleFanPanel}
        />
      ) : (
        <section className="flex flex-1 items-center justify-center">
          <p className="text-sm text-zinc-400">Select a chat to start messaging.</p>
        </section>
      )}

      {/* Keyed on the chat for the same reason the thread is: the notes section
          is per-fan and lazily loaded, and a stale note under the wrong fan's
          name is the worst thing this panel could do. The `fan-`/`thread-`
          prefixes are load-bearing — both panes are siblings in this same
          children array, so a bare chat id would collide between them. */}
      {selected && fanPanelOpen && (
        <FanPanel
          key={`fan-${selected.id}`}
          accountId={accountId}
          chat={selected}
          timeZone={userData?.timezone}
          onClose={toggleFanPanel}
        />
      )}
    </main>
  );
}

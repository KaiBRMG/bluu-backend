'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { getCache, setCache } from '@/lib/queryCache';

/**
 * The creator's private note on a fan.
 *
 * **The only billed thing in the fan panel.** Everything else that panel shows
 * rides in free on the chat list and is read out of the Firestore mirror; a note
 * is a provider call per fan, and an operator flicking through twenty threads
 * would otherwise spend twenty credits on a section most fans have nothing in.
 *
 * So it is not fetched when the panel opens — it is fetched when the operator
 * asks. Once asked for, the answer is cached per account+fan for the session:
 * coming back to a fan you were just reading about is free, exactly as the
 * thread history is.
 *
 * Read-only by design. Writing a note is a real-world action on a creator's
 * account and belongs behind the audit log Phase 9 builds.
 */

const NOTES_TTL_MS = 15 * 60 * 1000;

const notesKey = (accountId: string | null, chatId: string) =>
  `bluu_of_fan_notes_v1:${accountId ?? 'unknown'}:${chatId}`;

export function useOnlyFansFanNotes(accountId: string | null, chatId: string) {
  const authFetch = useAuthFetch();

  const [notes, setNotes] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cleared on every fan, so the previous fan's note can never be shown under
  // this one's name — the single worst thing this panel could do.
  useEffect(() => {
    setNotes(getCache<string>(notesKey(accountId, chatId), NOTES_TTL_MS));
    setError(null);
    setLoading(false);
  }, [accountId, chatId]);

  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const body = await authFetch(`/api/onlyfans/chats/${chatId}/notes`);
      const value = typeof body?.notes === 'string' ? body.notes : '';
      setNotes(value);
      setCache(notesKey(accountId, chatId), value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load notes');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [accountId, authFetch, chatId]);

  return { notes, loading, error, load };
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/firebase-config";
import { firestoreToEntry, type CampaignEntry } from "@/lib/campaignTracking";
import { apiRequest } from "@/lib/clientApi";
import { toast } from "sonner";
import { useCreatorAuth } from "@/components/CreatorAuthProvider";
import {
  buildAgenda,
  firestoreToContent,
  type Agenda,
  type AgendaItem,
  type ContentEntry,
} from "./agenda";
import { errorFeedback, successFeedback } from "./haptics";

/**
 * The portal's single data layer: both listeners, the visibility rule, and the
 * completion mutation, in one place.
 *
 * Every screen in the portal reads the same two collections, and before this
 * hook each one re-implemented the subscription, the error branch, the
 * optimistic update and the undo — four copies that had already drifted (the
 * content page's completion was one-way while the dashboard's was undoable).
 *
 * ── Three things here are load-bearing ───────────────────────────────────────
 *
 * 1. **An error must never fall through to an empty list.** `customsError` /
 *    `contentError` are set *before* `loaded`, and every consumer branches to
 *    `LoadError` before its empty branch. A failed listener that renders "all
 *    caught up" tells a creator she has no work when she has a deadline today.
 *
 * 2. **The creator only sees active work.** The queries ask for `In Progress`
 *    and `Outstanding`; `selectVisible*` in agenda.ts additionally drops
 *    archived records. A completed record leaves this hook's world entirely and
 *    reappears on the *staff* side, under "Recently Completed".
 *
 * 3. **Completion is optimistic, animated, and undoable.** The row seals and
 *    recedes immediately; the request runs underneath. On failure the row comes
 *    back and says so. On success the toast carries an Undo that calls the same
 *    endpoint with `{ revert: true }`.
 */

/** How long the seal animation runs before the row is removed. Matches
 *  `.pf-seal` + `.pf-recede` in creator.css. */
const SEAL_MS = 320;

export interface CreatorWork {
  customs: CampaignEntry[];
  content: ContentEntry[];
  agenda: Agenda;
  loading: boolean;
  customsError: boolean;
  contentError: boolean;
  anyError: boolean;
  retry: () => void;
  /** Keys currently playing the completion seal. */
  sealing: ReadonlySet<string>;
  /** Keys hidden optimistically after completing. */
  completed: ReadonlySet<string>;
  /** Complete an item. Customs and content route to their own endpoints. */
  complete: (item: AgendaItem) => Promise<void>;
  /** True while `item` has a request in flight. */
  isBusy: (key: string) => boolean;
  /** The agenda with optimistically-completed items removed. */
  visibleAgenda: Agenda;
}

export function useCreatorWork(): CreatorWork {
  const { creatorUser } = useCreatorAuth();
  const creatorID = creatorUser?.creatorID;
  const timezone = creatorUser?.defaultTimezone;

  const [customs, setCustoms] = useState<CampaignEntry[]>([]);
  const [content, setContent] = useState<ContentEntry[]>([]);
  const [customsLoaded, setCustomsLoaded] = useState(false);
  const [contentLoaded, setContentLoaded] = useState(false);
  const [customsError, setCustomsError] = useState(false);
  const [contentError, setContentError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const [sealing, setSealing] = useState<Set<string>>(new Set());
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  /**
   * A clock the whole render shares. Re-ticked every minute so "due today"
   * becomes "overdue" while the app is open — a portal left open overnight used
   * to keep showing yesterday's classification until it was reloaded. One
   * shared value, so two items either side of midnight can never be classified
   * against different `now`s.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const retry = useCallback(() => {
    setCustomsLoaded(false);
    setContentLoaded(false);
    setCustomsError(false);
    setContentError(false);
    setRetryKey((k) => k + 1);
  }, []);

  // ── Customs: In Progress only ──────────────────────────────────────────────
  useEffect(() => {
    if (!creatorID) return;
    const q = query(
      collection(db, "campaign-tracking"),
      where("creatorID", "==", creatorID),
      where("status", "==", "In Progress"),
    );
    return onSnapshot(
      q,
      (snap) => {
        setCustoms(snap.docs.map((d) => firestoreToEntry(d.id, d.data() as Record<string, unknown>)));
        setCustomsError(false);
        setCustomsLoaded(true);
      },
      (error) => {
        console.error("[useCreatorWork] campaign-tracking listener error:", error);
        // Order matters: the error flag must be true before `loaded` clears, or
        // consumers render the empty state for one frame and tell the creator
        // she has nothing outstanding.
        setCustomsError(true);
        setCustomsLoaded(true);
      },
    );
    // creatorID, not the provider object: the object's identity changes on any
    // provider re-render, which would tear down and re-establish the listener.
  }, [creatorID, retryKey]);

  // ── Content planning: Outstanding only ─────────────────────────────────────
  useEffect(() => {
    if (!creatorID) return;
    const q = query(
      collection(db, "content-planning"),
      where("creatorID", "==", creatorID),
      where("status", "==", "Outstanding"),
      orderBy("dueDate", "asc"),
    );
    return onSnapshot(
      q,
      (snap) => {
        setContent(snap.docs.map((d) => firestoreToContent(d.id, d.data() as Record<string, unknown>)));
        setContentError(false);
        setContentLoaded(true);
      },
      (error) => {
        console.error("[useCreatorWork] content-planning listener error:", error);
        setContentError(true);
        setContentLoaded(true);
      },
    );
  }, [creatorID, retryKey]);

  const agenda = useMemo(
    () => buildAgenda(customs, content, timezone, now),
    [customs, content, timezone, now],
  );

  /**
   * Prune optimistic keys the listener has caught up with.
   *
   * Without this, `completed` grows for the lifetime of the session, and — more
   * importantly — an item restored by Undo would stay hidden because its key
   * was still in the set from before.
   */
  const liveKeys = useMemo(() => new Set(agenda.all.map((i) => i.key)), [agenda]);
  useEffect(() => {
    setCompleted((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((k) => liveKeys.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [liveKeys]);

  /** The agenda as the screen should show it: optimistic removals applied, and
   *  any group left empty by them dropped so no header hangs over nothing. */
  const visibleAgenda = useMemo<Agenda>(() => {
    if (completed.size === 0) return agenda;
    const keep = (i: AgendaItem) => !completed.has(i.key);
    const groups = agenda.groups
      .map((g) => ({ ...g, items: g.items.filter(keep) }))
      .filter((g) => g.items.length > 0);
    const all = agenda.all.filter(keep);
    return {
      ...agenda,
      groups,
      all,
      lateCount: all.filter((i) => i.urgency === "late").length,
      todayCount: all.filter((i) => i.urgency === "today").length,
      upcomingCount: all.filter((i) => i.urgency === "soon" || i.urgency === "later").length,
      undatedCount: all.filter((i) => i.urgency === "undated").length,
      nextGroup: groups.find((g) => g.bucket === "soon" || g.bucket === "later") ?? null,
    };
  }, [agenda, completed]);

  // ── Completion ─────────────────────────────────────────────────────────────

  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const endpointFor = (item: AgendaItem) =>
    item.kind === "custom"
      ? `/api/campaign-tracking/${item.id}/creator-complete`
      : `/api/content-planning/${item.id}/creator-complete`;

  const restore = useCallback((key: string) => {
    setSealing((s) => {
      const n = new Set(s);
      n.delete(key);
      return n;
    });
    setCompleted((s) => {
      const n = new Set(s);
      n.delete(key);
      return n;
    });
  }, []);

  const undo = useCallback(
    async (item: AgendaItem) => {
      restore(item.key);
      try {
        const res = await apiRequest(endpointFor(item), {
          method: "POST",
          body: JSON.stringify({ revert: true }),
        });
        if (!res.ok) throw new Error(String(res.status));
        toast.success(
          item.kind === "custom" ? "Sent back — no longer marked done" : "Restored to your schedule",
        );
      } catch {
        // The revert failed, so the record really is still completed. Put the
        // row back in the completed state rather than leaving the screen
        // claiming something the server does not agree with.
        setCompleted((s) => new Set(s).add(item.key));
        errorFeedback();
        toast.error("Couldn't undo that — please try again");
      }
    },
    [restore],
  );

  const complete = useCallback(
    async (item: AgendaItem) => {
      if (busy.has(item.key)) return;

      setBusy((s) => new Set(s).add(item.key));
      // Seal first, hide after the animation. The request runs underneath, so
      // the beat lands immediately even on a slow connection.
      setSealing((s) => new Set(s).add(item.key));
      const t = window.setTimeout(() => {
        setCompleted((s) => new Set(s).add(item.key));
      }, SEAL_MS);
      timers.current.push(t);

      try {
        const res = await apiRequest(endpointFor(item), {
          method: "POST",
          body: JSON.stringify({ revert: false }),
        });
        if (!res.ok) throw new Error(String(res.status));
        successFeedback();
        toast.success("Done", {
          description: "Your manager will check it over.",
          action: { label: "Undo", onClick: () => void undo(item) },
        });
      } catch {
        window.clearTimeout(t);
        restore(item.key);
        errorFeedback();
        toast.error("Couldn't mark that done", {
          description: "Check your connection and try again.",
        });
      } finally {
        setBusy((s) => {
          const n = new Set(s);
          n.delete(item.key);
          return n;
        });
      }
    },
    [busy, undo, restore],
  );

  const isBusy = useCallback((key: string) => busy.has(key), [busy]);

  return {
    customs,
    content,
    agenda,
    visibleAgenda,
    loading: !customsLoaded || !contentLoaded,
    customsError,
    contentError,
    anyError: customsError || contentError,
    retry,
    sealing,
    completed,
    complete,
    isBusy,
  };
}

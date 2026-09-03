/**
 * The creator portal's work model.
 *
 * The portal used to group by record type — customs in one section, content
 * planning in another — which asks a creator to answer "what do I owe?" by
 * reading two lists and merging them in her head. This module merges them once,
 * here, into a single stream ordered by **when the work is due**, which is the
 * only ordering that answers the question the portal exists to answer.
 *
 * Two rules are enforced in this file rather than at each call site, because
 * getting either wrong is invisible until it matters:
 *
 *  1. **A deadline is late in the creator's day, not in UTC.** Everything
 *     resolves through `src/lib/timezone.ts` against `creatorUser.defaultTimezone`.
 *     See the header of that file for the bug this prevents.
 *  2. **The creator only ever sees active work** — customs at `In Progress`,
 *     content at `Outstanding`. `selectVisible*` below is the single gate, and
 *     it also drops archived records, which a `where` clause on status alone
 *     would let through.
 */

import {
  type CampaignEntry,
  type CRPriority,
  CAMPAIGN_TYPES,
  formatDueDate,
} from "@/lib/campaignTracking";
import { dueDeadlineMs, resolveTimezone } from "@/lib/timezone";
import type { CustomType, Urgency } from "../theme";

// ── Content planning ─────────────────────────────────────────────────────────

export interface ContentDescriptionRow {
  qty: string;
  content: string;
}

/** One content-planning record, as the portal reads it. Shared by the dashboard
 *  and the content page so the two cannot drift apart. */
export interface ContentEntry {
  id: string;
  contentType: string;
  contentSummary: string;
  description: ContentDescriptionRow[];
  comment: string;
  dueDate: string | null;
  createdAt: string | null;
  status: "Outstanding" | "Completed";
  creatorID: string;
  isArchived: boolean;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  const d = (v as { toDate?: () => Date }).toDate;
  return typeof d === "function" ? (v as { toDate: () => Date }).toDate().toISOString() : null;
}

export function firestoreToContent(id: string, data: Record<string, unknown>): ContentEntry {
  return {
    id,
    contentType: (data.contentType as string) ?? "SFW",
    contentSummary: (data.contentSummary as string) ?? "",
    description: (data.description as ContentDescriptionRow[]) ?? [],
    comment: (data.comment as string) ?? "",
    dueDate: typeof data.dueDate === "string" ? data.dueDate : null,
    createdAt: toIso(data.createdAt),
    status: (data.status as ContentEntry["status"]) ?? "Outstanding",
    creatorID: (data.creatorID as string) ?? "",
    isArchived: (data.isArchived as boolean) ?? false,
  };
}

// ── Visibility: the single gate ──────────────────────────────────────────────

/**
 * The customs a creator may see: `In Progress`, never archived, and never a
 * campaign type (BFE / Hubby / VIP have no approval workflow and no CR code).
 *
 * `isArchived` is filtered **here rather than in the Firestore `where` clause**
 * on purpose. The query already reads these documents, so filtering client-side
 * costs nothing extra, and adding a fourth `where` would require a new composite
 * index — a deploy step, for no benefit (cross-cutting rule 9).
 */
export function selectVisibleCustoms(entries: CampaignEntry[]): CampaignEntry[] {
  return entries.filter(
    (e) =>
      e.status === "In Progress" &&
      !e.isArchived &&
      !(CAMPAIGN_TYPES as readonly string[]).includes(e.type),
  );
}

/** The content-planning records a creator may see: `Outstanding`, not archived. */
export function selectVisibleContent(entries: ContentEntry[]): ContentEntry[] {
  return entries.filter((e) => e.status === "Outstanding" && !e.isArchived);
}

// ── Local-day arithmetic ─────────────────────────────────────────────────────

/** `YYYY-MM-DD` for an instant, in the given IANA zone. */
export function localDayKey(ms: number, timezone?: string | null): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const at = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  return `${at("year")}-${at("month")}-${at("day")}`;
}

/**
 * The day a due date belongs to.
 *
 * Taken straight off the string rather than re-derived from the deadline
 * instant: a `dueDate` is authored as a local wall-clock date, so its date part
 * *is* the local day. Round-tripping it through UTC is how an item lands in the
 * wrong day group either side of midnight.
 */
export function dueDayKey(dueDate: string | null | undefined): string | null {
  if (!dueDate) return null;
  const datePart = dueDate.split("T")[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : null;
}

/** Whole days between two `YYYY-MM-DD` keys (`b - a`). */
export function dayDelta(from: string, to: string): number {
  const ms = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

// ── The agenda item ──────────────────────────────────────────────────────────

export interface AgendaItem {
  /** Stable across both collections — ids are only unique within one. */
  key: string;
  kind: "custom" | "content";
  id: string;
  /** The line a creator scans: the fan's name, or the content summary. */
  title: string;
  /** `CR0042`. Customs only. */
  code?: string;
  /** `Custom` / `Call` / `Item`, or the content type (`SFW`, `PPV`, …). */
  typeLabel: string;
  amount?: number;
  dueDate: string | null;
  dueDayKey: string | null;
  /** Pretty-printed due date, including any authored time. */
  dueLabel: string | null;
  deadlineMs: number | null;
  startMs: number | null;
  urgency: Urgency;
  priority?: CRPriority | null;
  /** How much of the item's window has burned down, 0–1. Null with no deadline. */
  runway: number | null;
  /** The source record, for the detail dialog. Exactly one is set. */
  custom?: CampaignEntry;
  content?: ContentEntry;
}

/** Fallback window for an item with no creation timestamp — long enough that a
 *  freshly-seen item does not open with a nearly-full runway. */
const DEFAULT_WINDOW_MS = 14 * 86_400_000;

function runwayFraction(startMs: number | null, deadlineMs: number | null, now: number): number | null {
  if (deadlineMs === null) return null;
  const start = startMs ?? deadlineMs - DEFAULT_WINDOW_MS;
  const window = deadlineMs - start;
  if (window <= 0) return 1;
  return Math.min(1, Math.max(0, (now - start) / window));
}

function classify(
  deadlineMs: number | null,
  dayKey: string | null,
  todayKey: string,
  now: number,
): Urgency {
  if (deadlineMs === null || dayKey === null) return "undated";
  if (deadlineMs < now) return "late";
  const delta = dayDelta(todayKey, dayKey);
  if (delta <= 0) return "today";
  if (delta <= 3) return "soon";
  return "later";
}

function customToAgenda(e: CampaignEntry, tz: string | undefined, now: number, todayKey: string): AgendaItem {
  const deadlineMs = dueDeadlineMs(e.dueDate, tz);
  const dayKey = dueDayKey(e.dueDate);
  const startMs = e.createdTime ? new Date(e.createdTime).getTime() || null : null;
  return {
    key: `custom:${e.id}`,
    kind: "custom",
    id: e.id,
    title: e.fanName || "Unnamed fan",
    code: e.CR,
    typeLabel: e.type === "CR" ? "Custom" : e.type,
    amount: e.totalAmount,
    dueDate: e.dueDate ?? null,
    dueDayKey: dayKey,
    dueLabel: e.dueDate
      ? `${formatDueDate(e.dueDate)}${e.dueDateTimezone ? ` (${e.dueDateTimezone})` : ""}`
      : null,
    deadlineMs,
    startMs,
    urgency: classify(deadlineMs, dayKey, todayKey, now),
    priority: e.priority ?? null,
    runway: runwayFraction(startMs, deadlineMs, now),
    custom: e,
  };
}

function contentToAgenda(e: ContentEntry, tz: string | undefined, now: number, todayKey: string): AgendaItem {
  const deadlineMs = dueDeadlineMs(e.dueDate, tz);
  const dayKey = dueDayKey(e.dueDate);
  const startMs = e.createdAt ? new Date(e.createdAt).getTime() || null : null;
  return {
    key: `content:${e.id}`,
    kind: "content",
    id: e.id,
    title: e.contentSummary || "Untitled content",
    typeLabel: e.contentType,
    dueDate: e.dueDate,
    dueDayKey: dayKey,
    dueLabel: e.dueDate ? formatDueDate(e.dueDate) : null,
    deadlineMs,
    startMs,
    urgency: classify(deadlineMs, dayKey, todayKey, now),
    runway: runwayFraction(startMs, deadlineMs, now),
    content: e,
  };
}

// ── Grouping ─────────────────────────────────────────────────────────────────

export interface DayGroup {
  /** `overdue` and `undated` are buckets, not days; the rest are `YYYY-MM-DD`. */
  id: string;
  label: string;
  /** The second line of the header — a date, or nothing for the named buckets. */
  sub: string | null;
  bucket: Urgency;
  items: AgendaItem[];
}

export interface Agenda {
  groups: DayGroup[];
  all: AgendaItem[];
  lateCount: number;
  todayCount: number;
  upcomingCount: number;
  undatedCount: number;
  /** The next dated group after today, for the verdict's "next up" line. */
  nextGroup: DayGroup | null;
  todayKey: string;
}

function orderWithin(items: AgendaItem[]): AgendaItem[] {
  const rank: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
  return [...items].sort((a, b) => {
    // Earliest deadline first; within the same instant, higher priority first.
    const da = a.deadlineMs ?? Number.MAX_SAFE_INTEGER;
    const dbb = b.deadlineMs ?? Number.MAX_SAFE_INTEGER;
    if (da !== dbb) return da - dbb;
    const pa = a.priority ? (rank[a.priority] ?? 3) : 3;
    const pb = b.priority ? (rank[b.priority] ?? 3) : 3;
    if (pa !== pb) return pa - pb;
    return a.title.localeCompare(b.title);
  });
}

/** The weekday/date header for a dated group. */
function dayHeading(dayKey: string, todayKey: string): { label: string; sub: string | null } {
  const delta = dayDelta(todayKey, dayKey);
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const long = date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const short = date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  if (delta === 0) return { label: "Today", sub: short };
  if (delta === 1) return { label: "Tomorrow", sub: short };
  if (delta > 1 && delta <= 6) {
    return {
      label: date.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" }),
      sub: short,
    };
  }
  return { label: long, sub: null };
}

/**
 * Build the full agenda from both collections.
 *
 * `now` is injected so this is pure and testable, and so a single clock drives
 * a whole render — an agenda that read `Date.now()` per item could classify two
 * items either side of midnight inconsistently.
 */
export function buildAgenda(
  customs: CampaignEntry[],
  content: ContentEntry[],
  timezone?: string,
  now: number = Date.now(),
): Agenda {
  const todayKey = localDayKey(now, timezone);

  const all = [
    ...selectVisibleCustoms(customs).map((e) => customToAgenda(e, timezone, now, todayKey)),
    ...selectVisibleContent(content).map((e) => contentToAgenda(e, timezone, now, todayKey)),
  ];

  const late = orderWithin(all.filter((i) => i.urgency === "late"));
  const undated = orderWithin(all.filter((i) => i.urgency === "undated"));
  const dated = all.filter((i) => i.urgency !== "late" && i.urgency !== "undated");

  const byDay = new Map<string, AgendaItem[]>();
  for (const item of dated) {
    const k = item.dueDayKey!;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(item);
  }

  const groups: DayGroup[] = [];

  if (late.length > 0) {
    groups.push({
      id: "overdue",
      label: "Overdue",
      sub: null,
      bucket: "late",
      items: late,
    });
  }

  for (const dayKey of [...byDay.keys()].sort()) {
    const { label, sub } = dayHeading(dayKey, todayKey);
    groups.push({
      id: dayKey,
      label,
      sub,
      bucket: dayKey === todayKey ? "today" : dayDelta(todayKey, dayKey) <= 3 ? "soon" : "later",
      items: orderWithin(byDay.get(dayKey)!),
    });
  }

  if (undated.length > 0) {
    groups.push({
      id: "undated",
      label: "No due date",
      sub: null,
      bucket: "undated",
      items: undated,
    });
  }

  const todayCount = all.filter((i) => i.urgency === "today").length;

  return {
    groups,
    all,
    lateCount: late.length,
    todayCount,
    upcomingCount: all.filter((i) => i.urgency === "soon" || i.urgency === "later").length,
    undatedCount: undated.length,
    nextGroup: groups.find((g) => g.bucket === "soon" || g.bucket === "later") ?? null,
    todayKey,
  };
}

// ── The verdict ──────────────────────────────────────────────────────────────

export interface Verdict {
  /** The large line. A sentence, never a bare number. */
  headline: string;
  /** One quiet line of context beneath it. */
  sub: string;
  /** Drives the accent on the verdict's own mark. */
  tone: Urgency | "clear";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The one sentence the dashboard opens with.
 *
 * Deliberately prose rather than the big-number-and-label hero that this
 * category defaults to: a creator opening the app at midnight wants to be told
 * the answer, not handed a metric to interpret.
 */
export function buildVerdict(agenda: Agenda): Verdict {
  const { lateCount, todayCount, upcomingCount, undatedCount, nextGroup } = agenda;
  const total = agenda.all.length;

  if (total === 0) {
    return {
      headline: "You're all caught up.",
      sub: "Nothing outstanding right now — we'll let you know when something lands.",
      tone: "clear",
    };
  }

  if (lateCount > 0) {
    return {
      headline: `${plural(lateCount, "thing is", "things are")} overdue.`,
      sub:
        todayCount > 0
          ? `And ${plural(todayCount, "more is", "more are")} due today.`
          : upcomingCount > 0
            ? `Nothing else is due today. ${plural(upcomingCount, "thing is", "things are")} coming up.`
            : "Nothing else is due today.",
      tone: "late",
    };
  }

  if (todayCount > 0) {
    return {
      headline: `${plural(todayCount, "thing is", "things are")} due today.`,
      sub:
        upcomingCount > 0
          ? `${plural(upcomingCount, "more", "more")} coming up after that.`
          : "Nothing else on the schedule.",
      tone: "today",
    };
  }

  if (upcomingCount > 0) {
    return {
      headline: "Nothing due today.",
      sub: nextGroup
        ? `Next up ${nextGroup.label.toLowerCase()}${nextGroup.sub ? ` (${nextGroup.sub})` : ""} — ${plural(nextGroup.items.length, "item", "items")}.`
        : `${plural(upcomingCount, "thing", "things")} coming up.`,
      tone: "clear",
    };
  }

  return {
    headline: "Nothing due today.",
    sub: `${plural(undatedCount, "item has", "items have")} no due date yet.`,
    tone: "clear",
  };
}

// ── Small labels ─────────────────────────────────────────────────────────────

/** The compact countdown that rides in the mono column of a work row. */
export function countdownLabel(item: AgendaItem, todayKey: string): string {
  if (!item.dueDayKey) return "no date";
  const delta = dayDelta(todayKey, item.dueDayKey);
  if (item.urgency === "late") {
    if (delta === 0) return "late today";
    const behind = Math.abs(delta);
    return `${behind}d late`;
  }
  if (delta === 0) return "due today";
  if (delta === 1) return "tomorrow";
  return `in ${delta}d`;
}

/** Totals for the customs ledger. */
export function sumAmounts(items: AgendaItem[]): number {
  return items.reduce((n, i) => n + (i.amount ?? 0), 0);
}

/**
 * Group visible customs by their type, most urgent first within each group,
 * dropping types with nothing in them.
 *
 * The empty-type drop is deliberate and long-standing: Calls and Items are
 * usually empty, and on a phone the panels stack — so rendering all three put
 * two "nothing here" blocks between a creator and her actual work.
 */
export function customsByType(items: AgendaItem[]): { type: CustomType; items: AgendaItem[] }[] {
  const order: CustomType[] = ["CR", "Call", "Item"];
  return order
    .map((type) => ({
      type,
      items: orderWithin(items.filter((i) => i.custom?.type === type)),
    }))
    .filter((g) => g.items.length > 0);
}

'use client';

import { useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ArrowDown, ArrowUp, ChevronsUpDown, RotateCw, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DeletedUser } from '@/components/DeletedUser';
import {
  useNotificationLogs,
  type LogRangeDays,
  type NotificationLogRow,
} from '@/hooks/useNotificationLogs';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { notificationTypeBadge, NOTIFICATION_TYPE_BADGE } from '@/lib/notificationTypeBadge';

// ─── Derived vocabularies ───────────────────────────────────────────
//
// A notification carries two raw booleans (`read`, `dismissedByUser`) and its
// provenance as a nullable `batchId`. Both collapse into one closed vocabulary
// here rather than being rendered as columns of ticks, so a row states *where
// this landed* in one glance (DESIGN.md — derive a stage, don't show enums).

type DeliveryStage = 'unopened' | 'opened' | 'dismissed';

const DELIVERY_STAGE: Record<DeliveryStage, { label: string; dot: string; ink: string }> = {
  // Orange waits on a person — nobody has looked at this one yet.
  unopened: { label: 'Unopened', dot: '#fb923c', ink: 'text-orange-400' },
  opened: { label: 'Opened', dot: '#4ade80', ink: 'text-green-400' },
  dismissed: { label: 'Dismissed', dot: '#a1a1aa', ink: 'text-zinc-400' },
};

function deliveryStage(row: NotificationLogRow): DeliveryStage {
  if (row.dismissedByUser) return 'dismissed';
  return row.read ? 'opened' : 'unopened';
}

type SourceKind = 'manual' | 'automated';

/** Provenance is `batchId`, never `sentByName` — an unsent batch leaves the name null. */
const sourceKind = (row: NotificationLogRow): SourceKind => (row.batchId ? 'manual' : 'automated');

const RANGE_LABELS: Record<LogRangeDays, string> = {
  1: 'Last 24 hours',
  7: 'Last 7 days',
  30: 'Last 30 days',
  90: 'Last 90 days',
  0: 'All time',
};

const RANGE_VALUES: LogRangeDays[] = [1, 7, 30, 90, 0];

type SortKey = 'sent' | 'recipient' | 'title' | 'type' | 'status';
type SortDir = 'asc' | 'desc';

interface Filters {
  query: string;
  type: string;
  source: string;
  status: string;
  recipient: string;
}

const NO_FILTERS: Filters = {
  query: '',
  type: 'all',
  source: 'all',
  status: 'all',
  recipient: 'all',
};

function SortHeader({
  column,
  label,
  className,
  sort,
  onToggle,
}: {
  column: SortKey;
  label: string;
  className?: string;
  sort: { key: SortKey; dir: SortDir };
  onToggle: (key: SortKey) => void;
}) {
  const active = sort.key === column;
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead
      className={className}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onToggle(column)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-white ${
          active ? 'text-white' : ''
        }`}
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? 'opacity-100' : 'opacity-40'}`} />
      </button>
    </TableHead>
  );
}

export default function NotificationLogsList() {
  const [days, setDays] = useState<LogRangeDays>(7);
  const { rows, loading, loadingMore, error, nextCursor, loadMore, refetch } =
    useNotificationLogs(days);
  const { timezone } = useViewerTimezone();

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'sent', dir: 'desc' });

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters(prev => ({ ...prev, [key]: value }));

  const filtersActive =
    filters.query.trim() !== '' ||
    filters.type !== 'all' ||
    filters.source !== 'all' ||
    filters.status !== 'all' ||
    filters.recipient !== 'all';

  // One predicate per facet, so a facet's own count can be taken with that
  // facet cleared. A count taken over the whole window is a lie (DESIGN.md).
  const predicates = useMemo(() => {
    const needle = filters.query.trim().toLowerCase();
    return {
      query: (r: NotificationLogRow) =>
        needle === '' ||
        r.title.toLowerCase().includes(needle) ||
        r.message.toLowerCase().includes(needle) ||
        r.displayName.toLowerCase().includes(needle) ||
        (r.sentByName ?? '').toLowerCase().includes(needle),
      type: (r: NotificationLogRow) => filters.type === 'all' || r.type === filters.type,
      source: (r: NotificationLogRow) =>
        filters.source === 'all' || sourceKind(r) === filters.source,
      status: (r: NotificationLogRow) =>
        filters.status === 'all' || deliveryStage(r) === filters.status,
      recipient: (r: NotificationLogRow) =>
        filters.recipient === 'all' || r.userId === filters.recipient,
    };
  }, [filters]);

  /** Rows matching every facet except the named one — the basis of a faceted count. */
  const rowsExcept = useMemo(() => {
    const keys = Object.keys(predicates) as (keyof typeof predicates)[];
    const out = {} as Record<keyof typeof predicates, NotificationLogRow[]>;
    for (const skip of keys) {
      out[skip] = rows.filter(r => keys.every(k => k === skip || predicates[k](r)));
    }
    return out;
  }, [rows, predicates]);

  const filtered = useMemo(
    () => rowsExcept.query.filter(predicates.query),
    [rowsExcept, predicates],
  );

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const stageOrder: DeliveryStage[] = ['unopened', 'opened', 'dismissed'];
    // A deleted user sorts last in either direction's natural reading by
    // standing in as the highest codepoint, rather than jumping to the top.
    const name = (r: NotificationLogRow) => r.displayName || '￿';

    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case 'recipient':
          return dir * name(a).localeCompare(name(b));
        case 'title':
          return dir * a.title.localeCompare(b.title);
        case 'type':
          return dir * a.type.localeCompare(b.type);
        case 'status':
          return dir * (stageOrder.indexOf(deliveryStage(a)) - stageOrder.indexOf(deliveryStage(b)));
        case 'sent':
        default:
          return dir * ((a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
      }
    });
  }, [filtered, sort]);

  // Recipient options come from the window itself — a picker listing the whole
  // registry would offer names with nothing behind them.
  const recipientOptions = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const r of rowsExcept.recipient) {
      const entry = counts.get(r.userId);
      if (entry) entry.count += 1;
      else counts.set(r.userId, { name: r.displayName, count: 1 });
    }
    return [...counts.entries()]
      .map(([uid, v]) => ({ uid, ...v }))
      .sort((a, b) => (a.name || '￿').localeCompare(b.name || '￿'));
  }, [rowsExcept]);

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rowsExcept.type) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
    return counts;
  }, [rowsExcept]);

  const sourceCounts = useMemo(() => {
    const counts = { manual: 0, automated: 0 };
    for (const r of rowsExcept.source) counts[sourceKind(r)] += 1;
    return counts;
  }, [rowsExcept]);

  const statusCounts = useMemo(() => {
    const counts: Record<DeliveryStage, number> = { unopened: 0, opened: 0, dismissed: 0 };
    for (const r of rowsExcept.status) counts[deliveryStage(r)] += 1;
    return counts;
  }, [rowsExcept]);

  function toggleSort(key: SortKey) {
    setSort(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'sent' ? 'desc' : 'asc' },
    );
  }

  const exactTime = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat('en-GB', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: timezone,
        }).format(new Date(iso))
      : 'Unknown';

  const controls = (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[14rem] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
        <Input
          value={filters.query}
          onChange={e => set('query', e.target.value)}
          placeholder="Search title, message or person…"
          className="h-8 pl-8 text-sm"
          aria-label="Search the notification log"
        />
      </div>

      <Select value={filters.type} onValueChange={v => set('type', v)}>
        <SelectTrigger size="sm" className="w-[9.5rem]" aria-label="Filter by type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          {Object.entries(NOTIFICATION_TYPE_BADGE).map(([value, meta]) => (
            <SelectItem key={value} value={value}>
              {meta.label}
              <span className="ml-1 tabular-nums text-zinc-400">{typeCounts.get(value) ?? 0}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.source} onValueChange={v => set('source', v)}>
        <SelectTrigger size="sm" className="w-[10.5rem]" aria-label="Filter by source">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sources</SelectItem>
          <SelectItem value="automated">
            Automated
            <span className="ml-1 tabular-nums text-zinc-400">{sourceCounts.automated}</span>
          </SelectItem>
          <SelectItem value="manual">
            Sent by admin
            <span className="ml-1 tabular-nums text-zinc-400">{sourceCounts.manual}</span>
          </SelectItem>
        </SelectContent>
      </Select>

      <Select value={filters.status} onValueChange={v => set('status', v)}>
        <SelectTrigger size="sm" className="w-[9.5rem]" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any status</SelectItem>
          {(Object.keys(DELIVERY_STAGE) as DeliveryStage[]).map(stage => (
            <SelectItem key={stage} value={stage}>
              {DELIVERY_STAGE[stage].label}
              <span className="ml-1 tabular-nums text-zinc-400">{statusCounts[stage]}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.recipient} onValueChange={v => set('recipient', v)}>
        <SelectTrigger size="sm" className="w-[12rem]" aria-label="Filter by recipient">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value="all">All recipients</SelectItem>
          {recipientOptions.map(option => (
            <SelectItem key={option.uid} value={option.uid}>
              {option.name || 'Deleted User'}
              <span className="ml-1 tabular-nums text-zinc-400">{option.count}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={String(days)} onValueChange={v => setDays(Number(v) as LogRangeDays)}>
        <SelectTrigger size="sm" className="w-[9.5rem]" aria-label="Time range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGE_VALUES.map(value => (
            <SelectItem key={value} value={String(value)}>
              {RANGE_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {filtersActive && (
        <Button variant="ghost" size="sm" onClick={() => setFilters(NO_FILTERS)}>
          <X className="h-3.5 w-3.5" />
          Clear filters
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={refetch}
        disabled={loading}
        aria-label="Refresh the log"
      >
        <RotateCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
      </Button>
    </div>
  );

  if (loading) {
    return (
      <>
        {controls}
        <div className="mt-4 space-y-2">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-md" />
          ))}
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        {controls}
        <div className="mt-6 flex items-center gap-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      {controls}

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-400">
          Nothing was sent in this window. Widen the range to look further back.
        </p>
      ) : sorted.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-400">
          Nothing matches these filters.{' '}
          <button
            type="button"
            onClick={() => setFilters(NO_FILTERS)}
            className="underline underline-offset-2 hover:text-white"
          >
            Clear them to see all {rows.length}
          </button>
          .
        </p>
      ) : (
        <>
          <div
            className="mt-4 overflow-hidden rounded-lg"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader sort={sort} onToggle={toggleSort} column="title" label="Notification" />
                  <SortHeader sort={sort} onToggle={toggleSort} column="type" label="Type" className="w-28" />
                  <SortHeader
                    sort={sort}
                    onToggle={toggleSort}
                    column="recipient"
                    label="Recipient"
                    className="w-44"
                  />
                  <TableHead className="w-40">Source</TableHead>
                  <SortHeader sort={sort} onToggle={toggleSort} column="status" label="Status" className="w-32" />
                  <SortHeader sort={sort} onToggle={toggleSort} column="sent" label="Sent" className="w-36" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(row => {
                  const typeMeta = notificationTypeBadge(row.type);
                  const stage = DELIVERY_STAGE[deliveryStage(row)];
                  const sentAt = row.createdAt ? new Date(row.createdAt) : null;

                  return (
                    <TableRow key={row.id}>
                      <TableCell className="max-w-0">
                        <span className="block truncate font-medium" title={row.title}>
                          {row.title}
                        </span>
                        <span className="block truncate text-xs text-zinc-400" title={row.message}>
                          {row.message}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={typeMeta.className}>
                          {typeMeta.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-zinc-400">
                        {row.displayName || <DeletedUser />}
                      </TableCell>
                      <TableCell className="truncate text-sm text-zinc-400">
                        {row.batchId ? (row.sentByName ?? 'Sent by an admin') : 'Automated'}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1.5 text-sm ${stage.ink}`}>
                          <span
                            aria-hidden
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: stage.dot }}
                          />
                          {stage.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-zinc-400">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="tabular-nums">
                              {sentAt ? formatDistanceToNow(sentAt, { addSuffix: true }) : '—'}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{exactTime(row.createdAt)}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="mt-3 flex items-center justify-between gap-4">
            <p className="text-xs text-zinc-400">
              Showing <span className="tabular-nums">{sorted.length}</span> of{' '}
              <span className="tabular-nums">{rows.length}</span> loaded ·{' '}
              {RANGE_LABELS[days].toLowerCase()} · creators are notified over Telegram and have no
              in-app record here
            </p>
            {nextCursor && (
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            )}
          </div>
        </>
      )}
    </>
  );
}

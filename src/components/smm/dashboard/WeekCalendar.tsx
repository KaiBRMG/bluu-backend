'use client';

import { useMemo } from 'react';
import {
  addDays, addWeeks, endOfWeek, format, isSameDay, isToday, startOfWeek,
} from 'date-fns';
import { ChevronLeftIcon, ChevronRightIcon, ListIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SmmPost } from '@/types/firestore';

const WEEK_OPTS = { weekStartsOn: 1 as const }; // Monday-start weeks
const CAPTION_CAP = 60; // max caption chars on a calendar card before truncation

/** Truncate a caption to a fixed length so cards never overflow their column. */
function capCaption(caption: string): string {
  return caption.length > CAPTION_CAP ? `${caption.slice(0, CAPTION_CAP).trimEnd()}…` : caption;
}

/** Default card body: the (character-capped) caption. */
function CaptionBody({ post }: { post: SmmPost }) {
  if (!post.caption) return null;
  return <p className="text-[11px] text-muted-foreground line-clamp-2 break-words">{capCaption(post.caption)}</p>;
}

/**
 * A single scheduled post rendered as a card inside a day column. The body is
 * pluggable (`renderBody`) so the dashboard can show the caption while the admin
 * content schedule shows the poster's avatar. A 💰 marks posts submitted for a bonus.
 */
function PostCard({
  post,
  onClick,
  renderBody,
}: {
  post: SmmPost;
  onClick: () => void;
  renderBody: (post: SmmPost) => React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-md border border-border/60 bg-card px-2 py-1.5 shadow-xs transition-colors hover:border-primary/50 hover:bg-accent"
    >
      <div className="flex items-center gap-1">
        {post.bonusSubmission && (
          <span className="shrink-0 text-sm" role="img" title="Submitted for bonus" aria-label="Submitted for bonus">💰</span>
        )}
        <p className="min-w-0 flex-1 text-xs font-semibold truncate">{post.accountName}</p>
      </div>
      {renderBody(post)}
    </button>
  );
}

/**
 * Custom Monday–Sunday week grid linked to the caller's content schedule.
 * Click a post card to open it; click empty space in a day to schedule one.
 */
export function WeekCalendar({
  posts,
  loading,
  anchorDate,
  onWeekChange,
  onPostClick,
  onDayClick,
  onShowAll,
  renderCardBody = (post) => <CaptionBody post={post} />,
}: {
  posts: SmmPost[];
  loading: boolean;
  anchorDate: Date;
  onWeekChange: (date: Date) => void;
  onPostClick: (post: SmmPost) => void;
  onDayClick?: (date: Date) => void; // omit to disable click-to-schedule (admin view)
  onShowAll?: () => void;            // omit to hide the "Show All Posts" button
  renderCardBody?: (post: SmmPost) => React.ReactNode;
}) {
  const weekStart = useMemo(() => startOfWeek(anchorDate, WEEK_OPTS), [anchorDate]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const postsByDay = useMemo(() => {
    const map = new Map<string, SmmPost[]>();
    for (const post of posts) {
      if (!post.postDate) continue;
      const key = format(new Date(post.postDate), 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(post);
    }
    return map;
  }, [posts]);

  const weekEnd = endOfWeek(weekStart, WEEK_OPTS);
  const rangeLabel = `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`;

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Button variant="outline" size="icon" onClick={() => onWeekChange(addWeeks(weekStart, -1))} aria-label="Previous week">
          <ChevronLeftIcon className="size-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => onWeekChange(new Date())}>Today</Button>
        <Button variant="outline" size="icon" onClick={() => onWeekChange(addWeeks(weekStart, 1))} aria-label="Next week">
          <ChevronRightIcon className="size-4" />
        </Button>
        <span className="ml-2 text-sm font-medium text-muted-foreground">{rangeLabel}</span>
        {onShowAll && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={onShowAll}>
            <ListIcon className="size-4" />
            Show All Posts
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-7 gap-px bg-border">
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const dayPosts = postsByDay.get(key) ?? [];
          return (
            <div
              key={key}
              className="min-h-36 bg-card flex flex-col"
            >
              <div className={cn(
                'flex items-center justify-between px-2 py-1.5 text-xs font-medium border-b',
                isToday(day) && 'bg-primary/5',
              )}>
                <span className="text-muted-foreground">{format(day, 'EEE')}</span>
                <span className={cn(
                  'flex size-6 items-center justify-center rounded-full',
                  isToday(day) && 'bg-primary text-primary-foreground',
                )}>
                  {format(day, 'd')}
                </span>
              </div>
              {/* Clicking empty space schedules a post on this day (when enabled) */}
              <div
                role={onDayClick ? 'button' : undefined}
                tabIndex={onDayClick ? 0 : undefined}
                className={cn('flex-1 p-1.5 space-y-1.5 text-left', onDayClick && 'cursor-pointer')}
                onClick={onDayClick ? () => onDayClick(day) : undefined}
                onKeyDown={onDayClick ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onDayClick(day);
                  }
                } : undefined}
                aria-label={onDayClick ? `Add post on ${format(day, 'PPP')}` : undefined}
              >
                {loading ? (
                  <div className="h-10 rounded-md bg-muted animate-pulse" />
                ) : (
                  dayPosts.map((post) => (
                    <div key={`${post.accountId}-${post.id}`} onClick={(e) => e.stopPropagation()}>
                      <PostCard post={post} onClick={() => onPostClick(post)} renderBody={renderCardBody} />
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Helper for the parent page: the [start, end] range to query for a week. */
export function weekRange(anchor: Date): { start: Date; end: Date } {
  const start = startOfWeek(anchor, WEEK_OPTS);
  return { start, end: endOfWeek(anchor, WEEK_OPTS) };
}

export function sameWeek(a: Date, b: Date): boolean {
  return isSameDay(startOfWeek(a, WEEK_OPTS), startOfWeek(b, WEEK_OPTS));
}

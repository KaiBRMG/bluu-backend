'use client';

import { BadgeCheck, Loader2, MapPin, PanelRightClose } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { cn } from '@/lib/utils';
import type { OFChatRow } from '@/hooks/useOnlyFansChats';
import { useOnlyFansFanNotes } from '@/hooks/useOnlyFansFanNotes';
import { formatDate, formatMoney, splitMoney } from '../_lib/format';

/**
 * The fan context panel — who the operator is actually talking to.
 *
 * **It costs nothing to open.** Everything here except the notes section is read
 * off the Firestore chat mirror, and it is there because the provider embeds a
 * full profile object in the chat-list payload the sync already pays for. The
 * obvious alternative — calling `/users/{username}` when a thread opens — would
 * bill once per chat switch, which on this surface is a call every few seconds.
 * Notes are the one exception and are behind an explicit click.
 *
 * **It never states a number it guessed.** Every field is optional on the
 * provider's side and none of them is documented as guaranteed, so a section
 * with no data says so rather than rendering a confident `$0` next to a fan who
 * has spent thousands. That asymmetry is deliberate: on this surface a wrong
 * number about money is far more expensive than a missing one.
 *
 * Read-only, per the roadmap. Editing a fan's note or custom name is a
 * real-world write to a creator's account and belongs behind Phase 9's audit
 * log.
 */

interface FanPanelProps {
  accountId: string | null;
  chat: OFChatRow;
  timeZone?: string;
  onClose: () => void;
}

export default function FanPanel({ accountId, chat, timeZone, onClose }: FanPanelProps) {
  const profile = chat.profile ?? null;
  const spend = profile?.spend ?? null;
  const subscription = profile?.subscription ?? null;

  const notes = useOnlyFansFanNotes(accountId, chat.id);

  // The mirror's own `spentTotal` is the same figure the list chip shows, so the
  // panel agrees with the row it was opened from even on a chat mirrored before
  // profiles were.
  const total = spend?.total || chat.spentTotal;

  return (
    <aside
      aria-label={`About ${chat.fan.name}`}
      className="flex h-full w-[300px] shrink-0 flex-col border-l border-white/[0.07] bg-sidebar"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <h2 className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-zinc-400">
          About
        </h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Hide fan details"
          className="size-7 text-zinc-400 hover:text-zinc-200"
        >
          <PanelRightClose className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
        {/* Identity */}
        <div className="flex flex-col items-center text-center">
          <Avatar className="size-16">
            {chat.fan.avatar && <AvatarImage src={chat.fan.avatar} alt="" />}
            <AvatarFallback
              style={{ backgroundColor: getAvatarColor(chat.fan.name) }}
              className="text-sm text-white"
            >
              {getInitials(chat.fan.name)}
            </AvatarFallback>
          </Avatar>

          <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <span className="min-w-0 truncate">{chat.fan.name}</span>
            {profile?.isVerified && (
              // Blue is the one voice and it means "act here", so a verified
              // mark takes the neutral ink instead — it is a fact, not a state
              // and not an action.
              <BadgeCheck className="size-3.5 shrink-0 text-zinc-400" aria-label="Verified" />
            )}
          </p>
          <p className="truncate font-mono text-xs text-zinc-400">@{chat.fan.username}</p>

          {profile?.location && (
            <p className="mt-1 flex items-center gap-1 text-xs text-zinc-400">
              <MapPin className="size-3" aria-hidden />
              {profile.location}
            </p>
          )}
          {profile?.joinDate && (
            <p className="mt-0.5 text-xs text-zinc-400">
              Joined {formatDate(profile.joinDate, timeZone)}
            </p>
          )}
        </div>

        {profile?.about && (
          <Section title="Bio">
            <p className="whitespace-pre-wrap break-words text-sm text-zinc-400">{profile.about}</p>
          </Section>
        )}

        {/* Spend. The total is set at display size because it is the one number
            an operator opens this panel for; the split hangs under it as rows. */}
        <Section title="Spend">
          {total > 0 || spend ? (
            <>
              <p className="flex items-baseline gap-x-1 text-green-400">
                <span className="text-[0.9375rem] font-medium opacity-70">
                  {splitMoney(total).symbol}
                </span>
                <span className="text-2xl font-semibold leading-none tracking-tight tabular-nums">
                  {splitMoney(total).digits}
                </span>
                <span className="text-xs font-medium text-zinc-400">lifetime</span>
              </p>

              {spend && (
                <dl className="mt-2.5 space-y-1">
                  <Stat label="Tips" value={spend.tips} />
                  <Stat label="Messages" value={spend.messages} />
                  <Stat label="Posts" value={spend.posts} />
                  <Stat label="Streams" value={spend.streams} />
                  <Stat label="Subscriptions" value={spend.subscriptions} />
                </dl>
              )}
            </>
          ) : (
            <Empty>No spend recorded.</Empty>
          )}
        </Section>

        {/* Subscription */}
        <Section title="Subscription">
          {subscription ? (
            <dl className="space-y-1">
              <Row
                label="Status"
                value={
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-medium',
                      subscription.isActive
                        ? 'bg-green-500/10 text-green-400'
                        : 'bg-white/[0.04] text-zinc-400',
                    )}
                  >
                    {subscription.status ?? (subscription.isActive ? 'Active' : 'Expired')}
                  </span>
                }
              />
              {profile && profile.subscribePrice > 0 && (
                <Row label="Price" value={`${formatMoney(profile.subscribePrice)}/mo`} />
              )}
              {subscription.duration && <Row label="Duration" value={subscription.duration} />}
              {subscription.subscribedAt && (
                <Row label="Since" value={formatDate(subscription.subscribedAt, timeZone)} />
              )}
              {subscription.renewedAt && (
                <Row label="Renewed" value={formatDate(subscription.renewedAt, timeZone)} />
              )}
              {subscription.expiresAt && (
                <Row
                  label={subscription.isActive ? 'Expires' : 'Expired'}
                  value={formatDate(subscription.expiresAt, timeZone)}
                />
              )}
            </dl>
          ) : (
            <Empty>Not subscribed, or the page is free.</Empty>
          )}
        </Section>

        {/* Notes — the one billed section, hence the explicit load. */}
        <Section title="Notes">
          {notes.notes !== null ? (
            notes.notes ? (
              <p className="whitespace-pre-wrap break-words text-sm text-zinc-400">{notes.notes}</p>
            ) : (
              <Empty>No notes on this fan.</Empty>
            )
          ) : notes.error ? (
            <div className="space-y-1.5">
              <p className="text-sm text-zinc-400">{notes.error}</p>
              <button
                type="button"
                onClick={notes.load}
                className="text-xs text-zinc-400 underline underline-offset-2 transition-colors hover:text-white"
              >
                Try again
              </button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={notes.load}
              disabled={notes.loading}
              className="h-7 gap-1.5 px-2 text-xs text-zinc-400 hover:text-white"
            >
              {notes.loading && <Loader2 className="size-3 animate-spin" />}
              Load notes
            </Button>
          )}
        </Section>

        {!profile && (
          // A row mirrored before profiles existed, or one a webhook created for
          // a fan the sync has never reached. Say which, and what fixes it.
          <p className="text-xs text-zinc-400">
            Profile details arrive with the next inbox refresh.
          </p>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-zinc-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The single quiet line DESIGN.md prescribes for an empty state. */
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-zinc-400">{children}</p>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="shrink-0 text-xs text-zinc-400">{label}</dt>
      <dd className="min-w-0 truncate text-right text-xs text-foreground">{value}</dd>
    </div>
  );
}

/** A money row. Zeroes stay visible — an empty column would read as missing data. */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-zinc-400">{label}</dt>
      <dd className="text-xs tabular-nums text-foreground">{formatMoney(value)}</dd>
    </div>
  );
}

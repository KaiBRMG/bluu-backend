'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { IconBrandTelegram } from '@tabler/icons-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import type { AdminFullUser, AdminGroup } from '@/hooks/useAdminUsers';
import {
  invitedStageLabel,
  stageDotClass,
  stagePillClass,
  STAGE_HINT,
  STAGE_LABEL,
  userStage,
  type UserStage,
} from './userStatus';

/**
 * The employee index — a browse-and-open collection, built to the shape
 * DESIGN.md §5 documents for exactly that job ("The faceted index").
 *
 * It replaces a `grid md:grid-cols-2 xl:grid-cols-3` of identically-shaped
 * cards. A card grid cannot answer the questions this page exists to answer —
 * who hasn't onboarded, who is unassigned, who has no Telegram — because
 * nothing aligns into a column and every card reflows depending on which
 * fields a given person happens to have. Two-line rows align, scan, and sort.
 */

const ACTION_BLUE = '#3b82f6';

/** Sections are the derived stage vocabulary, in the order they matter. */
const SECTION_ORDER: UserStage[] = ['invited', 'active', 'no-access', 'archived'];

export interface IndexSection {
  stage: UserStage;
  users: AdminFullUser[];
}

function MetaDot() {
  return (
    <span aria-hidden className="px-1.5 text-zinc-500">
      ·
    </span>
  );
}

function SectionHeading({
  label,
  count,
  first,
}: {
  label: string;
  count: number;
  first: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-3 px-2.5 pb-1', first ? 'pt-0' : 'pt-6')}>
      <span className="font-mono text-xs font-semibold uppercase text-zinc-400">{label}</span>
      <span className="h-px flex-1 bg-white/[0.07]" aria-hidden />
      <span className="text-[11px] tabular-nums text-zinc-400">{count}</span>
    </div>
  );
}

function fullNameOf(user: AdminFullUser): string {
  return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.displayName;
}

/** `today` / `yesterday` / `3d ago` / `4mo ago` / `2y ago`, or null if unusable. */
function formatAge(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const then = new Date(raw).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * The row's recency meta — and the two facts it can be are NOT interchangeable,
 * so the label says which one it is.
 *
 * This used to read "seen 4mo ago" off `lastLoginAt`, which is written once, at
 * sign-in. Nobody quits the Electron shell (rule 9c), so that was reporting how
 * long ago someone last *signed in* — months, routinely — as though it were how
 * long ago they were last here. It made a fleet of daily users look abandoned.
 *
 * `lastActiveAt` is the real answer (see `PresenceReporter`), but it is absent
 * for anyone who has not opened the app since presence reporting shipped. So
 * the fallback is the sign-in date, relabelled honestly rather than dressed up
 * as a sighting.
 */
function recencyMeta(user: AdminFullUser): { label: string; title: string } | null {
  const seen = formatAge(user.lastActiveAt);
  if (seen) {
    return { label: `seen ${seen}`, title: 'Last time this user had the app open.' };
  }
  const signedIn = formatAge(user.lastLoginAt);
  if (signedIn) {
    return {
      label: `signed in ${signedIn}`,
      title:
        'Last sign-in. This user has not had the app open since presence reporting shipped, so there is no "last seen" for them yet.',
    };
  }
  return null;
}

/**
 * The installed desktop build, on the meta line as a code (DESIGN.md §2 — an
 * identifier there takes `font-mono`). It is written by `AppVersionReporter`
 * once per app start, so it is absent for anyone who has not opened the app
 * since that shipped and for anyone who has never signed in — and "absent" is
 * shown rather than skipped, because "which build is this person on?" is a
 * question whose blank answer is itself the finding when chasing an update.
 * Anyone still unprompted for onboarding has no build at all, so the invited
 * section says nothing.
 */
function versionMeta(user: AdminFullUser): { label: string; title: string } | null {
  const platform =
    user.appPlatform === 'darwin' ? 'macOS' : user.appPlatform === 'win32' ? 'Windows' : null;
  if (!user.appVersion) {
    return {
      label: 'v—',
      title:
        'No app version reported. This user has not opened the desktop app since version reporting shipped.',
    };
  }
  return {
    label: `v${user.appVersion}`,
    title: platform
      ? `Installed desktop build on ${platform}.`
      : 'Installed desktop build.',
  };
}

function EmployeeRow({
  user,
  groups,
  selected,
  selectionActive,
  onToggleSelect,
  onOpen,
}: {
  user: AdminFullUser;
  groups: AdminGroup[];
  selected: boolean;
  selectionActive: boolean;
  onToggleSelect: (uid: string) => void;
  onOpen: (uid: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const fullName = fullNameOf(user);
  const stage = userStage(user);
  // The Avatar Seed Rule (DESIGN.md §5): one identity hashes to one colour
  // everywhere, so every surface seeds from `displayName` and nothing else.
  const seed = user.displayName || 'User';
  const userGroups = (user.groups || [])
    .map((id) => groups.find((g) => g.id === id))
    .filter(Boolean) as AdminGroup[];
  const telegramLinked = !!user.telegram?.userId;
  const recency = recencyMeta(user);
  const version = stage === 'invited' ? null : versionMeta(user);

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(user.workEmail);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error('Could not copy the email address');
    }
  };

  return (
    <li
      className={cn(
        'group relative rounded-lg transition-colors',
        'hover:bg-white/[0.055] focus-within:bg-white/[0.055]',
        selected && 'bg-white/[0.055]',
      )}
    >
      {/* Selection and opening are two different intents, so they are two
          targets — the leading slot selects, the row opens. At rest the slot
          is the avatar; it becomes a checkbox on hover, on focus, or once a
          selection is under way, so the resting list stays a list of people
          rather than a list of controls. */}
      <div className="absolute left-2.5 top-1/2 z-10 -translate-y-1/2">
        <span
          className={cn(
            'block transition-opacity',
            selectionActive || selected
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100',
          )}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelect(user.uid)}
            aria-label={`Select ${fullName}`}
            className="size-4"
          />
        </span>
      </div>

      <button
        type="button"
        onClick={() => onOpen(user.uid)}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg py-2 pr-2.5 text-left',
          'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
          // Leaves room for the selection slot without moving when it appears.
          'pl-11',
        )}
        style={{ ['--tw-ring-color' as string]: ACTION_BLUE }}
      >
        <span
          className={cn(
            'transition-opacity',
            selectionActive || selected
              ? 'opacity-0'
              : 'opacity-100 group-hover:opacity-0 group-focus-within:opacity-0',
            'pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2',
          )}
        >
          <Avatar className="size-7" style={{ background: getAvatarColor(seed) }}>
            {user.photoURL && <AvatarImage src={user.photoURL} alt="" />}
            <AvatarFallback style={{ background: getAvatarColor(seed), color: '#fff' }}>
              {getInitials(seed)}
            </AvatarFallback>
          </Avatar>
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-white">{fullName}</span>

            {/* A dot rather than a pill on the row: the section heading already
                names the stage, so the row only needs to carry it, not shout it. */}
            <span
              className={cn('size-1.5 shrink-0 rounded-full', stageDotClass(stage))}
              aria-hidden
            />
            <span className="sr-only">{STAGE_LABEL[stage]}</span>

            {!telegramLinked && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0 text-orange-400">
                    <IconBrandTelegram size={13} stroke={2} aria-hidden />
                    <span className="sr-only">Telegram not linked</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  Telegram not linked — alerts will not reach them
                </TooltipContent>
              </Tooltip>
            )}

            {userGroups.map((group) => (
              <span
                key={group.id}
                className="hidden shrink-0 rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300 sm:inline"
              >
                {group.name}
              </span>
            ))}
            {userGroups.length === 0 && (
              <span className="hidden shrink-0 text-[11px] font-medium text-zinc-400 sm:inline">
                Unassigned
              </span>
            )}
          </span>

          <span className="mt-0.5 flex min-w-0 items-center text-[11px] text-zinc-400">
            <span className="truncate">{user.workEmail}</span>
            {user.jobTitle && (
              <>
                <MetaDot />
                <span className="truncate">{user.jobTitle}</span>
              </>
            )}
            {stage === 'invited' ? (
              <>
                <MetaDot />
                {/* The badge says "not set up"; this says how far they got,
                    which is what decides whether to chase the person or check
                    the email for a typo. */}
                <span className="shrink-0 text-orange-400">{invitedStageLabel(user)}</span>
              </>
            ) : (
              recency && (
                <>
                  <MetaDot />
                  <span className="shrink-0 tabular-nums" title={recency.title}>
                    {recency.label}
                  </span>
                </>
              )
            )}
            {version && (
              <>
                <MetaDot />
                <span
                  className="shrink-0 font-mono tabular-nums"
                  title={version.title}
                >
                  {version.label}
                </span>
              </>
            )}
          </span>
        </span>

        {/* At rest the lane carries the stage pill; on hover and on focus it
            crossfades to the row's one quick action. The lane holds a fixed
            min-width so nothing shifts and no long value runs underneath it. */}
        <span
          className={cn(
            'ml-auto hidden min-w-[6.5rem] shrink-0 items-center justify-end transition-opacity sm:flex',
            'group-hover:opacity-0 group-focus-within:opacity-0',
          )}
        >
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-medium',
              stagePillClass(stage),
            )}
            title={STAGE_HINT[stage]}
          >
            {STAGE_LABEL[stage]}
          </span>
        </span>
      </button>

      <div
        className={cn(
          'absolute right-1.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 sm:flex',
          // Revealed on hover *and* focus-within — the latter is what keeps it
          // reachable from the keyboard (DESIGN.md § Interaction).
          'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-zinc-400 hover:text-white"
              onClick={copyEmail}
              aria-label={`Copy ${fullName}'s login email`}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{copied ? 'Copied' : 'Copy login email'}</TooltipContent>
        </Tooltip>
      </div>
    </li>
  );
}

export function EmployeeIndex({
  sections,
  groups,
  selectedUids,
  onToggleSelect,
  onOpen,
  total,
}: {
  sections: IndexSection[];
  groups: AdminGroup[];
  selectedUids: string[];
  onToggleSelect: (uid: string) => void;
  onOpen: (uid: string) => void;
  total: number;
}) {
  const ordered = SECTION_ORDER.map((stage) => sections.find((s) => s.stage === stage)).filter(
    (s): s is IndexSection => !!s && s.users.length > 0,
  );
  const selectionActive = selectedUids.length > 0;

  return (
    <div>
      {/* The count announces, so a filter change tells a screen-reader user
          what actually happened rather than silently reshuffling the list. */}
      <p aria-live="polite" className="mb-3 px-2.5 text-xs tabular-nums text-zinc-400">
        {total} {total === 1 ? 'person' : 'people'}
      </p>

      {ordered.map((section, i) => (
        <section key={section.stage}>
          <SectionHeading
            label={STAGE_LABEL[section.stage]}
            count={section.users.length}
            first={i === 0}
          />
          <ul>
            {section.users.map((user) => (
              <EmployeeRow
                key={user.uid}
                user={user}
                groups={groups}
                selected={selectedUids.includes(user.uid)}
                selectionActive={selectionActive}
                onToggleSelect={onToggleSelect}
                onOpen={onOpen}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

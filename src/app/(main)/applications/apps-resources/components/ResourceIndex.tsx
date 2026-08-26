'use client';

import { useMemo, useState } from 'react';
import {
  EyeOff, FileText, Globe, Link as LinkIcon, MoreHorizontal, Pin,
} from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { isUnlisted } from '@/lib/resourceAccess';
import type { ResourceDocument } from '@/types/resource';

/**
 * The resources index.
 *
 * This replaces the seven-column table, and the change is one of kind rather
 * than styling. Resources is a **link directory** — the task is "find the one I
 * need and open it", not "audit a database" — so the surface is built as an
 * index, the way a reference shelf is:
 *
 *  - **Pinned first, then A–Z.** Sorting by Last Edited put a date nobody was
 *    looking for in charge of the order. Alphabetical with letter rails means a
 *    known name can be found by position instead of by reading every row, and it
 *    gives the pin somewhere to *go*: pinning promotes a row into a section at
 *    the top rather than lighting up a star in a column.
 *  - **One row, one target.** The old table linked the name *and* the URL cell,
 *    two hit areas for one destination. The whole row is the link now.
 *  - **The host, not the URL.** A 40-character truncation of a Google Docs link
 *    is noise; `docs.google.com` is the fact a reader actually wants from that
 *    column — where this is going to take me.
 *  - **Actions on hover and on focus.** Pin / copy / manage sit on the row's
 *    right edge, revealed on `:hover` and `:focus-within` (the latter is not
 *    optional — without it they are keyboard-unreachable), so three permanent
 *    icon columns of chrome come back as space for content. A pinned row keeps
 *    its pin visible, because that one is state, not an affordance.
 *
 * Colour: none of it is decorative. Types are greyscale chips, the pin is the
 * single Action Blue voice for "selected", and Unlisted keeps the muted-text +
 * `EyeOff` treatment it had (DESIGN §2).
 */

/** Action Blue / Action Blue Deep, inked in-component — shadcn's `--primary`
 *  resolves to near-white in this theme (DESIGN §2). */
const ACTION_BLUE = '#3b82f6';

/** Rows whose name starts with anything non-alphabetic collect under this. */
const OTHER_LETTER = '#';

function initialLetter(name: string): string {
  const ch = (name.trim()[0] ?? '').toUpperCase();
  return ch >= 'A' && ch <= 'Z' ? ch : OTHER_LETTER;
}

/** The host is the useful half of a link; the path is noise in a list. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Link copied');
  } catch {
    toast.error('Could not copy link');
  }
}

/**
 * The leading glyph. An emoji renders as itself; a migrated image icon goes
 * through `Avatar` (never a raw `<img>` — cross-cutting rule 7). With no icon at
 * all the slot still earns its width by carrying the *kind* of the row: a globe
 * for an external link, a page mark for a reference.
 */
function ResourceGlyph({
  icon,
  name,
  isLink,
}: {
  icon: ResourceDocument['icon'];
  name: string;
  isLink: boolean;
}) {
  if (icon?.type === 'emoji') {
    return <span className="text-base leading-none">{icon.value}</span>;
  }
  if (icon?.type === 'url') {
    return (
      <Avatar className="size-5 rounded-[4px]">
        <AvatarImage src={icon.value} alt="" className="object-cover" />
        <AvatarFallback className="rounded-[4px] bg-white/[0.08] text-[10px] text-zinc-300">
          {(name.trim()[0] ?? '?').toUpperCase()}
        </AvatarFallback>
      </Avatar>
    );
  }
  const Icon = isLink ? Globe : FileText;
  return <Icon className="size-4 text-zinc-500" aria-hidden />;
}

function MetaDot() {
  return (
    <span aria-hidden className="text-zinc-500">
      ·
    </span>
  );
}

function ResourceRow({
  resource,
  groupLabel,
  canManage,
  editable,
  pinned,
  showPinMark,
  onTogglePin,
  onEdit,
  onRequestDelete,
}: {
  resource: ResourceDocument;
  groupLabel: (id: string) => string;
  canManage: boolean;
  editable: boolean;
  pinned: boolean;
  /** True only when the Pinned section is not carrying that state (i.e. searching). */
  showPinMark: boolean;
  onTogglePin: (id: string) => void;
  onEdit: (resource: ResourceDocument) => void;
  onRequestDelete: (resource: ResourceDocument) => void;
}) {
  const url = resource.url ?? resource.notionPageUrl;
  const host = url ? hostOf(url) : null;
  const unlisted = isUnlisted(resource);
  const name = resource.name || 'Untitled';
  const date = formatDate(resource.lastEditedTime);

  const body = (
    <>
      <span className="flex size-5 shrink-0 items-center justify-center">
        <ResourceGlyph icon={resource.icon} name={name} isLink={!!resource.url} />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'truncate font-medium',
              unlisted ? 'text-zinc-400' : 'text-white',
            )}
          >
            {name}
          </span>
          {/* While a search is running the Pinned section is suppressed, so the
              pin needs to say so on the row itself. Grouped, the section says it. */}
          {showPinMark && pinned && (
            <Pin
              className="size-3 shrink-0"
              style={{ fill: ACTION_BLUE, color: ACTION_BLUE }}
              aria-label="Pinned"
            />
          )}
          {unlisted && (
            <EyeOff
              className="size-3.5 shrink-0 text-zinc-400"
              aria-label="Unlisted — hidden from everyone who cannot manage it"
            />
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-400">
          {host ? (
            <span className="truncate font-mono">{host}</span>
          ) : (
            <span className="truncate">No link</span>
          )}
          {resource.groups.length > 0 && (
            <>
              <MetaDot />
              <span className="truncate">
                {resource.groups.map(groupLabel).join(', ')}
              </span>
            </>
          )}
          {date && (
            <>
              <MetaDot />
              <span className="shrink-0 tabular-nums">{date}</span>
            </>
          )}
        </span>
      </span>

      {/* The type chips and the action cluster share the row's right edge and
          crossfade: chips at rest, actions on hover / focus. Neither moves, and
          the lane is never dead space. `min-w` holds exactly the cluster's width
          so a long name on a chip-less row can't run underneath it. */}
      <span
        className={cn(
          'ml-auto hidden shrink-0 items-center justify-end gap-1 transition-opacity sm:flex',
          'group-hover:opacity-0 group-focus-within:opacity-0',
          canManage ? 'min-w-[5.75rem]' : 'min-w-[4.25rem]',
        )}
      >
        {resource.types.map(t => (
          <span
            key={t}
            className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300"
          >
            {t}
          </span>
        ))}
      </span>
    </>
  );

  const rowClass = cn(
    'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left',
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
  );
  const ringStyle = { ['--tw-ring-color' as string]: ACTION_BLUE };

  // Hover → active follows the overlay vocabulary (DESIGN §4) rather than
  // `brightness-110`, which does nothing to a transparent row.
  return (
    <li className="group relative rounded-lg transition-colors hover:bg-white/[0.055] focus-within:bg-white/[0.055] active:bg-white/[0.08]">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={url}
          className={rowClass}
          style={ringStyle}
        >
          {body}
        </a>
      ) : (
        <div className={cn(rowClass, 'cursor-default')}>{body}</div>
      )}

      <div
        className={cn(
          'absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5',
          // Revealed on hover *and* focus-within; the latter is what keeps these
          // reachable from the keyboard.
          'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-zinc-400 hover:text-white"
              onClick={() => onTogglePin(resource.id)}
              aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
              aria-pressed={pinned}
            >
              <Pin
                className="size-3.5"
                style={pinned ? { fill: ACTION_BLUE, color: ACTION_BLUE } : undefined}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{pinned ? 'Unpin' : 'Pin to home'}</TooltipContent>
        </Tooltip>

        {url && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-zinc-400 hover:text-white"
                onClick={() => copyUrl(url)}
                aria-label={`Copy link to ${name}`}
              >
                <LinkIcon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Copy link</TooltipContent>
          </Tooltip>
        )}

        {/* Rendered as a spacer rather than omitted for a row outside this
            manager's write scope, so the action lane stays a single column. */}
        {canManage && (
          editable ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-zinc-400 hover:text-white"
                >
                  <MoreHorizontal className="size-3.5" />
                  <span className="sr-only">Options for {name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onEdit(resource)}>Edit</DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onRequestDelete(resource)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="size-7" aria-hidden />
          )
        )}
      </div>
    </li>
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
    <div className={cn('flex items-center gap-3 px-2.5 pb-1', first ? 'pt-0' : 'pt-5')}>
      <span className="font-mono text-xs font-semibold uppercase text-zinc-400">
        {label}
      </span>
      <span className="h-px flex-1 bg-white/[0.07]" aria-hidden />
      <span className="text-[11px] tabular-nums text-zinc-400">{count}</span>
    </div>
  );
}

interface IndexSection {
  key: string;
  label: string;
  items: ResourceDocument[];
}

export function ResourceIndex({
  resources,
  grouped,
  groupLabel,
  canManage,
  canEdit,
  isPinned,
  onTogglePin,
  onEdit,
  onDelete,
}: {
  /** Already filtered, sorted (pinned first, then A–Z) and windowed. */
  resources: ResourceDocument[];
  /** False while a search is running — letter rails over three hits are noise. */
  grouped: boolean;
  groupLabel: (id: string) => string;
  canManage: boolean;
  canEdit: (resource: ResourceDocument) => boolean;
  isPinned: (id: string) => boolean;
  onTogglePin: (id: string) => void;
  onEdit: (resource: ResourceDocument) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [pendingDelete, setPendingDelete] = useState<ResourceDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sections: IndexSection[] = useMemo(() => {
    if (!grouped) return [{ key: '_all', label: '', items: resources }];
    const out: IndexSection[] = [];
    for (const r of resources) {
      const key = isPinned(r.id) ? '_pinned' : initialLetter(r.name || 'Untitled');
      const label = key === '_pinned' ? 'Pinned' : key;
      const last = out[out.length - 1];
      if (last?.key === key) last.items.push(r);
      else out.push({ key, label, items: [r] });
    }
    return out;
  }, [resources, grouped, isPinned]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await onDelete(pendingDelete.id);
      toast.success('Resource deleted');
      setPendingDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete resource');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="flex flex-col">
        {sections.map((section, i) => (
          <section key={section.key} aria-label={section.label || 'Results'}>
            {section.label && (
              <SectionHeading
                label={section.label}
                count={section.items.length}
                first={i === 0}
              />
            )}
            <ul className="flex flex-col">
              {section.items.map(r => (
                <ResourceRow
                  key={r.id}
                  resource={r}
                  groupLabel={groupLabel}
                  canManage={canManage}
                  editable={canEdit(r)}
                  pinned={isPinned(r.id)}
                  showPinMark={!grouped}
                  onTogglePin={onTogglePin}
                  onEdit={onEdit}
                  onRequestDelete={setPendingDelete}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={o => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete resource?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes <span className="font-medium">{pendingDelete?.name}</span> from
              the resources collection. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => { e.preventDefault(); confirmDelete(); }}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { Check, FileQuestion, Image as ImageIcon, Loader2, Music, Play, Search, ShieldAlert, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useInViewport, useResolvedMedia } from '@/hooks/useOnlyFansMedia';
import type { OFAttachmentRow } from '@/hooks/useOnlyFansMessages';
import { useOnlyFansVault, type VaultFilters, type VaultType } from '@/hooks/useOnlyFansVault';
import type { DraftMedia } from '../_lib/drafts';

/**
 * The vault picker.
 *
 * **A dialog, not a satellite window.** The decision was taken in the roadmap and
 * is worth keeping: a second Electron window would need a native build (rule 14)
 * and cross-window selection plumbing, to solve a problem — "pick a file and come
 * back" — that a modal solves natively. It is sized as a card rather than
 * full-screen because it is a step inside composing a message, not a destination.
 *
 * **Every page of this grid is billed twice over:** once to list the media, and
 * again to resolve each tile's preview URL. So listing is paged explicitly
 * (never infinite-scrolled), pages are cached client- and server-side, and each
 * tile resolves only when it reaches the viewport.
 */

interface VaultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string | null;
  /** Ids already staged in the composer — shown as picked, and not re-addable. */
  stagedIds: string[];
  /** How many more attachments this message can take. */
  remaining: number;
  onAdd: (media: DraftMedia[]) => void;
}

const TYPE_FILTERS: { value: VaultType | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'photo', label: 'Photos' },
  { value: 'video', label: 'Videos' },
  { value: 'gif', label: 'GIFs' },
  { value: 'audio', label: 'Audio' },
];

export default function VaultDialog({
  open,
  onOpenChange,
  accountId,
  stagedIds,
  remaining,
  onAdd,
}: VaultDialogProps) {
  const [listId, setListId] = useState<string | null>(null);
  const [type, setType] = useState<VaultType | null>(null);
  const [search, setSearch] = useState('');
  // Committed on submit rather than per keystroke: each query is a billed
  // listing, so search-as-you-type would bill once per character.
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Map<string, OFAttachmentRow>>(new Map());

  const filters: VaultFilters = useMemo(() => ({ listId, type, query }), [listId, type, query]);
  const { lists, media, loading, loadingMore, error, hasMore, loadMore } = useOnlyFansVault(
    accountId,
    filters,
    open,
  );

  const staged = new Set(stagedIds);
  const full = picked.size >= remaining;

  const toggle = (item: OFAttachmentRow) => {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else if (next.size < remaining) next.set(item.id, item);
      return next;
    });
  };

  const close = (nextOpen: boolean) => {
    if (!nextOpen) setPicked(new Map());
    onOpenChange(nextOpen);
  };

  const add = () => {
    onAdd(
      [...picked.values()].map((item) => ({
        id: item.id,
        kind: 'vault' as const,
        label: item.type === 'other' ? 'Attachment' : item.type,
        type: item.type,
        // The vault's own preview link, resolved by the composer's chip exactly
        // as a thread tile resolves one. Expiring, so it is never persisted for
        // longer than the draft it belongs to.
        previewUrl: item.urls.preview ?? item.urls.thumb,
        width: item.width,
        height: item.height,
      })),
    );
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 border-white/[0.07] bg-[#171717] sm:max-w-2xl">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-lg">Vault</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Attach media the creator has already uploaded to OnlyFans.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
          }}
          className="relative shrink-0"
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the vault…"
            aria-label="Search the vault"
            className="h-9 border-zinc-700 bg-zinc-800 pl-8 text-sm placeholder-zinc-400 focus:border-zinc-500"
          />
        </form>

        <div className="shrink-0 space-y-2">
          <FilterRow label="Type">
            {TYPE_FILTERS.map((filter) => (
              <FilterChip
                key={filter.label}
                active={type === filter.value}
                onClick={() => setType(filter.value)}
              >
                {filter.label}
              </FilterChip>
            ))}
          </FilterRow>

          {lists.length > 0 && (
            <FilterRow label="Category">
              <FilterChip active={listId === null} onClick={() => setListId(null)}>
                All
              </FilterChip>
              {lists.map((list) => (
                <FilterChip
                  key={list.id}
                  active={listId === list.id}
                  onClick={() => setListId(list.id)}
                >
                  {list.name}
                </FilterChip>
              ))}
            </FilterRow>
          )}
        </div>

        {/* `overscroll-contain` for the same reason the chat panes have it: a
            wheel event that runs out of grid must not chain to the window. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {loading ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-lg" />
              ))}
            </div>
          ) : error ? (
            <p className="py-10 text-center text-sm text-zinc-400">{error}</p>
          ) : media.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-400">
              {query || type || listId ? 'Nothing matches those filters.' : 'The vault is empty.'}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {media.map((item) => (
                  <VaultTile
                    key={item.id}
                    item={item}
                    picked={picked.has(item.id)}
                    staged={staged.has(item.id)}
                    disabled={full && !picked.has(item.id)}
                    onToggle={() => toggle(item)}
                  />
                ))}
              </div>

              {hasMore && (
                <div className="flex justify-center pt-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="gap-1.5 text-zinc-400 hover:text-white"
                  >
                    {loadingMore && <Loader2 className="size-3.5 animate-spin" />}
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 items-center gap-2 sm:justify-between">
          <p className="text-xs text-zinc-400">
            {picked.size > 0
              ? `${picked.size} selected`
              : `Up to ${remaining} more attachment${remaining === 1 ? '' : 's'}`}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => close(false)} className="text-zinc-400 hover:text-white">
              Cancel
            </Button>
            <Button
              onClick={add}
              disabled={picked.size === 0}
              // Action Blue Deep — filled blue always inks at #2563eb (§2).
              className="bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
            >
              Attach
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-zinc-400">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full px-2.5 py-1 text-xs transition-colors',
        active
          ? 'bg-[#2563eb] text-white'
          : 'bg-white/[0.04] text-zinc-400 hover:bg-white/[0.055] hover:text-white',
      )}
    >
      {children}
    </button>
  );
}

/**
 * One vault item.
 *
 * Same lazy-resolve contract as a thread tile: nothing is requested until the
 * tile is near the viewport, and the *preview* variant is what gets asked for —
 * the full file is never needed to choose something to send.
 */
function VaultTile({
  item,
  picked,
  staged,
  disabled,
  onToggle,
}: {
  item: OFAttachmentRow;
  picked: boolean;
  staged: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const { ref, inView } = useInViewport<HTMLDivElement>();
  const previewUrl = item.urls.preview ?? item.urls.thumb;
  const { url, onLoadError } = useResolvedMedia(previewUrl, inView);

  const label = item.type === 'other' ? 'attachment' : item.type;

  return (
    <div ref={ref} className="relative aspect-square">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled && !picked}
        aria-pressed={picked}
        aria-label={`${picked ? 'Deselect' : 'Select'} ${label}`}
        className={cn(
          'group size-full overflow-hidden rounded-lg border bg-white/[0.04] transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]',
          picked ? 'border-[#3b82f6] bg-[#3b82f6]/15' : 'border-white/[0.07] hover:bg-white/[0.055]',
          disabled && !picked && 'cursor-not-allowed opacity-40',
        )}
      >
        {url ? (
          // A short-lived signed provider URL cannot go through next/image or
          // Avatar: it is not a configured remote host and the link is dead long
          // before an optimizer cache entry would pay for itself.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            onError={onLoadError}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="size-full object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-zinc-400">
            <TypeIcon type={item.type} />
          </span>
        )}
      </button>

      {/* Overlays are pointer-events-none so the whole tile stays one target. */}
      {picked && (
        <span className="pointer-events-none absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-[#2563eb]">
          <Check className="size-3 text-white" />
        </span>
      )}
      {!picked && staged && (
        <span className="pointer-events-none absolute right-1 top-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[11px] text-zinc-400">
          Attached
        </span>
      )}
      {item.isDrm && (
        <span className="pointer-events-none absolute left-1 top-1 flex items-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[11px] text-zinc-400">
          <ShieldAlert className="size-3" />
          DRM
        </span>
      )}
      {(item.type === 'video' || item.type === 'audio') && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex size-7 items-center justify-center rounded-full bg-black/55">
            <Play className="size-3 fill-white text-white" />
          </span>
        </span>
      )}
    </div>
  );
}

function TypeIcon({ type }: { type: string }) {
  if (type === 'video') return <Video className="size-5" />;
  if (type === 'audio') return <Music className="size-5" />;
  if (type === 'photo' || type === 'gif') return <ImageIcon className="size-5" />;
  return <FileQuestion className="size-5" />;
}

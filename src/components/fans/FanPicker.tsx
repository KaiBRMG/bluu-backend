'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatUsd, pluralise } from '@/lib/salary/salaryFormat';
import { FAN_NAME_MAX, FAN_NAME_SOURCE_LABEL, cleanFanName, fanKeyOf, parseProfileLink } from '@/lib/fans/fanIdentity';
import type { FanLookupHit } from '@/lib/buddyx/analyticsTypes';

/**
 * The fan step of every "new custom / campaign" wizard. The fan base comes
 * first: search it by name, OnlyFans id, handle or a pasted link, and pick the
 * fan. Only when they are not there does the wizard ask for a profile link.
 *
 * **A new custom never leaves a fan nameless.** A fan with a name prefills the
 * name field; a fan without one leaves it empty, and the wizard cannot
 * continue until a name is typed (`isFanPickComplete`) — that name is what the
 * fan base will call them from then on.
 *
 * Controlled: the wizard holds the value (so Back/Next keep the choice) and
 * copies `fanName` / `profileLink` into the request it already sends; the
 * server derives the fan from the link.
 */

export interface FanPickValue {
  mode: 'search' | 'existing' | 'new';
  hit: FanLookupHit | null;
  fanName: string;
  profileLink: string;
}

export const EMPTY_FAN_PICK: FanPickValue = { mode: 'search', hit: null, fanName: '', profileLink: '' };

export function isFanPickComplete(value: FanPickValue): boolean {
  return value.mode !== 'search' && Boolean(cleanFanName(value.fanName)) && Boolean(value.profileLink.trim());
}

export function FanPicker({
  creatorId,
  value,
  onChange,
  inputClass,
}: {
  creatorId: string;
  value: FanPickValue;
  onChange: (value: FanPickValue) => void;
  inputClass: string;
}) {
  if (value.mode === 'existing' && value.hit) {
    return <ChosenFan hit={value.hit} value={value} onChange={onChange} inputClass={inputClass} />;
  }
  if (value.mode === 'new') {
    return <NewFan creatorId={creatorId} value={value} onChange={onChange} inputClass={inputClass} />;
  }
  return <FanSearch creatorId={creatorId} onChange={onChange} />;
}

// ─── Search ──────────────────────────────────────────────────────────

function useFanLookup(rawQ: string, creatorId: string, enabled = true) {
  const authFetch = useAuthFetch();
  const q = useDebouncedValue(rawQ, 200);
  const [hits, setHits] = useState<FanLookupHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const params = new URLSearchParams({ q });
    if (creatorId) params.set('creatorId', creatorId);
    authFetch(`/api/fans/lookup?${params}`)
      .then((res: { hits: FanLookupHit[] }) => {
        if (cancelled) return;
        setHits(res.hits);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not search fans');
      });
    return () => {
      cancelled = true;
    };
  }, [q, creatorId, enabled, authFetch]);

  return { hits, error };
}

function FanSearch({ creatorId, onChange }: { creatorId: string; onChange: (value: FanPickValue) => void }) {
  const [q, setQ] = useState('');
  const { hits, error } = useFanLookup(q.trim(), creatorId);
  const looksLikeLink = Boolean(fanKeyOf(parseProfileLink(q)));

  const choose = (hit: FanLookupHit) =>
    onChange({ mode: 'existing', hit, fanName: hit.name ?? '', profileLink: hit.profileLink });
  const addNew = () =>
    onChange({ mode: 'new', hit: null, fanName: looksLikeLink ? '' : q.trim(), profileLink: looksLikeLink ? q.trim() : '' });

  return (
    <div>
      <label htmlFor="fan-search" className="mb-1 block text-xs text-zinc-400">Fan</label>
      <Command shouldFilter={false} className="rounded-lg border border-zinc-700 bg-zinc-800">
        <CommandInput
          id="fan-search"
          value={q}
          onValueChange={setQ}
          placeholder="Name, OnlyFans id or profile link"
          autoFocus
        />
        <CommandList className="max-h-60">
          {error ? (
            <p className="px-3 py-2 text-sm text-red-400">{error}</p>
          ) : hits === null ? (
            <p className="px-3 py-2 text-sm text-zinc-400">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-2 text-sm text-zinc-400">
              {q.trim()
                ? looksLikeLink ? 'This fan isn’t in the fan base yet.' : `No fan called “${q.trim()}”.`
                : creatorId ? 'No fans on record for this creator yet — search by name or link.' : 'Pick the creator above to see their fans, or search.'}
            </p>
          ) : (
            <CommandGroup heading={q.trim() ? undefined : 'This creator’s fans'}>
              {hits.map(hit => (
                <CommandItem key={hit.fanKey} value={hit.fanKey} onSelect={() => choose(hit)} className="flex-col items-start gap-0.5">
                  <span className={cn('truncate', !hit.name && 'font-mono text-xs text-zinc-300')}>
                    {hit.name ?? (hit.fanId ?? `@${hit.handle}`)}
                  </span>
                  <span className="text-[11px] text-zinc-400">{hitMeta(hit)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup>
            <CommandItem value="__new" onSelect={addNew} className="text-zinc-300">
              <Plus className="size-4" aria-hidden />
              {looksLikeLink ? 'Add a new fan with this link' : 'Add a new fan'}
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}

function hitMeta(hit: FanLookupHit): string {
  return [
    hit.name ? (hit.fanId ?? `@${hit.handle}`) : 'No name yet',
    hit.spendWithCreator > 0 ? `${formatUsd(hit.spendWithCreator)} with this creator` : null,
    hit.customs > 0 ? pluralise(hit.customs, 'custom') : null,
  ].filter(Boolean).join(' · ');
}

// ─── A fan from the fan base ─────────────────────────────────────────

function ChosenFan({
  hit,
  value,
  onChange,
  inputClass,
}: {
  hit: FanLookupHit;
  value: FanPickValue;
  onChange: (value: FanPickValue) => void;
  inputClass: string;
}) {
  const missing = !cleanFanName(value.fanName);
  return (
    <div className="space-y-3">
      <div>
        <span className="mb-1 block text-xs text-zinc-400">Fan</span>
        <div className="flex items-center gap-3 rounded-lg bg-white/[0.04] px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className={cn('truncate text-sm', !hit.name && 'font-mono text-xs text-zinc-300')}>{hit.name ?? (hit.fanId ?? `@${hit.handle}`)}</p>
            <p className="truncate text-[11px] text-zinc-400">{hitMeta(hit)}</p>
          </div>
          <Button type="button" size="xs" variant="ghost" onClick={() => onChange(EMPTY_FAN_PICK)}>Change</Button>
        </div>
      </div>
      <div>
        <label htmlFor="fan-name" className="mb-1 block text-xs text-zinc-400">Fan name</label>
        <input
          id="fan-name"
          value={value.fanName}
          maxLength={FAN_NAME_MAX}
          onChange={e => onChange({ ...value, fanName: e.target.value })}
          required
          aria-invalid={missing}
          aria-describedby="fan-name-help"
          className={inputClass}
          autoFocus={!hit.name}
        />
        <p id="fan-name-help" className={cn('mt-1 text-[11px]', !hit.name && missing ? 'text-orange-400' : 'text-zinc-400')}>
          {hit.name
            ? `${FAN_NAME_SOURCE_LABEL[hit.nameSource ?? 'customs']} in the fan base. Change it here to use a different name on this custom.`
            : 'This fan has no name yet — the name you enter becomes their name. Required.'}
        </p>
      </div>
    </div>
  );
}

// ─── A fan not in the fan base yet ───────────────────────────────────

function NewFan({
  creatorId,
  value,
  onChange,
  inputClass,
}: {
  creatorId: string;
  value: FanPickValue;
  onChange: (value: FanPickValue) => void;
  inputClass: string;
}) {
  const parsed = parseProfileLink(value.profileLink);
  const key = fanKeyOf(parsed);
  // A pasted link may belong to a fan who is already in the fan base.
  const { hits } = useFanLookup(value.profileLink.trim(), creatorId, Boolean(key));
  const existing = key ? hits?.find(h => h.fanKey === key || h.fanId === parsed?.fanId) ?? null : null;
  const linkTyped = value.profileLink.trim().length > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400">New fan</span>
        <Button type="button" size="xs" variant="ghost" onClick={() => onChange(EMPTY_FAN_PICK)}>Search the fan base</Button>
      </div>
      <div>
        <label htmlFor="fan-link" className="mb-1 block text-xs text-zinc-400">Profile link</label>
        <input
          id="fan-link"
          value={value.profileLink}
          onChange={e => onChange({ ...value, profileLink: e.target.value })}
          placeholder="onlyfans.com/u123456"
          required
          aria-describedby="fan-link-help"
          className={inputClass}
          autoFocus={!value.profileLink}
        />
        {existing ? (
          <p id="fan-link-help" className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-300">
            Already in the fan base{existing.name ? ` as ${existing.name}` : ''}.
            <button
              type="button"
              onClick={() => onChange({ mode: 'existing', hit: existing, fanName: existing.name ?? value.fanName, profileLink: existing.profileLink })}
              className="rounded-sm text-white underline underline-offset-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Use this fan
            </button>
          </p>
        ) : (
          <p id="fan-link-help" className={cn('mt-1 text-[11px]', linkTyped && !key ? 'text-orange-400' : 'text-zinc-400')}>
            {!linkTyped
              ? 'Their OnlyFans profile. A link with their id (onlyfans.com/u123456) matches them to their purchases.'
              : !key
                ? 'Not an OnlyFans profile link — this custom won’t join the fan base.'
                : parsed?.handle
                  ? 'A handle link works, but can’t be matched to purchases until an admin links the id.'
                  : 'New to the fan base.'}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="fan-name" className="mb-1 block text-xs text-zinc-400">Fan name</label>
        <input
          id="fan-name"
          value={value.fanName}
          maxLength={FAN_NAME_MAX}
          onChange={e => onChange({ ...value, fanName: e.target.value })}
          required
          aria-describedby="new-fan-name-help"
          className={inputClass}
        />
        <p id="new-fan-name-help" className="mt-1 text-[11px] text-zinc-400">What the team calls this fan. Required — it becomes their name in the fan base.</p>
      </div>
    </div>
  );
}

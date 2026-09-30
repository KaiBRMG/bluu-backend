'use client';

import { PlusIcon } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { categoriesFor, toneFor, type GrowthCategory } from '@/lib/growth/category';
import type { GrowthPlatform } from '@/lib/growth/platform';
import { useGrowthCategories } from './categoryContext';

/**
 * Radix reserves the empty string as "no value", so "no category" travels as a
 * sentinel and is mapped back to `null`. "New category…" is a second sentinel:
 * choosing it opens the create dialog and leaves the value where it was.
 */
const NO_CATEGORY = 'none';
const NEW_CATEGORY = '__new__';

/**
 * A category picker — shared by the manage table, the account panel and the add
 * dialog, so the three cannot drift into offering different vocabularies.
 *
 * **The options are the platform's own**, not the whole registry: TWXNK / BONUS
 * / SFW REPOST describe how the X roster is run and mean nothing on a Facebook
 * page. The server checks the same thing against the stored platform — this
 * list is the affordance, not the validation.
 *
 * **It ends in "New category…"**, so a grouping is created at the moment someone
 * finds it missing, and the account being filed lands straight in it. The
 * dialog itself is the provider's single instance (`requestCreate`), not one
 * per picker — the Manage table renders a picker per account.
 *
 * `dot` is the one thing the call sites disagree about. In the manage table the
 * trigger stays greyscale: a coloured `Select` in a column of controls reads as a
 * status control rather than a picker, and that table shows the hue elsewhere.
 * On the account panel this control *replaces* `CategoryDot` — the only place
 * that account's category colour appeared — so the mark moves inside the
 * trigger rather than being lost.
 */
export function CategorySelect({
  platform,
  value,
  onChange,
  busy = false,
  dot = false,
  id,
  ariaLabel,
  noneLabel = 'Unfiled',
  className,
}: {
  platform: GrowthPlatform;
  value: GrowthCategory | null;
  onChange: (next: GrowthCategory | null) => void;
  busy?: boolean;
  /** Show the category's colour inside the trigger. See above. */
  dot?: boolean;
  id?: string;
  ariaLabel?: string;
  /** What "no category" is called here — "Unfiled" on an account, "No category" on a draft. */
  noneLabel?: string;
  className?: string;
}) {
  const { categories, requestCreate } = useGrowthCategories();
  const options = categoriesFor(categories, platform);

  return (
    <Select
      value={value ?? NO_CATEGORY}
      disabled={busy}
      onValueChange={(v) => {
        if (v === NEW_CATEGORY) {
          requestCreate(platform, (category) => {
            // Made for this platform? File the account under it. One made
            // only for the *other* platform cannot hold this account, so the
            // value is left alone rather than sent to be refused.
            if (category.platforms.includes(platform)) onChange(category.name);
          });
          return;
        }
        onChange(v === NO_CATEGORY ? null : v);
      }}
    >
      <SelectTrigger
        id={id}
        size="sm"
        className={cn('text-xs', className)}
        aria-label={ariaLabel}
      >
        {dot && (
          <span
            aria-hidden
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              value ? toneFor(categories, value).dot : 'bg-zinc-500',
            )}
          />
        )}
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_CATEGORY}>{noneLabel}</SelectItem>
        {options.map((c) => (
          // Plain text: an item's contents are mirrored into the trigger, so
          // a dot here would render twice beside the `dot` prop's own mark.
          <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={NEW_CATEGORY} className="text-zinc-300">
          <PlusIcon className="size-3.5" aria-hidden />
          New category…
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

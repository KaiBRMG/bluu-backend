'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2Icon } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import {
  CATEGORY_NAME_MAX, CATEGORY_TONES, CATEGORY_TONE_KEYS, categoryNameProblem, cleanCategoryName,
  type CategoryDef, type CategoryToneKey,
} from '@/lib/growth/category';
import { GROWTH_PLATFORMS, PLATFORM_LABEL, type GrowthPlatform } from '@/lib/growth/platform';
import { SELECT_BOX_CLASS } from '@/lib/surfaces';
import type { CreateCategoryPayload } from '@/hooks/useGrowthTracking';
import { PlatformIcon } from './growthUi';

/**
 * Make a new account category — opened from the "New category…" item at the
 * foot of any category picker, so the grouping is created at the moment someone
 * finds it missing, and the account they were filing lands in it.
 *
 * ── The colour is chosen, never derived ─────────────────────────────────────
 * DESIGN.md bans hashing a label to a hue because the result is unlearnable. A
 * category earns its colour the other way: someone picks it when they make the
 * grouping, from a fixed palette whose filled steps are all measured for white
 * text (`CATEGORY_TONES`). The first colour no category uses yet is preselected,
 * so the default keeps hues distinct without forbidding a deliberate repeat.
 *
 * ── The platform is part of the definition ──────────────────────────────────
 * Categories are platform-scoped — TWXNK means nothing on a Facebook page — so
 * the dialog asks which platforms the grouping is for, defaulting to the one the
 * account being filed is on. The server checks all of this again (rule 10).
 */
export function CreateCategoryDialog({
  open,
  onOpenChange,
  platform,
  categories,
  createCategory,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The platform of the account being filed — the default scope. */
  platform: GrowthPlatform;
  categories: readonly CategoryDef[];
  createCategory: (payload: CreateCategoryPayload) => Promise<CategoryDef>;
  /** Called with the new category once it exists, to file the account under it. */
  onCreated: (category: CategoryDef) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted per opening so the draft never survives a cancel. */}
        {open && (
          <CreateCategoryForm
            platform={platform}
            categories={categories}
            createCategory={createCategory}
            onCancel={() => onOpenChange(false)}
            onCreated={(category) => {
              onOpenChange(false);
              onCreated(category);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateCategoryForm({
  platform,
  categories,
  createCategory,
  onCancel,
  onCreated,
}: {
  platform: GrowthPlatform;
  categories: readonly CategoryDef[];
  createCategory: (payload: CreateCategoryPayload) => Promise<CategoryDef>;
  onCancel: () => void;
  onCreated: (category: CategoryDef) => void;
}) {

  // The first hue nobody has claimed yet; grey when the palette is spent.
  const firstFree = useMemo<CategoryToneKey>(() => {
    const used = new Set(categories.map((c) => c.tone));
    return CATEGORY_TONE_KEYS.find((t) => t !== 'neutral' && !used.has(t)) ?? 'neutral';
  }, [categories]);

  const [name, setName] = useState('');
  const [tone, setTone] = useState<CategoryToneKey>(firstFree);
  const [platforms, setPlatforms] = useState<GrowthPlatform[]>([platform]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleaned = cleanCategoryName(name) ?? '';
  // Only complain once there is something to complain about — an empty field on
  // open is not an error.
  const problem = cleaned ? categoryNameProblem(cleaned, categories) : null;
  const canSubmit = !!cleaned && !problem && platforms.length > 0 && !saving;

  /** Which category already wears each colour — said beside the swatch, not hidden. */
  const usedBy = useMemo(() => {
    const map = new Map<CategoryToneKey, string>();
    for (const c of categories) if (!map.has(c.tone)) map.set(c.tone, c.name);
    return map;
  }, [categories]);

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const category = await createCategory({ name: cleaned, platforms, tone });
      toast.success(`Created ${category.name}`);
      onCreated(category);
    } catch (err) {
      // Stays open with the draft intact — the message is about a field in it.
      setError(err instanceof Error ? err.message : 'Could not create that category.');
      setSaving(false);
    }
  };

  const toneDef = CATEGORY_TONES[tone];

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
      className="contents"
    >
      <DialogHeader>
        <DialogTitle>New category</DialogTitle>
        <DialogDescription>
          Groups accounts on the overview and gives them a filter chip. Anyone with this page can
          file accounts under it.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div>
          <Label htmlFor="growth-category-name" className="mb-1 text-xs text-zinc-400">Name</Label>
          <Input
            id="growth-category-name"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            placeholder="e.g. VIP"
            maxLength={CATEGORY_NAME_MAX + 5}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            aria-invalid={!!problem || undefined}
            aria-describedby="growth-category-name-hint"
          />
          <p
            id="growth-category-name-hint"
            className={cn('mt-1 text-[11px]', problem ? 'text-red-400' : 'text-zinc-400')}
          >
            {problem ?? 'Stored in capitals, like the categories already on the page.'}
          </p>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-zinc-400">Colour</legend>
          <RadioGroup
            value={tone}
            onValueChange={(v) => setTone(v as CategoryToneKey)}
            className="flex flex-wrap gap-2.5"
            aria-label="Colour"
          >
            {CATEGORY_TONE_KEYS.map((key) => {
              const owner = usedBy.get(key);
              return (
                <RadioGroupItem
                  key={key}
                  value={key}
                  aria-label={`${CATEGORY_TONES[key].label}${owner ? `, used by ${owner}` : ''}`}
                  title={owner ? `${CATEGORY_TONES[key].label} — used by ${owner}` : CATEGORY_TONES[key].label}
                  className={cn(
                    'size-6 border-0 shadow-none',
                    CATEGORY_TONES[key].dot,
                    // Selected = a ring offset from the swatch, so the hue itself
                    // stays fully visible; the primitive's centre dot doubles it.
                    'data-[state=checked]:ring-2 data-[state=checked]:ring-white/80',
                    'data-[state=checked]:ring-offset-2 data-[state=checked]:ring-offset-[#171717]',
                    '[&_svg]:fill-zinc-950 [&_svg]:stroke-zinc-950',
                  )}
                />
              );
            })}
          </RadioGroup>
          <p className="mt-1.5 text-[11px] text-zinc-400">
            {toneDef.label}
            {usedBy.get(tone) && <> · also used by {usedBy.get(tone)}</>}
          </p>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-zinc-400">For</legend>
          <div className="flex flex-wrap gap-4">
            {GROWTH_PLATFORMS.map((p) => {
              const id = `growth-category-platform-${p}`;
              return (
                <div key={p} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={platforms.includes(p)}
                    onCheckedChange={(checked) => setPlatforms((current) => (
                      checked === true
                        ? GROWTH_PLATFORMS.filter((x) => x === p || current.includes(x))
                        : current.filter((x) => x !== p)
                    ))}
                    className={SELECT_BOX_CLASS}
                  />
                  <Label htmlFor={id} className="flex items-center gap-1.5 text-sm font-normal text-zinc-200">
                    <PlatformIcon platform={p} />
                    {PLATFORM_LABEL[p]}
                  </Label>
                </div>
              );
            })}
          </div>
          {platforms.length === 0 && (
            <p className="mt-1 text-[11px] text-red-400">Choose at least one platform.</p>
          )}
        </fieldset>

        {/* What it will look like, before it exists. */}
        <div className="flex items-center gap-2 text-[11px] text-zinc-400">
          Preview
          <span
            className={cn(
              'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
              toneDef.chip,
            )}
          >
            {cleaned || 'NEW CATEGORY'}
          </span>
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {saving && <Loader2Icon className="activity-spinner size-4 animate-spin" aria-hidden />}
          {saving ? 'Creating…' : 'Create category'}
        </Button>
      </DialogFooter>
    </form>
  );
}

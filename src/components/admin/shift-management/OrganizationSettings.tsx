'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { useTimeTrackingSettings, type OverridePatch, type TimeTrackingSettingsGroup, type TimeTrackingSettingsUser } from '@/hooks/useTimeTrackingSettings';
import {
  IDLE_INPUT_MODES,
  IDLE_INPUT_MODE_LABELS,
  MAX_IDLE_TIMEOUT_MINUTES,
  MIN_IDLE_TIMEOUT_MINUTES,
  TIME_TRACKING_SETTING_KEYS,
  isValidIdleMinutes,
  resolveTimeTrackingSettings,
  sortGroupsByPrecedence,
  type IdleInputMode,
  type SettingSource,
  type TimeTrackingOverrides,
  type TimeTrackingSettingKey,
  type TimeTrackingSettings,
} from '@/lib/timeTrackingSettings';
import { DEFAULT_SHIFT_BREAK_POLICY, type ShiftBreakPolicy } from '@/lib/shiftBreakPolicy';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { SURFACE } from '@/lib/surfaces';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

// Filled Action Blue Deep on-state — see DESIGN.md §5 (ToggleGroup selection).
const SEGMENT_ITEM_CLASS =
  'text-xs data-[state=on]:bg-[#2563eb]! data-[state=on]:font-medium data-[state=on]:text-white!';

const SETTING_LABELS: Record<TimeTrackingSettingKey, string> = {
  enableIdleTimeout: 'Idle timeout',
  idleTimeoutMinutes: 'Idle after',
  idleInputMode: 'Counts as activity',
  enableScreenshots: 'Screenshots',
  inputMonitoring: 'Input monitoring',
};

const SOURCE_RANK: Record<SettingSource['kind'], number> = { org: 0, group: 1, user: 2 };

function formatValue(key: TimeTrackingSettingKey, value: TimeTrackingSettings[TimeTrackingSettingKey]): string {
  if (key === 'idleTimeoutMinutes') return `${value} min`;
  if (key === 'idleInputMode') return IDLE_INPUT_MODE_LABELS[value as IdleInputMode];
  return value ? 'On' : 'Off';
}

/** "After 6 min", plus the input type when it isn't the default either-input. */
function idleText(values: TimeTrackingSettings): string {
  if (!values.enableIdleTimeout) return 'Off';
  const base = `After ${values.idleTimeoutMinutes} min`;
  return values.idleInputMode === 'any' ? base : `${base} · ${IDLE_INPUT_MODE_LABELS[values.idleInputMode]}`;
}

function sourceLabel(source: SettingSource): string {
  if (source.kind === 'user') return 'Custom';
  if (source.kind === 'group') return `From ${source.groupName}`;
  return 'Organization default';
}

/** The idle cell folds three settings into one; credit whichever is most specific. */
function idleSummary(values: TimeTrackingSettings, sources: Record<TimeTrackingSettingKey, SettingSource>) {
  if (!values.enableIdleTimeout) return { text: 'Off', source: sources.enableIdleTimeout };
  const source = [sources.idleTimeoutMinutes, sources.idleInputMode].reduce(
    (best, s) => (SOURCE_RANK[s.kind] >= SOURCE_RANK[best.kind] ? s : best),
    sources.enableIdleTimeout,
  );
  return { text: idleText(values), source };
}

function overrideCount(o: TimeTrackingOverrides): number {
  return TIME_TRACKING_SETTING_KEYS.filter(k => o[k] !== undefined).length;
}

function savedToast(updatedUsers: number) {
  toast.success('Settings saved', {
    description:
      updatedUsers === 0
        ? "No one's effective settings changed."
        : `${updatedUsers} ${updatedUsers === 1 ? 'user' : 'users'} updated. Running sessions pick this up immediately.`,
  });
}

// ─── Panel ─────────────────────────────────────────────────────────────

export default function OrganizationSettings() {
  const { org, shiftBreaks, groups, users, loading, error, saveOrg, saveShiftBreaks, saveGroup, saveUser } =
    useTimeTrackingSettings();

  if (loading) {
    return (
      <div className="space-y-10">
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !org) {
    return <p className="text-sm text-zinc-400">Couldn&apos;t load settings: {error ?? 'unknown error'}</p>;
  }

  return (
    <div className="space-y-10">
      <p className="max-w-[70ch] text-sm text-zinc-400">
        Each setting resolves independently: a user&apos;s own setting wins, then their group&apos;s,
        then the organization default. Anything not set at a level is inherited from the one below it.
      </p>
      <OrgDefaultsSection org={org} onSave={saveOrg} />
      <ShiftBreaksSection policy={shiftBreaks ?? DEFAULT_SHIFT_BREAK_POLICY} onSave={saveShiftBreaks} />
      <GroupsSection org={org} groups={groups} onSave={saveGroup} />
      <UsersSection org={org} groups={groups} users={users} onSave={saveUser} />
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-[70ch] text-sm text-zinc-400">{description}</p>
    </div>
  );
}

// ─── Organization defaults ─────────────────────────────────────────────

function OrgDefaultsSection({
  org,
  onSave,
}: {
  org: TimeTrackingSettings;
  onSave: (s: TimeTrackingSettings) => Promise<number>;
}) {
  const [draft, setDraft] = useState(org);
  const [minutesText, setMinutesText] = useState(String(org.idleTimeoutMinutes));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(org);
    setMinutesText(String(org.idleTimeoutMinutes));
  }, [org]);

  const minutes = Number(minutesText);
  const minutesValid = /^\d+$/.test(minutesText.trim()) && isValidIdleMinutes(minutes);
  const next: TimeTrackingSettings = { ...draft, idleTimeoutMinutes: minutesValid ? minutes : org.idleTimeoutMinutes };
  const dirty =
    draft.enableIdleTimeout !== org.enableIdleTimeout ||
    draft.idleInputMode !== org.idleInputMode ||
    draft.enableScreenshots !== org.enableScreenshots ||
    draft.inputMonitoring !== org.inputMonitoring ||
    minutesText.trim() !== String(org.idleTimeoutMinutes);

  const handleSave = async () => {
    if (!minutesValid) return;
    setSaving(true);
    try {
      savedToast(await onSave(next));
    } catch (err) {
      toast.error('Could not save organization defaults', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <SectionHeader
        title="Organization defaults"
        description="Applies to everyone who tracks time, unless their group or their own settings say otherwise."
      />
      <div className="divide-y divide-white/[0.07] rounded-xl border border-white/[0.07] bg-white/[0.025]">
        <div className="flex items-start justify-between gap-6 px-4 py-4">
          <div>
            <Label htmlFor="org-idle" className="text-sm">Idle timeout</Label>
            <p className="mt-1 text-xs text-zinc-400">
              Pause working time when there is no input. Idle time is not counted as worked.
            </p>
          </div>
          <Switch
            id="org-idle"
            checked={draft.enableIdleTimeout}
            onCheckedChange={c => setDraft(d => ({ ...d, enableIdleTimeout: c === true }))}
          />
        </div>

        <div className="flex items-start justify-between gap-6 px-4 py-4">
          <div>
            <Label htmlFor="org-idle-minutes" className={draft.enableIdleTimeout ? 'text-sm' : 'text-sm text-zinc-400'}>
              Idle after
            </Label>
            <p className="mt-1 text-xs text-zinc-400">
              Minutes without counted input before a session goes idle ({MIN_IDLE_TIMEOUT_MINUTES}–{MAX_IDLE_TIMEOUT_MINUTES}).
            </p>
            {!minutesValid && (
              <p className="mt-1 text-xs text-red-400" role="alert">
                Enter a whole number from {MIN_IDLE_TIMEOUT_MINUTES} to {MAX_IDLE_TIMEOUT_MINUTES}.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="org-idle-minutes"
              type="number"
              inputMode="numeric"
              min={MIN_IDLE_TIMEOUT_MINUTES}
              max={MAX_IDLE_TIMEOUT_MINUTES}
              className={`form-input w-20 tabular-nums ${minutesValid ? '' : 'error'}`}
              value={minutesText}
              onChange={e => setMinutesText(e.target.value)}
              disabled={!draft.enableIdleTimeout}
              aria-invalid={!minutesValid}
            />
            <span className="text-sm text-zinc-400">min</span>
          </div>
        </div>

        <div className="flex items-start justify-between gap-6 px-4 py-4">
          <div>
            <span id="org-idle-input" className={draft.enableIdleTimeout ? 'text-sm' : 'text-sm text-zinc-400'}>
              {SETTING_LABELS.idleInputMode}
            </span>
            <p className="mt-1 text-xs text-zinc-400">
              Which input keeps a session active. With Keyboard only, moving the mouse does not stop it going idle; with Mouse only, typing does not. Needs app v0.15.0 or later — older versions count either input.
            </p>
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-labelledby="org-idle-input"
            value={draft.idleInputMode}
            onValueChange={v => v && setDraft(d => ({ ...d, idleInputMode: v as IdleInputMode }))}
            disabled={!draft.enableIdleTimeout}
            className="shrink-0"
          >
            {IDLE_INPUT_MODES.map(mode => (
              <ToggleGroupItem key={mode} value={mode} className={SEGMENT_ITEM_CLASS}>
                {IDLE_INPUT_MODE_LABELS[mode]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="flex items-start justify-between gap-6 px-4 py-4">
          <div>
            <Label htmlFor="org-screenshots" className="text-sm">Screenshots</Label>
            <p className="mt-1 text-xs text-zinc-400">
              Capture periodic screenshots while working. Activity % is only measured when this is on.
            </p>
          </div>
          <Switch
            id="org-screenshots"
            checked={draft.enableScreenshots}
            onCheckedChange={c => setDraft(d => ({ ...d, enableScreenshots: c === true }))}
          />
        </div>

        <div className="flex items-start justify-between gap-6 px-4 py-4">
          <div>
            <Label htmlFor="org-input-monitoring" className="text-sm">{SETTING_LABELS.inputMonitoring}</Label>
            <p className="mt-1 text-xs text-zinc-400">
              Records when keys are pressed and what kind of key — never which key — so Chatter Analytics can flag a machine-regular rhythm or modifier-only input. Mac users are asked to allow Input Monitoring. Shown to admins only; it never changes worked time. Needs app v0.17.0 or later.
            </p>
          </div>
          <Switch
            id="org-input-monitoring"
            checked={draft.inputMonitoring}
            onCheckedChange={c => setDraft(d => ({ ...d, inputMonitoring: c === true }))}
          />
        </div>

        {dirty && (
          <div className="flex items-center justify-end gap-2 px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(org);
                setMinutesText(String(org.idleTimeoutMinutes));
              }}
              disabled={saving}
            >
              Discard
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !minutesValid}>
              {saving ? 'Saving…' : 'Save defaults'}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Shift breaks (organization-only) ──────────────────────────────────

function ShiftBreaksSection({
  policy,
  onSave,
}: {
  policy: ShiftBreakPolicy;
  onSave: (p: ShiftBreakPolicy) => Promise<number>;
}) {
  const [draft, setDraft] = useState(policy);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(policy), [policy]);

  const dirty = draft.restrictBreaksAtShiftEdges !== policy.restrictBreaksAtShiftEdges;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      toast.success('Settings saved', {
        description: 'Running sessions pick this up within 15 minutes.',
      });
    } catch (err) {
      toast.error('Could not save shift break rules', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <SectionHeader
        title="Breaks on scheduled shifts"
        description="Applies organization-wide and can't be changed per group or person."
      />
      <div className="divide-y divide-white/[0.07] rounded-xl border border-white/[0.07] bg-white/[0.025]">
        <div className="flex items-start justify-between gap-6 px-4 py-4">
          <div>
            <Label htmlFor="org-shift-edge-breaks" className="text-sm">
              No breaks in the first or last hour of a shift
            </Label>
            <p className="mt-1 text-xs text-zinc-400">
              Blocks starting a break during the first hour and the last hour of a scheduled shift.
              A break already running is not ended.
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              <span className="font-medium text-zinc-300">Only applies to people with a shift scheduled in Shift Management.</span>{' '}
              People who track time without a shift, and time worked outside a scheduled shift, are never affected.
            </p>
          </div>
          <Switch
            id="org-shift-edge-breaks"
            checked={draft.restrictBreaksAtShiftEdges}
            onCheckedChange={c => setDraft({ restrictBreaksAtShiftEdges: c === true })}
          />
        </div>

        {dirty && (
          <div className="flex items-center justify-end gap-2 px-4 py-3">
            <Button variant="ghost" size="sm" onClick={() => setDraft(policy)} disabled={saving}>
              Discard
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Shared cells + editor ─────────────────────────────────────────────

function ValueCell({ text, source, custom }: { text: string; source: string; custom: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-sm tabular-nums">
        <span className={custom ? 'font-medium text-white' : 'text-zinc-300'}>{text}</span>
        {custom && (
          <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">Custom</span>
        )}
      </div>
      {!custom && <div className="mt-0.5 truncate text-[11px] text-zinc-400">{source}</div>}
    </div>
  );
}

type Draft = Record<TimeTrackingSettingKey, 'inherit' | boolean | number | IdleInputMode>;

function toDraft(o: TimeTrackingOverrides): Draft {
  return {
    enableIdleTimeout: o.enableIdleTimeout ?? 'inherit',
    idleTimeoutMinutes: o.idleTimeoutMinutes ?? 'inherit',
    idleInputMode: o.idleInputMode ?? 'inherit',
    enableScreenshots: o.enableScreenshots ?? 'inherit',
    inputMonitoring: o.inputMonitoring ?? 'inherit',
  };
}

/**
 * Inherit / set editor for one group or one user. `inherited` is what each
 * setting would be with no override here, and where it would come from — the
 * thing an admin needs to see before deciding to override at all.
 */
function OverrideEditor({
  title,
  overrides,
  inherited,
  onSave,
  onDone,
}: {
  title: string;
  overrides: TimeTrackingOverrides;
  inherited: { values: TimeTrackingSettings; sources: Record<TimeTrackingSettingKey, SettingSource> };
  onSave: (patch: OverridePatch) => Promise<number>;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(overrides));
  const [minutesText, setMinutesText] = useState(
    String(overrides.idleTimeoutMinutes ?? inherited.values.idleTimeoutMinutes),
  );
  const [saving, setSaving] = useState(false);

  const minutesCustom = draft.idleTimeoutMinutes !== 'inherit';
  const minutes = Number(minutesText);
  const minutesValid = !minutesCustom || (/^\d+$/.test(minutesText.trim()) && isValidIdleMinutes(minutes));
  const effectiveIdleOn =
    draft.enableIdleTimeout === 'inherit' ? inherited.values.enableIdleTimeout : draft.enableIdleTimeout === true;

  const patch = useMemo(() => {
    const out: OverridePatch = {};
    const finalDraft: Draft = { ...draft, idleTimeoutMinutes: minutesCustom ? minutes : 'inherit' };
    for (const key of TIME_TRACKING_SETTING_KEYS) {
      const next = finalDraft[key] === 'inherit' ? undefined : finalDraft[key];
      if (next !== overrides[key]) out[key] = next === undefined ? null : next;
    }
    return out;
  }, [draft, minutesCustom, minutes, overrides]);
  const dirty = Object.keys(patch).length > 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      savedToast(await onSave(patch));
      onDone();
    } catch (err) {
      toast.error(`Could not save settings for ${title}`, {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  const inheritsLine = (key: TimeTrackingSettingKey) =>
    `Inherits ${formatValue(key, inherited.values[key])} · ${sourceLabel(inherited.sources[key])}`;

  const booleanRow = (key: 'enableIdleTimeout' | 'enableScreenshots' | 'inputMonitoring') => (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span id={`ov-${key}`} className="text-sm">{SETTING_LABELS[key]}</span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-labelledby={`ov-${key}`}
          value={draft[key] === 'inherit' ? 'inherit' : draft[key] ? 'on' : 'off'}
          onValueChange={v => {
            if (!v) return;
            setDraft(d => ({ ...d, [key]: v === 'inherit' ? 'inherit' : v === 'on' }));
          }}
        >
          <ToggleGroupItem value="inherit" className={SEGMENT_ITEM_CLASS}>Inherit</ToggleGroupItem>
          <ToggleGroupItem value="on" className={SEGMENT_ITEM_CLASS}>On</ToggleGroupItem>
          <ToggleGroupItem value="off" className={SEGMENT_ITEM_CLASS}>Off</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {draft[key] === 'inherit' && <p className="mt-1 text-[11px] text-zinc-400">{inheritsLine(key)}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <div className="truncate text-sm font-medium">{title}</div>
        <p className="mt-0.5 text-[11px] text-zinc-400">Choose Inherit to follow the level below.</p>
      </div>

      {booleanRow('enableIdleTimeout')}

      <div className={effectiveIdleOn ? undefined : 'opacity-60'}>
        <div className="flex items-center justify-between gap-3">
          <span id="ov-idleTimeoutMinutes" className="text-sm">{SETTING_LABELS.idleTimeoutMinutes}</span>
          <div className="flex items-center gap-2">
            {minutesCustom && (
              <Input
                type="number"
                inputMode="numeric"
                min={MIN_IDLE_TIMEOUT_MINUTES}
                max={MAX_IDLE_TIMEOUT_MINUTES}
                aria-label="Idle after, minutes"
                aria-invalid={!minutesValid}
                className={`form-input h-8 w-16 tabular-nums ${minutesValid ? '' : 'error'}`}
                value={minutesText}
                onChange={e => setMinutesText(e.target.value)}
                disabled={!effectiveIdleOn}
              />
            )}
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              aria-labelledby="ov-idleTimeoutMinutes"
              value={minutesCustom ? 'custom' : 'inherit'}
              onValueChange={v => {
                if (!v) return;
                setDraft(d => ({ ...d, idleTimeoutMinutes: v === 'inherit' ? 'inherit' : minutes || inherited.values.idleTimeoutMinutes }));
              }}
              disabled={!effectiveIdleOn}
            >
              <ToggleGroupItem value="inherit" className={SEGMENT_ITEM_CLASS}>Inherit</ToggleGroupItem>
              <ToggleGroupItem value="custom" className={SEGMENT_ITEM_CLASS}>Custom</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        {!effectiveIdleOn ? (
          <p className="mt-1 text-[11px] text-zinc-400">Not used while idle timeout is off.</p>
        ) : !minutesValid ? (
          <p className="mt-1 text-[11px] text-red-400" role="alert">
            Whole minutes, {MIN_IDLE_TIMEOUT_MINUTES}–{MAX_IDLE_TIMEOUT_MINUTES}.
          </p>
        ) : (
          !minutesCustom && <p className="mt-1 text-[11px] text-zinc-400">{inheritsLine('idleTimeoutMinutes')}</p>
        )}
      </div>

      <div className={effectiveIdleOn ? undefined : 'opacity-60'}>
        <span id="ov-idleInputMode" className="text-sm">{SETTING_LABELS.idleInputMode}</span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-labelledby="ov-idleInputMode"
          className="mt-2 w-full"
          value={draft.idleInputMode === 'inherit' ? 'inherit' : String(draft.idleInputMode)}
          onValueChange={v => v && setDraft(d => ({ ...d, idleInputMode: v as IdleInputMode | 'inherit' }))}
          disabled={!effectiveIdleOn}
        >
          <ToggleGroupItem value="inherit" className={`flex-1 ${SEGMENT_ITEM_CLASS}`}>Inherit</ToggleGroupItem>
          <ToggleGroupItem value="any" className={`flex-1 ${SEGMENT_ITEM_CLASS}`}>Either</ToggleGroupItem>
          <ToggleGroupItem value="keyboard" className={`flex-1 ${SEGMENT_ITEM_CLASS}`}>Keyboard</ToggleGroupItem>
          <ToggleGroupItem value="mouse" className={`flex-1 ${SEGMENT_ITEM_CLASS}`}>Mouse</ToggleGroupItem>
        </ToggleGroup>
        {!effectiveIdleOn ? (
          <p className="mt-1 text-[11px] text-zinc-400">Not used while idle timeout is off.</p>
        ) : (
          draft.idleInputMode === 'inherit' && <p className="mt-1 text-[11px] text-zinc-400">{inheritsLine('idleInputMode')}</p>
        )}
      </div>

      {booleanRow('enableScreenshots')}
      {booleanRow('inputMonitoring')}

      <div className="flex items-center justify-between gap-2 border-t border-white/[0.07] pt-3">
        <Button
          variant="ghost"
          size="xs"
          className="text-zinc-400"
          onClick={() =>
            setDraft({ enableIdleTimeout: 'inherit', idleTimeoutMinutes: 'inherit', idleInputMode: 'inherit', enableScreenshots: 'inherit', inputMonitoring: 'inherit' })
          }
          disabled={saving}
        >
          Inherit all
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onDone} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !dirty || !minutesValid}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EditPopover({
  label,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="text-zinc-400 hover:text-white" aria-label={label}>
          Edit
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="dark w-[22rem]">
        {children}
      </PopoverContent>
    </Popover>
  );
}

// ─── Groups ────────────────────────────────────────────────────────────

function GroupsSection({
  org,
  groups,
  onSave,
}: {
  org: TimeTrackingSettings;
  groups: TimeTrackingSettingsGroup[];
  onSave: (id: string, patch: OverridePatch) => Promise<number>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const ordered = useMemo(() => sortGroupsByPrecedence(groups), [groups]);
  const orgSources: Record<TimeTrackingSettingKey, SettingSource> = {
    enableIdleTimeout: { kind: 'org' },
    idleTimeoutMinutes: { kind: 'org' },
    idleInputMode: { kind: 'org' },
    enableScreenshots: { kind: 'org' },
    inputMonitoring: { kind: 'org' },
  };

  return (
    <section>
      <SectionHeader
        title="Group settings"
        description="Set a different policy for a whole team. When someone is in several groups that set the same option, the group higher in this list wins."
      />
      <div className="rounded-xl border border-white/[0.07]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Group</TableHead>
              <TableHead>Idle timeout</TableHead>
              <TableHead>Screenshots</TableHead>
              <TableHead>Input monitoring</TableHead>
              <TableHead className="w-16 pr-4"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered.map(group => {
              const { values } = resolveTimeTrackingSettings(org, [], group.overrides);
              const o = group.overrides;
              const idleCustom =
                o.enableIdleTimeout !== undefined ||
                (values.enableIdleTimeout && (o.idleTimeoutMinutes !== undefined || o.idleInputMode !== undefined));
              return (
                <TableRow key={group.id}>
                  <TableCell className="pl-4">
                    <div className="text-sm font-medium">{group.name}</div>
                    <div className="mt-0.5 text-[11px] text-zinc-400 tabular-nums">
                      {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'} tracking time
                    </div>
                  </TableCell>
                  <TableCell>
                    <ValueCell
                      text={idleText(values)}
                      custom={idleCustom}
                      source="Organization default"
                    />
                  </TableCell>
                  <TableCell>
                    <ValueCell
                      text={formatValue('enableScreenshots', values.enableScreenshots)}
                      custom={o.enableScreenshots !== undefined}
                      source="Organization default"
                    />
                  </TableCell>
                  <TableCell>
                    <ValueCell
                      text={formatValue('inputMonitoring', values.inputMonitoring)}
                      custom={o.inputMonitoring !== undefined}
                      source="Organization default"
                    />
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <EditPopover
                      label={`Edit settings for ${group.name}`}
                      open={editing === group.id}
                      onOpenChange={o => setEditing(o ? group.id : null)}
                    >
                      <OverrideEditor
                        title={group.name}
                        overrides={group.overrides}
                        inherited={{ values: org, sources: orgSources }}
                        onSave={patch => onSave(group.id, patch)}
                        onDone={() => setEditing(null)}
                      />
                    </EditPopover>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

// ─── Users ─────────────────────────────────────────────────────────────

function UsersSection({
  org,
  groups,
  users,
  onSave,
}: {
  org: TimeTrackingSettings;
  groups: TimeTrackingSettingsGroup[];
  users: TimeTrackingSettingsUser[];
  onSave: (id: string, patch: OverridePatch) => Promise<number>;
}) {
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [show, setShow] = useState<'all' | 'custom'>('all');
  const [editing, setEditing] = useState<string | null>(null);

  const groupById = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);
  const customCount = useMemo(() => users.filter(u => overrideCount(u.overrides) > 0).length, [users]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter(u => !q || u.displayName.toLowerCase().includes(q))
      .filter(u => groupFilter === 'all' || u.groups.includes(groupFilter))
      .filter(u => show === 'all' || overrideCount(u.overrides) > 0)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [users, query, groupFilter, show]);

  return (
    <section>
      <SectionHeader
        title="User settings"
        description="Override the policy for one person. Values marked Custom are set on the user; everything else is inherited."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500" aria-hidden />
          <Input
            type="search"
            placeholder="Search people"
            aria-label="Search people"
            className="form-input w-56 pl-8"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger className="w-44 bg-zinc-800 border-zinc-700" aria-label="Filter by group">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="dark">
            <SelectItem value="all">All groups</SelectItem>
            {sortGroupsByPrecedence(groups).map(g => (
              <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Show"
          value={show}
          onValueChange={v => v && setShow(v as 'all' | 'custom')}
        >
          <ToggleGroupItem value="all" className={SEGMENT_ITEM_CLASS}>
            Everyone <span className="ml-1 tabular-nums">{users.length}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="custom" className={SEGMENT_ITEM_CLASS}>
            Custom only <span className="ml-1 tabular-nums">{customCount}</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {users.length === 0 ? (
        <p className="text-sm text-zinc-400">No one has time tracking access yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-zinc-400">
          Nothing matches these filters.{' '}
          <button
            type="button"
            className="text-white underline-offset-2 hover:underline"
            onClick={() => {
              setQuery('');
              setGroupFilter('all');
              setShow('all');
            }}
          >
            Clear them to see all {users.length}
          </button>
        </p>
      ) : (
        <div className="rounded-xl border border-white/[0.07]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Person</TableHead>
                <TableHead>Idle timeout</TableHead>
                <TableHead>Screenshots</TableHead>
                <TableHead>Input monitoring</TableHead>
                <TableHead className="w-16 pr-4"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(u => {
                const idle = idleSummary(u.effective, u.sources);
                const userGroups = u.groups.map(id => groupById.get(id)).filter((g): g is TimeTrackingSettingsGroup => !!g);
                const inherited = resolveTimeTrackingSettings(org, userGroups, {});
                const name = u.displayName || 'User';
                return (
                  <TableRow key={u.uid}>
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-2.5">
                        <Avatar size="sm" style={{ background: getAvatarColor(u.displayName || 'User') }}>
                          {u.photoURL && <AvatarImage src={u.photoURL} alt="" />}
                          <AvatarFallback style={{ background: getAvatarColor(u.displayName || 'User'), color: '#fff' }}>
                            {getInitials(u.displayName || '')}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{name}</div>
                          <div className="mt-0.5 truncate text-[11px] text-zinc-400">
                            {userGroups.map(g => g.name).join(' · ') || 'No group'}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <ValueCell text={idle.text} source={sourceLabel(idle.source)} custom={idle.source.kind === 'user'} />
                    </TableCell>
                    <TableCell>
                      <ValueCell
                        text={formatValue('enableScreenshots', u.effective.enableScreenshots)}
                        source={sourceLabel(u.sources.enableScreenshots)}
                        custom={u.sources.enableScreenshots.kind === 'user'}
                      />
                    </TableCell>
                    <TableCell>
                      <ValueCell
                        text={formatValue('inputMonitoring', u.effective.inputMonitoring)}
                        source={sourceLabel(u.sources.inputMonitoring)}
                        custom={u.sources.inputMonitoring.kind === 'user'}
                      />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <EditPopover
                        label={`Edit settings for ${name}`}
                        open={editing === u.uid}
                        onOpenChange={o => setEditing(o ? u.uid : null)}
                      >
                        <OverrideEditor
                          title={name}
                          overrides={u.overrides}
                          inherited={inherited}
                          onSave={patch => onSave(u.uid, patch)}
                          onDone={() => setEditing(null)}
                        />
                      </EditPopover>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

// ─── One person (the person sheet) ─────────────────────────────────────

/**
 * The Users-table editor for a single person, inline rather than in a popover —
 * the person sheet's Settings section. Same editor, same save path, same
 * inheritance read-out, so the two surfaces cannot disagree about a value.
 */
export function PersonTrackingSettings({ uid }: { uid: string }) {
  const { org, groups, users, loading, error, saveUser } = useTimeTrackingSettings();
  // Bumped on Cancel/Save so the inline editor re-seeds from the saved overrides.
  const [rev, setRev] = useState(0);

  if (loading) return <Skeleton className="h-80 w-full max-w-md rounded-xl" />;
  if (error || !org) {
    return <p className="text-sm text-zinc-400">Couldn&apos;t load settings: {error ?? 'unknown error'}</p>;
  }

  const u = users.find(x => x.uid === uid);
  if (!u) return <p className="text-sm text-zinc-400">This person doesn&apos;t have time tracking access.</p>;

  const groupById = new Map(groups.map(g => [g.id, g]));
  const userGroups = u.groups.map(id => groupById.get(id)).filter((g): g is TimeTrackingSettingsGroup => !!g);
  const inherited = resolveTimeTrackingSettings(org, userGroups, {});

  return (
    <div className={`max-w-md rounded-xl p-4 ${SURFACE}`}>
      <OverrideEditor
        key={`${rev}:${JSON.stringify(u.overrides)}`}
        title="Time tracking for this person"
        overrides={u.overrides}
        inherited={inherited}
        onSave={patch => saveUser(uid, patch)}
        onDone={() => setRev(r => r + 1)}
      />
    </div>
  );
}

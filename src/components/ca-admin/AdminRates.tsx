'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2Icon, Plus, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { formatRelative, formatUsd } from '@/lib/salary/salaryFormat';
import type { SalaryConfig, WageRateBasis } from '@/lib/salary/salaryTypes';

/**
 * The rate tables.
 *
 * Editable without a deploy on purpose: the desktop renderer can be weeks old,
 * so anything that decides a figure has to be read over HTTP rather than
 * compiled in (CLAUDE.md rule 9c). It is also the single most dangerous screen
 * in the subsystem — a tier change silently restates every open month — which is
 * why it takes the admin claim rather than a page permission, and why the
 * warning below is permanent rather than a first-visit tip.
 *
 * Nothing here is live-saved. The whole form commits at once, so a
 * half-configured tier ladder can never be what an agent's dashboard reads.
 */

const WAGE_TIER_COUNTS = [1, 2, 3, 4, 5, 6];

export default function AdminRates() {
  const { user } = useAuth();
  const { userData } = useUserData();
  const isAdmin = userData?.groups?.includes('admin') === true || userData?.role === 'admin';

  const [config, setConfig] = useState<SalaryConfig | null>(null);
  const [draft, setDraft] = useState<SalaryConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/ca-salary/config', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Could not load rates (${res.status})`);
      const body = (await res.json()) as { config: SalaryConfig };
      setConfig(body.config);
      setDraft(body.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load rates');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = draft !== null && config !== null && JSON.stringify(draft) !== JSON.stringify(config);

  async function save() {
    if (!user || !draft) return;
    setSaving(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/ca-salary/config', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deductionRate: draft.deductionRate,
          commissionTiers: draft.commissionTiers,
          wageTiers: draft.wageTiers,
          graceMinutes: draft.graceMinutes,
          defaultShiftHours: draft.defaultShiftHours,
          wageRateBasis: draft.wageRateBasis,
        }),
      });

      if (!res.ok) {
        let message = `Could not save (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the status-based message */
        }
        setError(message);
        return;
      }

      const body = (await res.json()) as { config: SalaryConfig };
      setConfig(body.config);
      setDraft(body.config);
      toast.success('Rates saved — open months recalculate on their next load');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton className="h-96 w-full rounded-lg" />;
  if (!draft) return <p className="text-sm text-red-400">{error ?? 'Could not load rates'}</p>;

  const patch = (changes: Partial<SalaryConfig>) => setDraft({ ...draft, ...changes });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Rates</h2>
        <p className="mt-0.5 max-w-[70ch] text-sm leading-relaxed text-zinc-400">
          The tables every salary figure is calculated from.
          {config?.updatedAt && (
            <> Last changed {formatRelative(config.updatedAt)}.</>
          )}
        </p>
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-orange-500/20 bg-orange-500/[0.06] px-3 py-2.5 text-sm leading-relaxed text-orange-400">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Changing these recalculates every month that is not finalised, for every agent, including months already
          shown to people. Finalised months keep the figures they were frozen at.
        </span>
      </p>

      {!isAdmin && (
        <p className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-sm text-zinc-400">
          Only an administrator can change these. You can see what they are set to.
        </p>
      )}

      <fieldset disabled={!isAdmin} className="space-y-5">
        {/* ── Commission ── */}
        <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
          <h3 className="text-sm font-semibold">Commission tiers</h3>
          <p className="mt-0.5 max-w-[70ch] text-sm leading-relaxed text-zinc-400">
            The rate an agent earns on a day&apos;s net, chosen by their month-to-date gross. The day a threshold is
            crossed takes the new rate and keeps it for the rest of the month; earlier days are never restated.
          </p>

          <ul className="mt-3 space-y-2">
            {draft.commissionTiers.map((tier, index) => (
              <li key={index} className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`tier-min-${index}`} className="text-xs">
                    From
                  </Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                      $
                    </span>
                    <Input
                      id={`tier-min-${index}`}
                      type="number"
                      min={0}
                      step={100}
                      value={tier.minGross}
                      disabled={index === 0}
                      onChange={event => {
                        const next = [...draft.commissionTiers];
                        next[index] = { ...tier, minGross: Number(event.target.value) };
                        patch({ commissionTiers: next });
                      }}
                      className="h-8 w-32 pl-6 tabular-nums"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`tier-pct-${index}`} className="text-xs">
                    Rate
                  </Label>
                  <div className="relative">
                    <Input
                      id={`tier-pct-${index}`}
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={tier.percent}
                      onChange={event => {
                        const next = [...draft.commissionTiers];
                        next[index] = { ...tier, percent: Number(event.target.value) };
                        patch({ commissionTiers: next });
                      }}
                      className="h-8 w-24 pr-7 tabular-nums"
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                      %
                    </span>
                  </div>
                </div>

                {index === 0 ? (
                  <span className="pb-2 text-xs text-zinc-500">Opening rate — always starts at $0</span>
                ) : (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="mb-0.5 text-zinc-400 hover:text-red-400"
                    aria-label={`Remove the ${tier.percent}% tier`}
                    onClick={() => patch({ commissionTiers: draft.commissionTiers.filter((_, i) => i !== index) })}
                  >
                    <X aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>

          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => {
              const last = draft.commissionTiers[draft.commissionTiers.length - 1];
              patch({
                commissionTiers: [
                  ...draft.commissionTiers,
                  { minGross: last.minGross + 4000, percent: last.percent + 1 },
                ],
              });
            }}
          >
            <Plus className="size-3.5" aria-hidden />
            Add tier
          </Button>
        </section>

        {/* ── Wage ── */}
        <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
          <h3 className="text-sm font-semibold">Hourly rates</h3>
          <p className="mt-0.5 max-w-[70ch] text-sm leading-relaxed text-zinc-400">
            Paid per hour, by the number of creator accounts worked. A count above the highest tier pays the highest
            rate.
          </p>

          <div className="mt-3 flex flex-wrap gap-3">
            {WAGE_TIER_COUNTS.map(count => (
              <div key={count} className="space-y-1">
                <Label htmlFor={`wage-${count}`} className="text-xs">
                  {count} account{count === 1 ? '' : 's'}
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                    $
                  </span>
                  <Input
                    id={`wage-${count}`}
                    type="number"
                    min={0}
                    step={0.5}
                    value={draft.wageTiers[count] ?? ''}
                    placeholder="—"
                    onChange={event => {
                      const next = { ...draft.wageTiers };
                      if (event.target.value === '') delete next[count];
                      else next[count] = Number(event.target.value);
                      patch({ wageTiers: next });
                    }}
                    className="h-8 w-24 pl-6 tabular-nums"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 border-t border-white/[0.07] pt-3">
            <p className="text-sm font-medium">When an agent works more than one shift in a day</p>
            <p className="mt-0.5 max-w-[70ch] text-sm leading-relaxed text-zinc-400">
              A regular shift plus overtime, typically. This decides which account count sets the rate.
            </p>

            <RadioGroup
              value={draft.wageRateBasis}
              onValueChange={value => patch({ wageRateBasis: value as WageRateBasis })}
              className="mt-2.5"
            >
              {(
                [
                  {
                    value: 'per-shift' as const,
                    title: 'Rate each shift on its own accounts',
                    detail: 'A 3-account shift pays the 3-account rate; a 2-account overtime shift pays the 2-account rate.',
                  },
                  {
                    value: 'per-day' as const,
                    title: 'Rate every hour on the day’s total accounts',
                    detail: 'All five accounts count toward one rate, applied to every hour worked that day. Pays materially more.',
                  },
                ]
              ).map(option => (
                <label
                  key={option.value}
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-md border border-white/[0.07] p-2.5 transition-colors duration-[120ms]',
                    draft.wageRateBasis === option.value && 'border-[#3b82f6]/40 bg-[#3b82f6]/[0.08]',
                  )}
                >
                  <RadioGroupItem value={option.value} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{option.title}</span>
                    <span className="block max-w-[60ch] text-xs leading-relaxed text-zinc-400">{option.detail}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>
        </section>

        {/* ── Hours & deduction ── */}
        <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
          <h3 className="text-sm font-semibold">Hours and deduction</h3>

          <div className="mt-3 flex flex-wrap gap-5">
            <div className="space-y-1">
              <Label htmlFor="deduction" className="text-xs">
                Platform deduction
              </Label>
              <div className="relative">
                <Input
                  id="deduction"
                  type="number"
                  min={0}
                  max={99}
                  step={1}
                  value={Math.round(draft.deductionRate * 100)}
                  onChange={event => patch({ deductionRate: Number(event.target.value) / 100 })}
                  className="h-8 w-24 pr-7 tabular-nums"
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                  %
                </span>
              </div>
              <p className="text-xs text-zinc-500">Commission is earned on what is left</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="grace" className="text-xs">
                Grace period
              </Label>
              <div className="relative">
                <Input
                  id="grace"
                  type="number"
                  min={0}
                  max={120}
                  step={5}
                  value={draft.graceMinutes}
                  onChange={event => patch({ graceMinutes: Number(event.target.value) })}
                  className="h-8 w-28 pr-11 tabular-nums"
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                  min
                </span>
              </div>
              <p className="text-xs text-zinc-500">Added to every worked shift, capped at its length</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="shift-hours" className="text-xs">
                Default shift length
              </Label>
              <div className="relative">
                <Input
                  id="shift-hours"
                  type="number"
                  min={1}
                  max={24}
                  step={0.5}
                  value={draft.defaultShiftHours}
                  onChange={event => patch({ defaultShiftHours: Number(event.target.value) })}
                  className="h-8 w-28 pr-9 tabular-nums"
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                  hrs
                </span>
              </div>
              <p className="text-xs text-zinc-500">Used when a shift has no scheduled length</p>
            </div>
          </div>
        </section>
      </fieldset>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* A worked example, recomputed live from the draft. Reading a tier table
          and predicting a payout is exactly the mental arithmetic that gets a
          rate change wrong. */}
      <WorkedExample config={draft} />

      {isAdmin && (
        <div className="sticky bottom-0 flex items-center gap-2 border-t border-white/[0.07] bg-background/95 py-3 backdrop-blur">
          <Button onClick={() => void save()} disabled={!dirty || saving}>
            {saving && <Loader2Icon className="activity-spinner size-3.5" aria-hidden />}
            Save rates
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setDraft(config)} disabled={saving} className="text-zinc-400">
              Discard changes
            </Button>
          )}
          {!dirty && <span className="text-sm text-zinc-400">No unsaved changes</span>}
        </div>
      )}
    </div>
  );
}

/** A concrete day, priced by the draft rates, so the effect of an edit is visible. */
function WorkedExample({ config }: { config: SalaryConfig }) {
  const exampleGross = 500;
  const exampleMtd = 5000;
  const exampleHours = 8;
  const exampleAccounts = 3;

  const tiers = [...config.commissionTiers].sort((a, b) => a.minGross - b.minGross);
  let percent = tiers[0]?.percent ?? 0;
  for (const tier of tiers) if (exampleMtd >= tier.minGross) percent = tier.percent;

  const net = exampleGross * (1 - config.deductionRate);
  const commission = net * (percent / 100);

  const counts = Object.keys(config.wageTiers).map(Number).sort((a, b) => a - b);
  const clamped = counts.length
    ? Math.min(Math.max(exampleAccounts, counts[0]), counts[counts.length - 1])
    : exampleAccounts;
  let rate = counts.length ? config.wageTiers[counts[0]] : 0;
  for (const count of counts) if (clamped >= count) rate = config.wageTiers[count];

  const wage = exampleHours * rate;

  return (
    <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
      <h3 className="text-sm font-semibold">What this means</h3>
      <p className="mt-0.5 text-sm text-zinc-400">
        An agent {formatUsd(exampleMtd, { cents: false })} into their month, selling{' '}
        {formatUsd(exampleGross, { cents: false })} on an {exampleHours}-hour shift across {exampleAccounts} accounts:
      </p>
      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <dt className="text-xs text-zinc-400">Commission at {percent}%</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums">{formatUsd(commission)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-400">
            Hourly pay at {formatUsd(rate)}/hr
          </dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums">{formatUsd(wage)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-400">That day&apos;s salary</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums">{formatUsd(commission + wage)}</dd>
        </div>
      </dl>
    </section>
  );
}

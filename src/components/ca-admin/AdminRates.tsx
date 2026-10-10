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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatMonthLabel } from '@/lib/salary/salaryDate';
import type { RatesImpactMonth } from '@/app/api/ca-salary/config/route';
import { useAuth } from '@/components/AuthProvider';
import { ApiError, useAuthFetch } from '@/hooks/useAuthFetch';
import { hourlyRateFor, round2, tierPercentFor } from '@/lib/salary/salaryEngine';
import { useUserData } from '@/hooks/useUserData';
import { formatPercent, formatRelative, formatUsd, pluralise } from '@/lib/salary/salaryFormat';
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
 *
 * **Saving is a two-step confirm with the real impact.** The draft goes to the
 * server as a dry run (`PUT ?preview=1`), which prices every open month under
 * both tables, and the dialog shows payroll before and after and who changes
 * tier. A worked example on made-up numbers says what a rate *means*; only
 * this says what it *does* to the people being paid.
 */

/** Problems the server would refuse, caught while typing rather than on save. */
function tierProblems(tiers: SalaryConfig['commissionTiers']): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const [i, t] of tiers.entries()) {
    if (!Number.isFinite(t.minGross) || t.minGross < 0) problems.push(`Tier ${i + 1} needs a threshold of $0 or more.`);
    if (!Number.isFinite(t.percent) || t.percent < 0 || t.percent > 100) problems.push(`Tier ${i + 1} needs a rate between 0% and 100%.`);
    if (seen.has(t.minGross)) problems.push(`Two tiers start at ${formatUsd(t.minGross, { cents: false })}. Thresholds must be distinct.`);
    seen.add(t.minGross);
  }
  const sorted = [...tiers].sort((a, b) => a.minGross - b.minGross);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].percent <= sorted[i - 1].percent) {
      problems.push(
        `The tier from ${formatUsd(sorted[i].minGross, { cents: false })} pays ${formatPercent(sorted[i].percent)}, no more than the tier below it. Selling more would not earn more.`,
      );
    }
  }
  return problems;
}

const WAGE_TIER_COUNTS = [1, 2, 3, 4, 5, 6];

export default function AdminRates() {
  const { user } = useAuth();
  const { userData } = useUserData();
  const isAdmin = userData?.groups?.includes('admin') === true || userData?.role === 'admin';

  const authFetch = useAuthFetch();
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
  const problems = draft ? tierProblems(draft.commissionTiers) : [];

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [impact, setImpact] = useState<RatesImpactMonth[] | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Only the editable fields; the audit stamp is the server's.
  const configBody = (d: SalaryConfig) =>
    JSON.stringify({
      deductionRate: d.deductionRate,
      commissionTiers: d.commissionTiers,
      wageTiers: d.wageTiers,
      graceMinutes: d.graceMinutes,
      defaultShiftHours: d.defaultShiftHours,
      wageRateBasis: d.wageRateBasis,
    });

  const failure = (err: unknown) =>
    err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection and try again.';

  /** Step one: price the draft against every open month, write nothing. */
  async function preview() {
    if (!draft) return;
    setPreviewing(true);
    setError(null);
    setImpact(null);
    try {
      const result = (await authFetch('/api/ca-salary/config?preview=1', { method: 'PUT', body: configBody(draft) })) as {
        months: RatesImpactMonth[];
      };
      setImpact(result.months);
      setConfirmOpen(true);
    } catch (err) {
      setError(failure(err));
    } finally {
      setPreviewing(false);
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const saved = (await authFetch('/api/ca-salary/config', { method: 'PUT', body: configBody(draft) })) as {
        config: SalaryConfig;
      };
      setConfig(saved.config);
      setDraft(saved.config);
      setConfirmOpen(false);
      toast.success('Rates saved. Open months now use them.');
    } catch (err) {
      setError(failure(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton className="h-96 w-full rounded-lg" />;
  if (!draft) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-400">{error ?? 'Could not load rates'}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

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
                  <span className="pb-2 text-xs text-zinc-400">Opening rate — always starts at $0</span>
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

          {problems.length > 0 && (
            <ul role="alert" className="mt-3 space-y-1 text-sm text-red-400">
              {problems.map(problem => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}

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
                    draft.wageRateBasis === option.value && 'border-action-blue/40 bg-action-blue/[0.08]',
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
              <p className="text-xs text-zinc-400">Commission is earned on what is left</p>
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
              <p className="text-xs text-zinc-400">Added to every worked shift, capped at its length</p>
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
              <p className="text-xs text-zinc-400">Used when a shift has no scheduled length</p>
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
          <Button onClick={() => void preview()} disabled={!dirty || saving || previewing || problems.length > 0}>
            {previewing && <Loader2Icon className="activity-spinner size-3.5" aria-hidden />}
            {previewing ? 'Checking open months…' : 'Review and save'}
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setDraft(config)} disabled={saving} className="text-zinc-400">
              Discard changes
            </Button>
          )}
          {!dirty && <span className="text-sm text-zinc-400">No unsaved changes</span>}
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={open => !saving && setConfirmOpen(open)}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Save these rates?</AlertDialogTitle>
            <AlertDialogDescription>
              Every open month is recalculated straight away, including figures agents can already see. Finalised months
              keep what they were frozen at.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {impact && <ImpactSummary months={impact} />}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Keep editing</AlertDialogCancel>
            <Button
              disabled={saving}
              onClick={event => {
                event.preventDefault();
                void save();
              }}
            >
              {saving && <Loader2Icon className="activity-spinner size-3.5" aria-hidden />}
              Save rates
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Payroll before and after, per open month, and the agents who move most. */
function ImpactSummary({ months }: { months: RatesImpactMonth[] }) {
  const open = months.filter(m => m.openAgents > 0);
  if (open.length === 0) {
    return <p className="text-sm text-zinc-400">Every recent month is finalised, so nothing already calculated changes.</p>;
  }
  return (
    <div className="space-y-4">
      {open.map(m => {
        const delta = round2(m.payrollAfter - m.payrollBefore);
        const tierMoves = m.changed.filter(c => c.tierAfter !== c.tierBefore).length;
        return (
          <section key={m.month} className="space-y-1.5">
            <h3 className="text-sm font-medium">
              {formatMonthLabel(m.month)}
              <span className="font-normal text-zinc-400"> · {pluralise(m.openAgents, 'open agent')}</span>
            </h3>
            <p className="text-sm text-zinc-300">
              Payroll <span className="tabular-nums">{formatUsd(m.payrollBefore)}</span> →{' '}
              <span className="font-semibold tabular-nums text-foreground">{formatUsd(m.payrollAfter)}</span>
              <span className="text-zinc-400">
                {' '}
                ({delta === 0 ? 'no change' : `${delta > 0 ? '+' : '−'}${formatUsd(Math.abs(delta))}`})
                {m.changed.length > 0 && ` · ${pluralise(m.changed.length, 'agent')} change`}
                {tierMoves > 0 && `, ${tierMoves} move tier`}
              </span>
            </p>
            {m.changed.length > 0 && (
              <ul className="max-h-36 space-y-0.5 overflow-y-auto text-xs text-zinc-400">
                {m.changed.slice(0, 12).map(c => (
                  <li key={c.uid} className="flex justify-between gap-3">
                    <span className="truncate text-zinc-300">{c.displayName}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatUsd(c.before)} → {formatUsd(c.after)}
                      {c.tierAfter !== c.tierBefore && ` · ${formatPercent(c.tierBefore)} → ${formatPercent(c.tierAfter)}`}
                    </span>
                  </li>
                ))}
                {m.changed.length > 12 && <li>and {m.changed.length - 12} more</li>}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** A concrete day, priced by the draft rates, so the effect of an edit is visible. */
function WorkedExample({ config }: { config: SalaryConfig }) {
  const exampleGross = 500;
  const exampleMtd = 5000;
  const exampleHours = 8;
  const exampleAccounts = 3;

  // The engine's own lookups, not a re-implementation, so the example cannot
  // drift from what is actually paid.
  const percent = tierPercentFor(exampleMtd, config);

  const net = exampleGross * (1 - config.deductionRate);
  const commission = net * (percent / 100);

  const rate = hourlyRateFor(exampleAccounts, config);

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

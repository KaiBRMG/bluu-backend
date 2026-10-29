'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Loader2, SearchCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import type { Preparing } from '@/hooks/useTrainingAdmin';
import type { AdminModuleDetail, AdminTestRow, MaterialCheck } from '@/lib/training/types';
import { cn } from '@/lib/utils';
import { formatWhen } from './zonedTime';

interface TestsStripProps {
  detail: AdminModuleDetail;
  preparing: Preparing | null;
  timezone: string;
  onOpen: (testId: string) => Promise<void>;
  onClose: (testId: string) => Promise<void>;
  onCheck: (testId: string) => Promise<MaterialCheck>;
}

/** Status in words; the hue only repeats it. */
function statusOf(t: AdminTestRow, timezone: string): { label: string; tone: string } {
  if (t.status === 'open') {
    return { label: `Open${t.openedAtMs ? ` since ${formatWhen(t.openedAtMs, timezone)}` : ''}`, tone: 'text-blue-300' };
  }
  if (t.status === 'preparing') return { label: 'Preparing — files not all copied', tone: 'text-orange-300' };
  if (t.closedAtMs) return { label: `Closed ${formatWhen(t.closedAtMs, timezone)}`, tone: 'text-zinc-300' };
  return { label: 'Not opened yet', tone: 'text-zinc-400' };
}

/**
 * T1–T7 with one action each. Only one test is open at a time, so while one is
 * open every other Open is disabled and says which to close first. Open copies
 * what changed in Drive into Storage (`23 / 41 files`) and then opens; if that is
 * interrupted the test sits at Preparing and the same button resumes it.
 */
export default function TestsStrip({ detail, preparing, timezone, onOpen, onClose, onCheck }: TestsStripProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [checking, setChecking] = useState<{ test: AdminTestRow; result: MaterialCheck | null; error: string } | null>(null);
  const { isOn, openTestId } = detail.module;

  async function run(testId: string, action: () => Promise<void>, ok: string) {
    setBusy(testId);
    try {
      await action();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  }

  async function startCheck(test: AdminTestRow) {
    setChecking({ test, result: null, error: '' });
    try {
      setChecking({ test, result: await onCheck(test.id), error: '' });
    } catch (err) {
      setChecking({ test, result: null, error: err instanceof Error ? err.message : 'Could not read Drive' });
    }
  }

  return (
    <section aria-labelledby="tests-heading" className="mb-8">
      <h2 id="tests-heading" className="mb-3 text-lg font-semibold">
        Tests
      </h2>
      <ol className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025]">
        {detail.tests.map((t) => {
          const st = statusOf(t, timezone);
          const prep = preparing?.testId === t.id ? preparing : null;
          const blockedBy = openTestId && openTestId !== t.id ? openTestId : null;
          const pending = t.pending[0];
          return (
            <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/[0.07] px-4 py-3 last:border-b-0">
              <span className="w-8 shrink-0 text-sm font-medium tabular-nums text-zinc-400">{t.id}</span>
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-sm font-medium">{t.title}</p>
                <p className="text-[11px] text-zinc-400 tabular-nums">
                  {Math.round(t.durationMs / 60_000)} minutes
                  {t.slotCount > 0 ? ` · ${t.slotCount} final images` : ''}
                </p>
                {pending && (
                  <p className="mt-1 flex items-start gap-1.5 text-[11px] text-orange-300">
                    <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
                    <span>Can’t open yet: {pending}</span>
                  </p>
                )}
              </div>
              <div className="min-w-0 basis-48 text-xs">
                {prep ? (
                  <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
                    <span className="text-zinc-200 tabular-nums">
                      {prep.total === 0 ? 'Reading Drive…' : `Copying ${prep.done} / ${prep.total} files`}
                    </span>
                    {prep.total > 0 && <Progress value={(prep.done / prep.total) * 100} className="h-1.5" aria-label="Files copied" />}
                  </div>
                ) : (
                  <span className={cn('font-medium', st.tone)}>{st.label}</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="ghost" size="sm" className="text-zinc-300" disabled={!!busy || !!prep} onClick={() => void startCheck(t)}>
                  <SearchCheck className="size-4" />
                  Check Drive
                </Button>
                {t.status === 'open' ? (
                  <Button variant="outline" size="sm" disabled={busy === t.id} onClick={() => void run(t.id, () => onClose(t.id), `${t.id} closed`)}>
                    {busy === t.id && <Loader2 className="activity-spinner size-4 animate-spin" />}
                    Close
                  </Button>
                ) : (
                  <>
                    {t.status === 'preparing' && !prep && (
                      <Button variant="ghost" size="sm" className="text-zinc-400" disabled={!!busy} onClick={() => void run(t.id, () => onClose(t.id), 'Cancelled')}>
                        Cancel
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={!!busy || !!prep || !isOn || !!blockedBy || !!pending}
                      title={
                        !isOn ? 'Switch the module on first' : blockedBy ? `Close ${blockedBy} first` : pending ? pending : undefined
                      }
                      onClick={() => void run(t.id, () => onOpen(t.id), `${t.id} is open`)}
                    >
                      {(busy === t.id || prep) && <Loader2 className="activity-spinner size-4 animate-spin" />}
                      {blockedBy ? `Close ${blockedBy} first` : t.status === 'preparing' ? 'Resume' : 'Open'}
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!isOn && <p className="mt-2 text-[11px] text-zinc-400">Switch the module on to open a test.</p>}

      <Dialog open={!!checking} onOpenChange={(open) => !open && setChecking(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Check Drive · {checking?.test.id} {checking?.test.title}
            </DialogTitle>
            <DialogDescription>What Open would copy from the shared drive. Nothing has been changed.</DialogDescription>
          </DialogHeader>
          {checking?.error ? (
            <p role="alert" className="text-sm text-red-400">
              {checking.error}
            </p>
          ) : !checking?.result ? (
            <p className="flex items-center gap-2 text-sm text-zinc-400" role="status">
              <Loader2 className="activity-spinner size-4 animate-spin" /> Reading Drive…
            </p>
          ) : (
            <CheckResult result={checking.result} />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function CheckResult({ result }: { result: MaterialCheck }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      {result.problems.length > 0 ? (
        <div role="alert" className="rounded-lg border border-orange-400/30 bg-orange-400/10 p-3 text-orange-200">
          <p className="font-medium">Needs attention</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {result.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-green-300">
          <CheckCircle2 className="size-4" aria-hidden />
          {result.upToDate ? 'Everything is copied and up to date.' : 'Nothing is missing. Open will copy the changes below.'}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {result.folders.map((f) => (
          <li key={f.key} className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-3">
            <p className="font-medium">{f.label}</p>
            <p className="text-[11px] text-zinc-400">{f.folder}</p>
            <p className="mt-1 text-xs tabular-nums text-zinc-300">
              {f.added.length} to add · {f.changed.length} changed · {f.removed.length} removed · {f.unchanged} unchanged
            </p>
            {[
              ['Add', f.added],
              ['Changed', f.changed],
              ['Removed', f.removed],
            ].map(([label, names]) =>
              (names as string[]).length > 0 ? (
                <p key={label as string} className="mt-1 text-[11px] text-zinc-400">
                  {label as string}: {(names as string[]).slice(0, 6).join(', ')}
                  {(names as string[]).length > 6 ? ` +${(names as string[]).length - 6} more` : ''}
                </p>
              ) : null,
            )}
            {f.skipped.length > 0 && (
              <p className="mt-1 text-[11px] text-orange-300">
                Skipped: {f.skipped.slice(0, 4).map((s) => `${s.name} (${s.reason})`).join(', ')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

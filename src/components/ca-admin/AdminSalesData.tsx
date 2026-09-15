'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Loader2Icon, TriangleAlert, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/AuthProvider';
import { formatMonthLabel } from '@/lib/salary/salaryDate';
import { formatRelative, formatUsd, pluralise } from '@/lib/salary/salaryFormat';
import type { SalesImportResult } from '@/lib/salary/salaryTypes';

/**
 * Uploading the sales export.
 *
 * The temporary bridge until sales come from OF Manager, and built to be
 * boring: pick a file, read what it *would* do, confirm.
 *
 * ## Why a dry run, not a straight upload
 *
 * These exports are cumulative, so an admin uploading "the last few days" always
 * overlaps what is already there. Without a preview the only way to find out
 * whether a file double-counted a month is to go and look at a month. The dry
 * run answers it up front — imported versus already-had, per agent, with every
 * skipped row explained.
 *
 * The skip list is the part that matters most. An agent whose rows silently
 * vanish is an agent who is underpaid and nobody notices.
 */

type ImportRecord = SalesImportResult & { uploadedByName?: string };

const REASON_LABELS: Record<string, string> = {
  'unmapped-email': 'No account matched',
  'unparseable-date': 'Unreadable date',
  'unparseable-amount': 'Unreadable amount',
  'missing-email': 'No employee email',
};

export default function AdminSalesData() {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SalesImportResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [history, setHistory] = useState<ImportRecord[] | null>(null);

  const loadHistory = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/ca-salary/import?limit=15', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const body = (await res.json()) as { imports: ImportRecord[] };
        setHistory(body.imports);
      }
    } catch {
      setHistory([]);
    }
  }, [user]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function send(chosen: File, dryRun: boolean) {
    if (!user) return;
    setBusy(dryRun ? 'preview' : 'commit');
    setError(null);

    try {
      const token = await user.getIdToken();
      const form = new FormData();
      form.append('file', chosen);
      if (dryRun) form.append('dryRun', 'true');

      const res = await fetch('/api/ca-salary/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!res.ok) {
        let message = `Upload failed (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the status-based message */
        }
        setError(message);
        if (dryRun) setPreview(null);
        return;
      }

      const body = (await res.json()) as { dryRun: boolean; result: SalesImportResult };

      if (dryRun) {
        setPreview(body.result);
      } else {
        toast.success(
          body.result.imported > 0
            ? `Imported ${pluralise(body.result.imported, 'sale')}`
            : 'Nothing new to import — every row was already recorded',
        );
        reset();
        void loadHistory();
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  function choose(chosen: File | null) {
    setError(null);
    setPreview(null);
    setFile(chosen);
    if (chosen) void send(chosen, true);
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Sales data</h2>
        <p className="mt-0.5 max-w-[70ch] text-sm leading-relaxed text-zinc-400">
          Upload the export from the sales tool. Re-uploading a file that overlaps a previous one is safe — rows already
          recorded are recognised and not counted twice.
        </p>
      </div>

      {/* Drop zone. A label wrapping a real file input, so the keyboard path is
          the native one and needs no invented key handling. */}
      <label
        onDragOver={event => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => {
          event.preventDefault();
          setDragging(false);
          const dropped = event.dataTransfer.files?.[0];
          if (dropped) choose(dropped);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors duration-[120ms]',
          dragging
            ? 'border-[#3b82f6] bg-[#3b82f6]/[0.08]'
            : 'border-white/[0.14] bg-white/[0.025] hover:border-white/25 hover:bg-white/[0.04]',
          'focus-within:outline-none focus-within:ring-2 focus-within:ring-[#3b82f6]',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={event => choose(event.target.files?.[0] ?? null)}
        />
        <Upload className="size-5 text-zinc-400" aria-hidden />
        <span className="mt-2.5 text-sm font-medium">
          {file ? file.name : 'Drop the .xlsx export here, or browse'}
        </span>
        <span className="mt-1 text-xs text-zinc-400">
          {file
            ? `${(file.size / 1024).toFixed(0)} KB`
            : 'Needs the Date, Employee, Email, Creator, Fan, Earnings, Gross, Net and Type columns'}
        </span>
      </label>

      {busy === 'preview' && (
        <p className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2Icon className="activity-spinner size-3.5" aria-hidden />
          Reading the file…
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2.5">
          <p className="text-sm text-red-400">{error}</p>
          <Button size="xs" variant="ghost" onClick={reset} className="mt-1.5 text-zinc-400">
            <X aria-hidden />
            Clear
          </Button>
        </div>
      )}

      {preview && file && (
        <ImportPreview
          result={preview}
          committing={busy === 'commit'}
          onCancel={reset}
          onConfirm={() => void send(file, false)}
        />
      )}

      <section>
        <h3 className="text-sm font-semibold">Recent imports</h3>
        {history === null ? (
          <Skeleton className="mt-2 h-32 w-full rounded-lg" />
        ) : history.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">Nothing imported yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/[0.07] rounded-lg border border-white/[0.07]">
            {history.map(record => (
              <li key={record.importId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm">
                    <FileSpreadsheet className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
                    <span className="truncate">{record.fileName}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {record.uploadedByName ?? 'Unknown'} · {formatRelative(record.uploadedAt)}
                    {record.monthsTouched.length > 0 && ` · ${record.monthsTouched.map(formatMonthLabel).join(', ')}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
                  <span className="text-zinc-400">
                    {record.imported} new
                    {record.duplicates > 0 && ` · ${record.duplicates} already had`}
                  </span>
                  {record.skippedRows > 0 && (
                    <span className="rounded-full bg-orange-500/10 px-1.5 py-px font-medium text-orange-400">
                      {record.skippedRows} skipped
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ─── Preview ─────────────────────────────────────────────────────────

function ImportPreview({
  result,
  committing,
  onCancel,
  onConfirm,
}: {
  result: SalesImportResult;
  committing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const nothingToDo = result.imported === 0;

  return (
    <div className="space-y-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">What this file will do</h3>
        <p className="text-xs text-zinc-400">
          {pluralise(result.totalRows, 'row')} read
          {result.monthsTouched.length > 0 && ` · ${result.monthsTouched.map(formatMonthLabel).join(', ')}`}
        </p>
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <dt className="text-xs text-zinc-400">New sales</dt>
          <dd className="mt-0.5 text-xl font-semibold tabular-nums">{result.imported}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-400">Already recorded</dt>
          <dd className="mt-0.5 text-xl font-semibold tabular-nums text-zinc-400">{result.duplicates}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-400">Skipped</dt>
          <dd
            className={cn(
              'mt-0.5 text-xl font-semibold tabular-nums',
              result.skippedRows > 0 ? 'text-orange-400' : 'text-zinc-400',
            )}
          >
            {result.skippedRows}
          </dd>
        </div>
      </dl>

      {/* Per-agent reconciliation: the one view that lets an admin check this
          against the source sheet before committing it. */}
      {result.perUser.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Per agent</h4>
          <ul className="mt-1.5 divide-y divide-white/[0.07]">
            {result.perUser.map(entry => (
              <li key={entry.userId} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                <span className="min-w-0 truncate">
                  {entry.displayName}
                  <span className="ml-1.5 text-xs text-zinc-500">{entry.sourceEmail}</span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatUsd(entry.gross)}
                  <span className="ml-2 text-xs text-zinc-400">{entry.rows} rows</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The skip list is the whole reason this preview exists — never collapse
          it behind a disclosure. */}
      {result.skipped.length > 0 && (
        <div className="rounded-lg border border-orange-500/20 bg-orange-500/[0.06] p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-orange-400">
            <TriangleAlert className="size-3.5" aria-hidden />
            Rows that will not be imported
          </h4>
          <ul className="mt-2 space-y-1.5">
            {result.skipped.map(skip => (
              <li key={`${skip.reason}:${skip.detail}`} className="text-sm">
                <span className="tabular-nums font-medium">{skip.rowCount}</span>{' '}
                <span className="text-zinc-400">
                  {skip.rowCount === 1 ? 'row' : 'rows'} — {REASON_LABELS[skip.reason] ?? skip.reason}:
                </span>{' '}
                <span className="break-all">{skip.detail}</span>
                {skip.sampleRows.length > 0 && (
                  <span className="text-xs text-zinc-500"> (e.g. row {skip.sampleRows.join(', ')})</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {nothingToDo && result.skippedRows === 0 && (
        <p className="flex items-center gap-1.5 text-sm text-green-400">
          <CheckCircle2 className="size-3.5" aria-hidden />
          Everything in this file is already recorded. Importing again changes nothing.
        </p>
      )}

      <div className="flex items-center gap-2 border-t border-white/[0.07] pt-3">
        <Button onClick={onConfirm} disabled={committing || nothingToDo}>
          {committing && <Loader2Icon className="activity-spinner size-3.5" aria-hidden />}
          {nothingToDo ? 'Nothing to import' : `Import ${pluralise(result.imported, 'sale')}`}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={committing} className="text-zinc-400">
          Cancel
        </Button>
      </div>
    </div>
  );
}

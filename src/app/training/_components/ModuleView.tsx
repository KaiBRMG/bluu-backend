'use client';

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconArrowLeft, IconChevronDown } from '@tabler/icons-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  IMAGE_LABEL,
  MAX_OUTPUT_BYTES,
  MAX_WORKING_FILES,
  MAX_WORKING_FILE_BYTES,
  UPLOAD_GRACE_MS,
  getModule,
  getTest,
  type TestDef,
  type TrainingModuleId,
} from '@/lib/training/modules';
import { SCREEN_CHECK_REFRESH_MS } from '@/lib/training/recording';
import type { ModuleResponse, RecordingSlots, TestResponse, TestSummary } from '@/lib/training/types';
import { cn } from '@/lib/utils';
import { api, ApiError, TRAINING_STOPPED, useServerClock } from '../_lib/api';
import { fmtRemaining, minutesOf } from '../_lib/format';
import { ScreenRecorder, grabCheckFrame, pickRecordingType } from '../_lib/screenCapture';
import { AZURE, AZURE_INK, PANEL } from '../_lib/theme';
import { fmtBytes } from '../_lib/upload';
import { useScreenShare } from '../_lib/useScreenShare';
import { ExplainerView } from './Brief';
import { EditRoom } from './EditRoom';
import { ScreenCheck, type CheckState } from './ScreenCheck';
import { SequenceRoom } from './SequenceRoom';
import { Shell } from './Shell';
import { SignedInAside } from './SignedInAside';
import { StateChip } from './StateChip';

/** The screen check of one share: the server's verdict and the candidate's own confirmation. */
type ShareCheck = CheckState & { stream: MediaStream | null; atMs: number; confirmed: boolean };
const NO_CHECK: ShareCheck = { state: 'idle', error: '', stream: null, atMs: 0, confirmed: false };

type ModuleData = ModuleResponse;

interface Ended {
  title: string;
  kind: 'time' | 'finished';
  filled: number;
  total: number;
}

/** How often the page asks whether a test has opened, while nothing is running. */
const WATCH_MS = 15_000;

const testBase = (moduleId: string, testId: string) => `/api/training/modules/${moduleId}/tests/${testId}`;

/**
 * The module for this candidate, and — if a test is mid-attempt — that test with
 * its source images, so the room can open straight onto a running clock.
 */
async function fetchModule(moduleId: string): Promise<{ res: ModuleData; task: TestResponse | null }> {
  const res = await api<ModuleData>(`/api/training/modules/${moduleId}`);
  const live = res.module.tests.find((t) => t.state === 'in-progress');
  const task = live ? await api<TestResponse>(testBase(moduleId, live.id)) : null;
  return { res, task };
}

/**
 * One training module for one candidate: the explainer, the run of tests, the
 * briefing for the open one and — once Start is confirmed — the room.
 *
 * Nothing here decides time. The admin opens a test; the server writes each
 * candidate's own deadline at Start; this component renders what it is told. It
 * watches for a test opening only while nothing is running (one `no-store`
 * request every 15 s, paused while the tab is hidden).
 *
 * It also owns the screen share and its recorder, above the room: the share is
 * checked before Start (the server refuses Start without a fresh check), and the
 * recorder must outlive the room long enough to flush its last segment.
 */
export function ModuleView({ moduleId }: { moduleId: TrainingModuleId }) {
  const router = useRouter();
  const def = getModule(moduleId)!;
  const [data, setData] = useState<ModuleData | null>(null);
  const [task, setTask] = useState<TestResponse | null>(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  // The team switched the module off while this page was open.
  const [stopped, setStopped] = useState(false);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [explainerOpen, setExplainerOpen] = useState<boolean | null>(null);
  const [announce, setAnnounce] = useState('');
  const [confirmStart, setConfirmStart] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const { sync, now } = useServerClock();
  const share = useScreenShare();
  // The check belongs to one share: a new share (or none) reads as unchecked and unconfirmed.
  const [check, setCheck] = useState<ShareCheck>(NO_CHECK);
  const recorder = useRef<ScreenRecorder | null>(null);
  const [recordingFailing, setRecordingFailing] = useState(false);
  const lastOpen = useRef<string | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  const apply = useCallback(
    (res: ModuleData) => {
      sync(res.nowMs);
      setData(res);
      // Say so when a test opens while the page is sitting there.
      const open = res.module.openTestId;
      if (open && open !== lastOpen.current && lastOpen.current !== null) {
        setAnnounce(`${getTest(moduleId, open)?.title ?? open} is now open.`);
      }
      lastOpen.current = open ?? '';
    },
    [moduleId, sync],
  );

  useEffect(() => {
    let cancelled = false;
    fetchModule(moduleId)
      .then(({ res, task: live }) => {
        if (cancelled) return;
        if (live) sync(live.nowMs);
        apply(res);
        setTask(live);
        setError('');
        setMissing(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) router.replace('/training');
        else if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [moduleId, router, sync, apply, refreshKey]);

  // Watch for a test opening — only while nothing is running and the tab is in view.
  useEffect(() => {
    if (task || missing || !data) return;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      api<ModuleData>(`/api/training/modules/${moduleId}`)
        .then(apply)
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) setMissing(true);
          if (err instanceof ApiError && err.status === 401) router.replace('/training');
        });
    };
    const id = window.setInterval(tick, WATCH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [task, missing, data, moduleId, apply, router]);

  const tests = data?.module.tests ?? [];
  const openTest: TestSummary | undefined = tests.find((t) => t.id === data?.module.openTestId && t.state === 'open');
  const briefId = selected ?? openTest?.id ?? null;
  const briefTest = briefId ? tests.find((t) => t.id === briefId) : undefined;
  const briefDef = briefId ? getTest(moduleId, briefId) : null;
  const briefing = briefTest?.state === 'open' && briefDef ? briefDef : null;
  const explainerShown = explainerOpen ?? !openTest;

  /** Grabs a still from the share and proves it reaches Storage — the check Start requires. */
  const runCheck = useCallback(
    async (stream: MediaStream, testId: string): Promise<boolean> => {
      setCheck((c) => ({ ...(c.stream === stream ? c : { ...NO_CHECK, stream }), state: 'uploading', error: '' }));
      const url = `${testBase(moduleId, testId)}/screen-check`;
      try {
        const frame = await grabCheckFrame(stream);
        const { checkId, uploadUrl } = await api<{ checkId: string; uploadUrl: string }>(url, {
          method: 'POST',
          body: { action: 'sign' },
        });
        let put: Response;
        try {
          put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: frame });
        } catch {
          throw new ApiError('The screen check did not reach us. Check your connection and try again.', 0);
        }
        if (!put.ok) throw new ApiError('The screen check did not reach us. Try again.', put.status);
        await api(url, { method: 'POST', body: { action: 'confirm', checkId } });
        const atMs = now();
        setCheck((c) => (c.stream === stream ? { ...c, state: 'passed', atMs } : c));
        return true;
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'The screen check failed. Try again.';
        setCheck((c) => (c.stream === stream ? { ...c, state: 'failed', error: message } : c));
        return false;
      }
    },
    [moduleId, now],
  );

  // The recorder runs while a recorded attempt is open AND the screen is shared.
  // A re-share after "Stop sharing" (or a refresh) is a new stream, so a new recorder.
  const recordBase = task?.attempt?.recording ? testBase(moduleId, task.test.id) : null;
  useEffect(() => {
    if (!recordBase || !share.stream) return;
    const format = pickRecordingType();
    if (!format) return;
    const rec = new ScreenRecorder(
      share.stream,
      format,
      () =>
        api<RecordingSlots>(`${recordBase}/recording`, { method: 'POST', body: { contentType: format.contentType } }).then(
          (r) => r.slots,
        ),
      setRecordingFailing,
    );
    recorder.current = rec;
    rec.start();
    return () => {
      if (recorder.current === rec) recorder.current = null;
      void rec.stop(UPLOAD_GRACE_MS - 5_000);
    };
  }, [recordBase, share.stream]);

  /**
   * Leaves the room: flush the last recording segment (its URL lives until the grace runs out), then
   * end THAT share — not one started for the next test while the flush was running.
   */
  const endRoom = useCallback(() => {
    const rec = recorder.current;
    const recorded = share.stream;
    recorder.current = null;
    void (rec ? rec.stop(UPLOAD_GRACE_MS - 5_000) : Promise.resolve()).then(() => share.release(recorded));
    setRecordingFailing(false);
    setTask(null);
  }, [share]);

  // Switched off mid-test: end the room calmly and say so — the work already uploaded is kept.
  const onStopped = useEffectEvent(() => {
    endRoom();
    setStopped(true);
    setMissing(true);
  });
  useEffect(() => {
    window.addEventListener(TRAINING_STOPPED, onStopped);
    return () => window.removeEventListener(TRAINING_STOPPED, onStopped);
  }, []);

  const own = share.stream && check.stream === share.stream ? check : NO_CHECK;
  const screenReady = own.state === 'passed' && own.confirmed;

  async function start() {
    if (!briefing || starting) return;
    if (!screenReady || !share.stream) {
      // The share ended while the dialog was open: back to the screen check.
      setConfirmStart(false);
      return;
    }
    setStarting(true);
    setStartError('');
    try {
      // The server honours a check for a few minutes; one that has aged is redone first.
      if (now() - own.atMs > SCREEN_CHECK_REFRESH_MS && !(await runCheck(share.stream, briefing.id))) {
        setConfirmStart(false);
        return;
      }
      const started = await api<TestResponse>(`${testBase(moduleId, briefing.id)}/start`, { method: 'POST' });
      sync(started.nowMs);
      setEnded(null);
      setConfirmStart(false);
      setTask(started);
    } catch (err) {
      setConfirmStart(false);
      setStartError(err instanceof ApiError ? err.message : 'Could not start. Try again.');
      reload();
    } finally {
      setStarting(false);
    }
  }

  const handleEnded = useCallback(
    (kind: 'time' | 'finished', filled: number) => {
      const t = task && getTest(moduleId, task.test.id);
      // Out of time: tell the server so the task record is written to Drive now, not at the daily sweep.
      if (t && kind === 'time') void api(`${testBase(moduleId, t.id)}/finish`, { method: 'POST' }).catch(() => {});
      if (t) setEnded({ title: t.title, kind, filled, total: t.slots.length });
      endRoom();
      setSelected(null);
      reload();
    },
    [task, moduleId, reload, endRoom],
  );

  // ─── The focus room ────────────────────────────────────────────────────────
  if (task?.attempt) {
    const t = getTest(moduleId, task.test.id);
    if (t) {
      return (
        <Shell width="wide" bare className="max-w-none px-0 sm:px-0">
          {t.kind === 'sequence' ? (
            <SequenceRoom initial={task} moduleId={moduleId} test={t} now={now} onEnded={handleEnded} share={share} recordingFailing={recordingFailing} />
          ) : (
            <EditRoom
              initial={task}
              moduleId={moduleId}
              test={t}
              explainer={def.explainer}
              now={now}
              onEnded={handleEnded}
              share={share}
              recordingFailing={recordingFailing}
            />
          )}
        </Shell>
      );
    }
  }

  const back = (
    <Link
      href="/training/home"
      prefetch={false}
      className="-ml-2 inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-white/75 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-[#00b8f5]/60"
    >
      <IconArrowLeft className="size-4" aria-hidden />
      Your training
    </Link>
  );

  if (missing) {
    return (
      <Shell>
        <div className="pt-12">
          {back}
          <h1 className="mt-4 text-[2rem] leading-tight font-semibold sm:text-[2.5rem]">
            {stopped ? 'Training has been ended by the team' : 'Training isn’t running right now'}
          </h1>
          <p role={stopped ? 'status' : undefined} className="mt-3 text-base text-white/75">
            {stopped
              ? 'Your uploaded work is kept. The team will be in touch.'
              : `${def.title} is switched off, or you are not on it. If you expected it to be open, check you signed in with the email address you were approved with — the team will let you know when it starts.`}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell aside={data ? <SignedInAside email={data.name ?? undefined} /> : null}>
      {error ? (
        <div role="alert" className="pt-16">
          <p className="text-base text-red-300">{error}</p>
          <Button variant="outline" className="mt-4 h-11" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : !data ? (
        <div className="pt-16" aria-busy="true">
          <span className="sr-only" role="status">
            Loading…
          </span>
        </div>
      ) : (
        <div className="pt-8 pb-24 sm:pt-10">
          {back}
          <h1 className="mt-3 text-[2rem] leading-tight font-semibold text-balance sm:text-[2.5rem]">{def.title}</h1>
          <div className="sr-only" role="status" aria-live="polite">
            {announce}
          </div>

          {ended && (
            <p role="status" className={`${PANEL} mt-6 rounded-xl px-4 py-3 text-base text-white`}>
              {ended.kind === 'time' ? "Time's up. " : ''}
              {ended.title}:{' '}
              {ended.total > 0 ? `${ended.filled} of ${ended.total} final images uploaded and saved.` : 'your answers are saved.'}
            </p>
          )}

          <section aria-labelledby="explainer-heading" className={`${PANEL} mt-6 rounded-2xl`}>
            <h2 id="explainer-heading" className="text-base font-semibold">
              <button
                type="button"
                aria-expanded={explainerShown}
                onClick={() => setExplainerOpen(!explainerShown)}
                className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#00b8f5]/70"
              >
                About these tests
                <IconChevronDown className={cn('size-5 text-white/70 transition-transform', explainerShown && 'rotate-180')} aria-hidden />
              </button>
            </h2>
            {explainerShown && (
              <div className="px-5 pb-6">
                <ExplainerView sections={def.explainer} />
              </div>
            )}
          </section>

          <ol className="mt-8 flex flex-col gap-2" aria-label="Tests">
            {tests.map((t) => (
              <TestRow
                key={t.id}
                test={t}
                selected={briefId === t.id}
                now={now}
                onBrief={() => {
                  setSelected(t.id);
                  setStartError('');
                }}
                onReturn={() =>
                  api<TestResponse>(testBase(moduleId, t.id))
                    .then((r) => {
                      sync(r.nowMs);
                      setTask(r);
                    })
                    .catch(() => reload())
                }
              />
            ))}
          </ol>

          {briefing ? (
            <Briefing
              test={briefing}
              error={startError}
              onStart={() => setConfirmStart(true)}
              screen={
                <>
                  <ScreenCheck
                    share={share}
                    // A new share is checked straight away.
                    onShare={async () => {
                      const stream = await share.request();
                      if (stream) void runCheck(stream, briefing.id);
                    }}
                    check={own}
                    onRetryCheck={() => share.stream && void runCheck(share.stream, briefing.id)}
                    confirmed={own.confirmed}
                    onConfirmed={(confirmed) => setCheck((c) => (c === own ? { ...c, confirmed } : c))}
                  />
                </>
              }
              canStart={screenReady}
              supported={share.supported}
            />
          ) : !openTest && !tests.some((t) => t.state === 'in-progress') ? (
            <p className={`${PANEL} mt-10 rounded-xl px-5 py-4 text-base text-white/85`}>
              {tests.some((t) => t.state === 'open' || t.state === 'locked')
                ? 'No test is open yet. Keep this page open and the next one will appear here when the team opens it.'
                : 'That is everything for now. The team will be in touch.'}
            </p>
          ) : null}
        </div>
      )}

      <AlertDialog open={confirmStart} onOpenChange={(open) => !starting && setConfirmStart(open)}>
        <AlertDialogContent className="rounded-2xl border-white/10 bg-[#0d1014] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Start {briefing ? `${briefing.id} · ${briefing.title}` : ''}?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/75">
              Your {briefing ? minutesOf(briefing.durationMs) : ''} minutes begin the moment you confirm. You cannot pause or
              restart. Your entire screen is recorded until the test ends.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
              Not yet
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={starting}
              onClick={(e) => {
                e.preventDefault();
                void start();
              }}
              className="h-11 font-semibold"
              style={{ backgroundColor: AZURE, color: AZURE_INK }}
            >
              {starting ? 'Starting…' : 'Start now'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}

/** One row in the run of tests: the title, minutes, a chip and the one thing that can be done. */
function TestRow({
  test,
  selected,
  now,
  onBrief,
  onReturn,
}: {
  test: TestSummary;
  selected: boolean;
  now: () => number;
  onBrief: () => void;
  onReturn: () => void;
}) {
  return (
    <li className={cn(`${PANEL} flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-3`, selected && 'border-[#00b8f5]/50')}>
      <span className="w-8 shrink-0 text-sm font-medium tabular-nums text-white/70">{test.id}</span>
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-base font-medium">{test.title}</p>
        <p className="text-sm text-white/70">
          {minutesOf(test.durationMs)} minutes
          {test.state === 'in-progress' && test.deadlineMs ? ` · ${fmtRemaining(test.deadlineMs - now())} left` : ''}
        </p>
      </div>
      <StateChip state={test.state} />
      {test.state === 'open' && (
        <Button
          variant="outline"
          onClick={onBrief}
          className="h-11 border-white/20 bg-transparent px-4 text-sm text-white hover:bg-white/[0.08] hover:text-white"
        >
          Read briefing
        </Button>
      )}
      {test.state === 'in-progress' && (
        <Button onClick={onReturn} className="h-11 px-4 text-sm font-semibold" style={{ backgroundColor: AZURE, color: AZURE_INK }}>
          Return
        </Button>
      )}
    </li>
  );
}

/**
 * The briefing for an open test: the essentials (time, budget, deliverables, the
 * datasets by name), the rules, the screen check and Start. It carries no images
 * of any kind — nothing the briefing returns is signed. The full brief and the
 * source images appear only after Start.
 */
function Briefing({
  test,
  error,
  screen,
  canStart,
  supported,
  onStart,
}: {
  test: TestDef;
  error: string;
  screen: React.ReactNode;
  canStart: boolean;
  supported: boolean;
  onStart: () => void;
}) {
  const lead = test.brief.lead.find((b): b is string => typeof b === 'string');
  const finals = test.slots.length;
  return (
    <section aria-labelledby="briefing-heading" className="mt-12">
      <h2 id="briefing-heading" className="text-xl font-semibold">
        {test.id} · {test.title}
      </h2>
      <dl className="mt-4 grid max-w-prose grid-cols-2 gap-x-6 gap-y-3 text-base">
        <Fact label="Time" value={`${minutesOf(test.durationMs)} minutes`} />
        {test.budgetUsd !== undefined && <Fact label="Generation budget" value={`$${test.budgetUsd.toFixed(2)}`} />}
        <Fact label="Deliverables" value={test.deliverables} />
        {test.datasetLine && <Fact label="Dataset" value={test.datasetLine} />}
      </dl>
      {test.datasets.length > 0 && (
        <p className="mt-4 text-sm text-white/75">
          Datasets:{' '}
          {test.datasets.map((id) => (
            <span key={id} className="mr-2 inline-flex rounded-full border border-white/[0.12] px-3 py-1 text-xs text-white/85">
              {id.charAt(0) + id.slice(1).toLowerCase()}
            </span>
          ))}
        </p>
      )}
      {lead && <p className="mt-4 max-w-prose text-base leading-relaxed text-white/80">{lead}</p>}
      <p className="mt-2 text-sm text-white/70">The full brief and the images appear when you start.</p>

      <h3 className="mt-8 text-base font-semibold">Before you start</h3>
      <ul className="mt-2 flex max-w-prose list-disc flex-col gap-1.5 pl-5 text-base leading-relaxed text-white/80">
        <li>You have {minutesOf(test.durationMs)} minutes. The clock starts the moment you confirm and cannot be paused.</li>
        <li>You have one attempt. Refreshing or closing the page does not reset the clock.</li>
        {test.kind === 'sequence' ? (
          <li>
            Each image is shown for {(test.sequence!.windowMs / 1000).toFixed(0)} seconds and you cannot go back. Your answer is
            saved when its time runs out.
          </li>
        ) : (
          <>
            <li>When time runs out the page locks. An upload already on its way is kept; nothing started after zero is.</li>
            <li>
              Upload as you go. The {finals} final images must be {IMAGE_LABEL}, up to {fmtBytes(MAX_OUTPUT_BYTES)} each. Working
              files can be any type, up to {fmtBytes(MAX_WORKING_FILE_BYTES)} each, at most {MAX_WORKING_FILES}.
            </li>
          </>
        )}
        <li>
          Your entire screen is recorded from Start until the test ends, and the team can watch it live and keep it for review.
          Close anything private first, and silence notifications.
        </li>
        <li>
          If you stop sharing your screen, the test locks until you share it again. The clock keeps running, and uploads are
          refused while nothing is being recorded.
        </li>
      </ul>

      <div className="mt-8">
        {error && (
          <p role="alert" className="mb-3 text-sm text-red-300">
            {error}
          </p>
        )}
        <div className="flex flex-col items-start gap-6">
          {screen}
          {/* A phone or tablet cannot share its screen, so it can read the briefing but never start. */}
          {supported && (
            <Button
              size="lg"
              disabled={!canStart}
              onClick={onStart}
              className="h-12 px-8 text-base font-semibold"
              style={{ backgroundColor: AZURE, color: AZURE_INK }}
            >
              Start
            </Button>
          )}
          {!canStart && supported && <p className="-mt-3 text-sm text-white/70">Start unlocks once the screen check has passed.</p>}
        </div>
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-white/70">{label}</dt>
      <dd className="mt-0.5 font-medium text-white">{value}</dd>
    </div>
  );
}

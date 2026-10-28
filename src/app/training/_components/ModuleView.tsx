'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconArrowLeft } from '@tabler/icons-react';
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
  getModule,
  getPart,
  MAX_OUTPUT_BYTES,
  UPLOAD_GRACE_MS,
  type TrainingModuleId,
} from '@/lib/training/modules';
import { SCREEN_CHECK_REFRESH_MS } from '@/lib/training/recording';
import type { PartResponse, PartSummary, RecordingSlots, SessionSummary } from '@/lib/training/types';
import { api, ApiError, useServerClock } from '../_lib/api';
import { TERMINAL, fmtWhen, minutesOf } from '../_lib/format';
import { ScreenRecorder, grabCheckFrame, pickRecordingType } from '../_lib/screenCapture';
import { AZURE, AZURE_INK, PANEL } from '../_lib/theme';
import { useScreenShare } from '../_lib/useScreenShare';
import { OpensIn } from './Countdown';
import { ScreenCheck, type CheckState } from './ScreenCheck';
import { Shell } from './Shell';
import { SignedInAside } from './SignedInAside';
import { StateChip } from './StateChip';
import { TaskRoom } from './TaskRoom';

/** The screen check of one share: the server's verdict and the candidate's own confirmation. */
type ShareCheck = CheckState & { stream: MediaStream | null; atMs: number; confirmed: boolean };
const NO_CHECK: ShareCheck = { state: 'idle', error: '', stream: null, atMs: 0, confirmed: false };

interface ModuleData {
  nowMs: number;
  name: string | null;
  session: SessionSummary;
}

interface Ended {
  title: string;
  kind: 'time' | 'finished';
  filled: number;
  total: number;
}

/**
 * The sitting for this module, and — if a part is mid-attempt — that part with
 * its source images, so the task room can open straight onto a running clock.
 * A function of the URL and the cookie only; the caller owns every setState.
 */
async function fetchModule(moduleId: string): Promise<{ res: ModuleData; part: PartResponse | null }> {
  const session = new URLSearchParams(window.location.search).get('session');
  const res = await api<ModuleData>(
    `/api/training/modules/${moduleId}${session ? `?session=${encodeURIComponent(session)}` : ''}`,
  );
  const live = res.session.parts.find((p) => p.state === 'in-progress');
  const part = live ? await api<PartResponse>(`/api/training/sessions/${res.session.id}/parts/${live.id}`) : null;
  return { res, part };
}

/**
 * One training module for one sitting: the run of show, the briefing for the
 * part that is next, and — once Start is confirmed — the task room.
 *
 * Nothing here decides time. The server resolves which sitting this is, opens
 * the part, and writes the deadline; this component renders what it is told and
 * re-asks when something should have changed (a part opening, a part ending).
 *
 * It also owns the screen share and its recorder, above the task room: the
 * share is checked before Start (the server refuses Start without a fresh
 * check), and the recorder must outlive the room long enough to flush its last
 * segment when the part ends.
 */
export function ModuleView({ moduleId }: { moduleId: TrainingModuleId }) {
  const router = useRouter();
  const mod = getModule(moduleId)!;
  const [data, setData] = useState<ModuleData | null>(null);
  const [task, setTask] = useState<PartResponse | null>(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [confirmStart, setConfirmStart] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const { sync, now } = useServerClock();
  const share = useScreenShare();
  // The check belongs to one share: a new share (or none) reads as unchecked and unconfirmed.
  const [check, setCheck] = useState<ShareCheck>(NO_CHECK);
  const recorder = useRef<ScreenRecorder | null>(null);
  const [recordingFailing, setRecordingFailing] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetchModule(moduleId)
      .then(({ res, part }) => {
        if (cancelled) return;
        sync(res.nowMs);
        if (part) sync(part.nowMs);
        setData(res);
        setTask(part);
        setError('');
        setMissing(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/training');
        } else if (err instanceof ApiError && err.status === 404) {
          setMissing(true);
        } else {
          setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [moduleId, router, sync, refreshKey]);

  const current: PartSummary | undefined = data?.session.parts.find((p) => !TERMINAL.has(p.state));

  /** Grabs a still from the share and proves it reaches Storage — the check Start requires. */
  const runCheck = useCallback(async (stream: MediaStream, sessionId: string, partId: string): Promise<boolean> => {
    setCheck((c) => ({ ...(c.stream === stream ? c : { ...NO_CHECK, stream }), state: 'uploading', error: '' }));
    const url = `/api/training/sessions/${sessionId}/parts/${partId}/screen-check`;
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
      const error = err instanceof ApiError ? err.message : 'The screen check failed. Try again.';
      setCheck((c) => (c.stream === stream ? { ...c, state: 'failed', error } : c));
      return false;
    }
  }, [now]);

  // The recorder runs while a recorded attempt is open AND the screen is shared.
  // A re-share after "Stop sharing" (or a refresh) is a new stream, so a new recorder.
  const recordBase = task?.attempt?.recording ? `/api/training/sessions/${task.session.id}/parts/${task.part.id}` : null;
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

  const own = share.stream && check.stream === share.stream ? check : NO_CHECK;
  const screenReady = own.state === 'passed' && own.confirmed;

  async function start() {
    if (!data || !current || starting) return;
    if (!screenReady || !share.stream) {
      // The share ended while the dialog was open: back to the screen check.
      setConfirmStart(false);
      return;
    }
    setStarting(true);
    setStartError('');
    try {
      // The server honours a check for a few minutes; one that has aged is redone first.
      if (now() - own.atMs > SCREEN_CHECK_REFRESH_MS && !(await runCheck(share.stream, data.session.id, current.id))) {
        setConfirmStart(false);
        return;
      }
      const part = await api<PartResponse>(`/api/training/sessions/${data.session.id}/parts/${current.id}/start`, {
        method: 'POST',
      });
      sync(part.nowMs);
      setEnded(null);
      setConfirmStart(false);
      setTask(part);
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
      const part = task && getPart(moduleId, task.part.id);
      if (part) setEnded({ title: part.title, kind, filled, total: part.task.slots.length });
      // Flush the last segment (its URL lives until the grace runs out), then end THAT share —
      // not one started for the next part while the flush was running.
      const rec = recorder.current;
      const recorded = share.stream;
      recorder.current = null;
      void (rec ? rec.stop(UPLOAD_GRACE_MS - 5_000) : Promise.resolve()).then(() => share.release(recorded));
      setRecordingFailing(false);
      setTask(null);
      reload();
    },
    [task, moduleId, reload, share],
  );

  // ─── The focus room ────────────────────────────────────────────────────────
  if (task) {
    const part = getPart(moduleId, task.part.id);
    if (part && task.attempt) {
      return (
        <Shell width="wide" bare className="max-w-none px-0 sm:px-0">
          <TaskRoom
            initial={task}
            part={part}
            now={now}
            onEnded={handleEnded}
            share={share}
            recordingFailing={recordingFailing}
          />
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
          <h1 className="mt-4 text-[2rem] leading-tight font-semibold sm:text-[2.5rem]">Nothing here for you</h1>
          <p className="mt-3 text-base text-white/75">
            You are not on a {mod.title} session, or it has closed. Check your training page for what is open.
          </p>
        </div>
      </Shell>
    );
  }

  const partDef = current ? getPart(moduleId, current.id) : null;

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
          <h1 className="mt-3 text-[2rem] leading-tight font-semibold text-balance sm:text-[2.5rem]">{mod.title}</h1>
          <p className="mt-2 text-sm text-white/70">
            {data.session.label} · access ends {fmtWhen(data.session.closesAtMs)}
          </p>

          {ended && (
            <p role="status" className={`${PANEL} mt-6 rounded-xl px-4 py-3 text-base text-white`}>
              {ended.kind === 'time' ? "Time's up. " : ''}
              {ended.title}: {ended.filled} of {ended.total} edits uploaded and saved.
            </p>
          )}

          <ol className="mt-8 flex flex-col gap-2" aria-label="Parts">
            {data.session.parts.map((p, i) => (
              <li key={p.id} className={`${PANEL} flex items-center gap-4 rounded-xl px-4 py-3`}>
                <span className="w-5 shrink-0 text-sm tabular-nums text-white/60">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-medium">{p.title}</p>
                  <p className="text-sm text-white/70">
                    {minutesOf(p.durationMs)} minutes · {p.summary}
                  </p>
                </div>
                <StateChip state={p.state} />
              </li>
            ))}
          </ol>

          {current && partDef ? (
            <section aria-labelledby="briefing-heading" className="mt-12">
              <h2 id="briefing-heading" className="text-xl font-semibold">
                {current.title}
              </h2>
              <div className="mt-3 flex max-w-prose flex-col gap-2 text-base leading-relaxed text-white/80">
                {partDef.brief.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>

              <h3 className="mt-8 text-base font-semibold">Before you start</h3>
              <ul className="mt-2 flex max-w-prose list-disc flex-col gap-1.5 pl-5 text-base leading-relaxed text-white/80">
                <li>You have {minutesOf(current.durationMs)} minutes. The clock starts the moment you confirm and cannot be paused.</li>
                <li>You have one attempt. Refreshing or closing the page does not reset the clock.</li>
                <li>When time runs out the page locks. An upload already on its way is kept; nothing started after zero is.</li>
                <li>
                  Upload as you go. Files must be {IMAGE_LABEL}, up to{' '}
                  {Math.round(MAX_OUTPUT_BYTES / 1024 / 1024)} MB each.
                </li>
                <li>
                  Your entire screen is recorded from Start until the part ends, and the team can watch it live and keep it for
                  review. Close anything private first, and silence notifications.
                </li>
                <li>
                  If you stop sharing your screen, the test locks until you share it again. The clock keeps running, and uploads
                  are refused while nothing is being recorded.
                </li>
              </ul>

              <div className="mt-8">
                {startError && (
                  <p role="alert" className="mb-3 text-sm text-red-300">
                    {startError}
                  </p>
                )}
                {current.state === 'open' && (
                  <div className="flex flex-col items-start gap-6">
                    <ScreenCheck
                      share={share}
                      // A new share is checked straight away.
                      onShare={async () => {
                        const stream = await share.request();
                        if (stream) void runCheck(stream, data.session.id, current.id);
                      }}
                      check={own}
                      onRetryCheck={() => share.stream && void runCheck(share.stream, data.session.id, current.id)}
                      confirmed={own.confirmed}
                      onConfirmed={(confirmed) => setCheck((c) => (c === own ? { ...c, confirmed } : c))}
                    />
                    {/* A phone or tablet cannot share its screen, so it can read the briefing but never start. */}
                    {share.supported && (
                    <Button
                      size="lg"
                      disabled={!screenReady}
                      onClick={() => setConfirmStart(true)}
                      className="h-12 px-8 text-base font-semibold"
                      style={{ backgroundColor: AZURE, color: AZURE_INK }}
                    >
                      Start
                    </Button>
                    )}
                    {!screenReady && share.supported && (
                      <p className="-mt-3 text-sm text-white/70">Start unlocks once the screen check has passed.</p>
                    )}
                  </div>
                )}
                {current.state === 'scheduled' && (
                  <div className={`${PANEL} inline-flex flex-col gap-1 rounded-xl px-5 py-4`}>
                    <p className="text-sm text-white/70">Start opens in</p>
                    <p className="text-2xl font-semibold">
                      <OpensIn opensAtMs={current.opensAtMs} now={now} onOpen={reload} />
                    </p>
                    <p className="text-sm text-white/70">{fmtWhen(current.opensAtMs)}</p>
                  </div>
                )}
                {current.state === 'not-ready' && (
                  <p className={`${PANEL} max-w-prose rounded-xl px-5 py-4 text-base text-white/85`}>
                    This part is still being prepared. Keep this page, or come back shortly.
                  </p>
                )}
              </div>
            </section>
          ) : (
            <p className={`${PANEL} mt-10 rounded-xl px-5 py-4 text-base text-white/85`}>
              That is everything for now. The team will be in touch.
            </p>
          )}
        </div>
      )}

      <AlertDialog open={confirmStart} onOpenChange={(open) => !starting && setConfirmStart(open)}>
        <AlertDialogContent className="rounded-2xl border-white/10 bg-[#0d1014] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Start {current?.title}?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/75">
              Your {current ? minutesOf(current.durationMs) : ''} minutes begin the moment you confirm. You cannot pause or
              restart. Your entire screen is recorded until the part ends.
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
